import express from "express";
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import crypto from "crypto";
import {
  changePasswordForUser,
  createArtifact,
  createPasswordReset,
  createProject,
  createSession,
  createUser,
  deleteArtifact,
  deleteProjectByIdAndOwnerId,
  deleteSessionByToken,
  deleteUserById,
  getProjectByIdAndOwnerId,
  getStorageHealth,
  getUserById,
  getUserByEmail,
  getUserBySessionToken,
  initDatabase,
  listUsersForAdmin,
  listProjectsByOwnerId,
  resetPasswordWithToken,
  updateArtifact,
} from "./storage.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Resolve paths for modern ES Modules on macOS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_COOKIE_NAME = "artifacthub_session";
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean),
);

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");

  return (
    stored.length === candidate.length &&
    crypto.timingSafeEqual(stored, candidate)
  );
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: ADMIN_EMAILS.has(normalizeEmail(user.email)),
    createdAt: user.createdAt,
  };
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...value] = cookie.trim().split("=");
        return [name, decodeURIComponent(value.join("="))];
      }),
  );
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

async function readTemplates() {
  const data = await fs.readFile(
    path.join(__dirname, "data", "templates.json"),
    "utf-8",
  );
  return JSON.parse(data);
}

function markdownValue(value) {
  const text = String(value || "").trim();
  return text || "_Not provided._";
}

function slugifyFilename(value) {
  return String(value || "artifact")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact";
}

function renderArtifactMarkdown({ artifact, project, template }) {
  const lines = [
    `# ${artifact.title || template.title || "Artifact"}`,
    "",
    `Project: ${project.name}`,
    `Template: ${template.title || artifact.templateId}`,
    `Status: ${artifact.status}`,
    `Last updated: ${artifact.updatedAt}`,
    "",
  ];

  if (project.sponsor) {
    lines.push(`Sponsor: ${project.sponsor}`, "");
  }

  if (project.objective) {
    lines.push("## Project Objective", "", markdownValue(project.objective), "");
  }

  lines.push("## Artifact Content", "");

  for (const field of template.fields || []) {
    lines.push(`### ${field.label}`, "", markdownValue(artifact.fieldValues?.[field.id]), "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/$/, "");
  }

  const protocol = String(req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]
    .trim();
  return `${protocol}://${req.get("host")}`;
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  return getUserBySessionToken(token);
}

async function requireAuth(req, res, next) {
  const user = await getCurrentUser(req);

  if (!user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_EMAILS.has(normalizeEmail(req.user?.email))) {
    return res.status(403).json({ error: "Administrator access required." });
  }

  next();
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    const storage = await getStorageHealth();

    res.json({
      ok: true,
      storage,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed.", error);
    res.status(500).json({ ok: false, error: "Health check failed." });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || password.length < 8) {
      return res.status(400).json({
        error:
          "Name, valid email, and password of at least 8 characters are required.",
      });
    }

    const existingUser = await getUserByEmail(email);

    if (existingUser) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }

    const user = await createUser({
      name,
      email,
      passwordHash: hashPassword(password),
    });
    const session = await createSession({
      userId: user.id,
      token: crypto.randomBytes(32).toString("hex"),
    });
    setSessionCookie(res, session.token);

    res.status(201).json({ user: safeUser(user) });
  } catch (error) {
    console.error("Failed to create account.", error);
    res.status(500).json({ error: "Failed to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const user = await getUserByEmail(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const session = await createSession({
      userId: user.id,
      token: crypto.randomBytes(32).toString("hex"),
    });
    setSessionCookie(res, session.token);

    res.json({ user: safeUser(user) });
  } catch (error) {
    console.error("Failed to log in.", error);
    res.status(500).json({ error: "Failed to log in." });
  }
});

app.post("/api/auth/password-reset/request", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const reset = await createPasswordReset({ email, expiresAt });
    const response = {
      message:
        "If an account exists for that email, a password reset link has been created.",
    };

    if (reset) {
      const resetUrl = `${getBaseUrl(req)}/?resetToken=${encodeURIComponent(
        reset.token,
      )}`;
      response.resetUrl = resetUrl;
      response.expiresAt = reset.expiresAt;
      if (process.env.NODE_ENV !== "test") {
        console.log(`Password reset link for ${email}: ${resetUrl}`);
      }
    }

    res.json(response);
  } catch (error) {
    console.error("Failed to request password reset.", error);
    res.status(500).json({ error: "Failed to request password reset." });
  }
});

app.post("/api/auth/password-reset/confirm", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");

    if (!token || password.length < 8) {
      return res.status(400).json({
        error: "A valid reset token and password of at least 8 characters are required.",
      });
    }

    const reset = await resetPasswordWithToken({
      token,
      passwordHash: hashPassword(password),
    });

    if (!reset) {
      return res
        .status(400)
        .json({ error: "This reset link is invalid or has expired." });
    }

    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to reset password.", error);
    res.status(500).json({ error: "Failed to reset password." });
  }
});

app.post("/api/auth/password-change", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || newPassword.length < 8) {
      return res.status(400).json({
        error:
          "Your current password and a new password of at least 8 characters are required.",
      });
    }

    const user = await getUserById(req.user.id);

    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Your current password is incorrect." });
    }

    if (verifyPassword(newPassword, user.passwordHash)) {
      return res.status(400).json({
        error: "Choose a new password that is different from your current password.",
      });
    }

    const changed = await changePasswordForUser({
      userId: user.id,
      passwordHash: hashPassword(newPassword),
    });

    if (!changed) {
      return res.status(404).json({ error: "Account not found." });
    }

    const session = await createSession({
      userId: user.id,
      token: crypto.randomBytes(32).toString("hex"),
    });
    setSessionCookie(res, session.token);

    res.json({
      ok: true,
      user: safeUser({
        ...user,
        passwordHash: undefined,
        updatedAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("Failed to change password.", error);
    res.status(500).json({ error: "Failed to change password." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    await deleteSessionByToken(token);
    clearSessionCookie(res);

    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to log out.", error);
    res.status(500).json({ error: "Failed to log out." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      return res.status(401).json({ user: null });
    }

    res.json({ user: safeUser(user) });
  } catch (error) {
    console.error("Failed to fetch current user.", error);
    res.status(500).json({ error: "Failed to fetch current user." });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({
      users: await listUsersForAdmin(),
    });
  } catch (error) {
    console.error("Failed to fetch admin users.", error);
    res.status(500).json({ error: "Failed to fetch admin users." });
  }
});

app.delete(
  "/api/admin/users/:userId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      if (req.params.userId === req.user.id) {
        return res.status(400).json({
          error: "Use a different admin account if you need to remove this one.",
        });
      }

      const deleted = await deleteUserById(req.params.userId);

      if (!deleted) {
        return res.status(404).json({ error: "User not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Failed to delete user.", error);
      res.status(500).json({ error: "Failed to delete user." });
    }
  },
);

app.get("/api/projects", requireAuth, async (req, res) => {
  try {
    res.json(await listProjectsByOwnerId(req.user.id));
  } catch (error) {
    console.error("Failed to fetch projects.", error);
    res.status(500).json({ error: "Failed to fetch projects." });
  }
});

app.post("/api/projects", requireAuth, async (req, res) => {
  try {
    const project = await createProject({
      ownerId: req.user.id,
      name: String(req.body.name || "Untitled Project").trim(),
      sponsor: String(req.body.sponsor || "").trim(),
      objective: String(req.body.objective || "").trim(),
    });

    res.status(201).json(project);
  } catch (error) {
    console.error("Failed to create project.", error);
    res.status(500).json({ error: "Failed to create project." });
  }
});

app.delete("/api/projects/:projectId", requireAuth, async (req, res) => {
  try {
    const deleted = await deleteProjectByIdAndOwnerId(
      req.params.projectId,
      req.user.id,
    );

    if (!deleted) {
      return res.status(404).json({ error: "Project not found." });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete project.", error);
    res.status(500).json({ error: "Failed to delete project." });
  }
});

app.get("/api/projects/:projectId", requireAuth, async (req, res) => {
  try {
    const project = await getProjectByIdAndOwnerId(
      req.params.projectId,
      req.user.id,
    );

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    res.json(project);
  } catch (error) {
    console.error("Failed to fetch project.", error);
    res.status(500).json({ error: "Failed to fetch project." });
  }
});

// Create Artifact Draft
app.post(
  "/api/projects/:projectId/artifacts",
  requireAuth,
  async (req, res) => {
    try {
      const artifact = await createArtifact({
        projectId: req.params.projectId,
        ownerId: req.user.id,
        templateId: String(req.body.templateId || "").trim(),
        title: String(req.body.title || "Untitled Artifact").trim(),
        fieldValues: req.body.fieldValues || {},
      });

      if (!artifact) {
        return res.status(404).json({ error: "Project not found." });
      }

      res.status(201).json(artifact);
    } catch (error) {
      console.error("Failed to create artifact.", error);
      res.status(500).json({ error: "Failed to create artifact." });
    }
  },
);

app.put(
  "/api/projects/:projectId/artifacts/:artifactId",
  requireAuth,
  async (req, res) => {
    try {
      const result = await updateArtifact({
        projectId: req.params.projectId,
        artifactId: req.params.artifactId,
        ownerId: req.user.id,
        title: String(req.body.title || "Untitled Artifact").trim(),
        status: String(req.body.status || "draft").trim(),
        fieldValues: req.body.fieldValues || {},
      });

      if (!result.projectFound) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (!result.artifact) {
        return res.status(404).json({ error: "Artifact not found." });
      }

      res.json(result.artifact);
    } catch (error) {
      console.error("Failed to update artifact.", error);
      res.status(500).json({ error: "Failed to update artifact." });
    }
  },
);

app.delete(
  "/api/projects/:projectId/artifacts/:artifactId",
  requireAuth,
  async (req, res) => {
    try {
      const result = await deleteArtifact({
        projectId: req.params.projectId,
        artifactId: req.params.artifactId,
        ownerId: req.user.id,
      });

      if (!result.projectFound) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (!result.deleted) {
        return res.status(404).json({ error: "Artifact not found." });
      }

      res.json({ ok: true, project: result.project });
    } catch (error) {
      console.error("Failed to delete artifact.", error);
      res.status(500).json({ error: "Failed to delete artifact." });
    }
  },
);

app.get(
  "/api/projects/:projectId/artifacts/:artifactId/export.md",
  requireAuth,
  async (req, res) => {
    try {
      const project = await getProjectByIdAndOwnerId(
        req.params.projectId,
        req.user.id,
      );

      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }

      const artifact = project.artifacts.find(
        (item) => item.id === req.params.artifactId,
      );

      if (!artifact) {
        return res.status(404).json({ error: "Artifact not found." });
      }

      const templates = await readTemplates();
      const template = templates[artifact.templateId];

      if (!template) {
        return res.status(404).json({ error: "Template not found." });
      }

      const markdown = renderArtifactMarkdown({ artifact, project, template });
      const filename = `${slugifyFilename(project.name)}-${slugifyFilename(
        artifact.title,
      )}.md`;

      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(markdown);
    } catch (error) {
      console.error("Failed to export artifact.", error);
      res.status(500).json({ error: "Failed to export artifact." });
    }
  },
);

// API Route: Fetch clean summaries for navigation sidebar menu construction
app.get("/api/templates", async (req, res) => {
  try {
    const templates = await readTemplates();
    const summary = Object.keys(templates).map((key) => ({
      id: key,
      title: templates[key].title,
      description: templates[key].description,
    }));
    res.json(summary);
  } catch (error) {
    console.error("Failed to read template definitions.", error);
    res.status(500).json({ error: "Failed to read template definitions." });
  }
});

// API Route: Fetch functional breakdown fields matrix for selected workspace index canvas
app.get("/api/templates/:id", async (req, res) => {
  try {
    const templates = await readTemplates();
    const template = templates[req.params.id];

    if (!template) {
      return res
        .status(404)
        .json({ error: "Template workspace matrix target layout not found." });
    }
    res.json(template);
  } catch (error) {
    console.error("Failed to fetch template detail.", error);
    res
      .status(500)
      .json({ error: "Failed to fetch template detail structural breakdown." });
  }
});

async function startServer(port = PORT) {
  await initDatabase();

  return app.listen(port, () => {
    console.log(`ArtifactHub running on port ${port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
  .catch((error) => {
    console.error("Failed to initialize persistence layer.", error);
    process.exit(1);
  });
}

export { app, startServer };
