import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import crypto from "crypto";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Resolve paths for modern ES Modules on macOS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_FILE = path.join(__dirname, "data", "templates.json");
const USERS_FILE = path.join(__dirname, "data", "users.json");
const SESSIONS_FILE = path.join(__dirname, "data", "sessions.json");
const SESSION_COOKIE_NAME = "artifacthub_session";
const PROJECTS_FILE = path.join(__dirname, "data", "projects.json");

async function readJsonFile(filePath, fallback) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return data.trim() ? JSON.parse(data) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

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

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  const [sessions, users] = await Promise.all([
    readJsonFile(SESSIONS_FILE, []),
    readJsonFile(USERS_FILE, []),
  ]);

  const session = sessions.find((item) => item.token === token);

  if (!session) {
    return null;
  }

  return users.find((user) => user.id === session.userId) || null;
}

async function requireAuth(req, res, next) {
  const user = await getCurrentUser(req);

  if (!user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  req.user = user;
  next();
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

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

    const users = await readJsonFile(USERS_FILE, []);
    const existingUser = users.find((user) => user.email === email);

    if (existingUser) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }

    const timestamp = nowIso();
    const user = {
      id: createId("user"),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    users.push(user);
    await writeJsonFile(USERS_FILE, users);

    const sessions = await readJsonFile(SESSIONS_FILE, []);
    const session = {
      id: createId("session"),
      userId: user.id,
      token: crypto.randomBytes(32).toString("hex"),
      createdAt: timestamp,
    };

    sessions.push(session);
    await writeJsonFile(SESSIONS_FILE, sessions);
    setSessionCookie(res, session.token);

    res.status(201).json({ user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Failed to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const users = await readJsonFile(USERS_FILE, []);
    const user = users.find((item) => item.email === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const sessions = await readJsonFile(SESSIONS_FILE, []);
    const session = {
      id: createId("session"),
      userId: user.id,
      token: crypto.randomBytes(32).toString("hex"),
      createdAt: nowIso(),
    };

    sessions.push(session);
    await writeJsonFile(SESSIONS_FILE, sessions);
    setSessionCookie(res, session.token);

    res.json({ user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Failed to log in." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    const sessions = await readJsonFile(SESSIONS_FILE, []);
    const remainingSessions = sessions.filter(
      (session) => session.token !== token,
    );

    await writeJsonFile(SESSIONS_FILE, remainingSessions);
    clearSessionCookie(res);

    res.json({ ok: true });
  } catch (error) {
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
    res.status(500).json({ error: "Failed to fetch current user." });
  }
});

app.get("/api/projects", requireAuth, async (req, res) => {
  try {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const userProjects = projects.filter(
      (project) => project.ownerId === req.user.id,
    );

    res.json(userProjects);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch projects." });
  }
});

app.post("/api/projects", requireAuth, async (req, res) => {
  try {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const timestamp = nowIso();

    const project = {
      id: createId("project"),
      ownerId: req.user.id,
      name: String(req.body.name || "Untitled Project").trim(),
      sponsor: String(req.body.sponsor || "").trim(),
      objective: String(req.body.objective || "").trim(),
      status: "active",
      artifacts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    projects.unshift(project);
    await writeJsonFile(PROJECTS_FILE, projects);

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: "Failed to create project." });
  }
});

app.delete("/api/projects/:projectId", requireAuth, async (req, res) => {
  try {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) =>
        item.id === req.params.projectId && item.ownerId === req.user.id,
    );

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const remainingProjects = projects.filter(
      (item) => item.id !== req.params.projectId,
    );

    await writeJsonFile(PROJECTS_FILE, remainingProjects);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete project." });
  }
});

app.get("/api/projects/:projectId", requireAuth, async (req, res) => {
  try {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) =>
        item.id === req.params.projectId && item.ownerId === req.user.id,
    );

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    res.json(project);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project." });
  }
});

// Create Artifact Draft
app.post(
  "/api/projects/:projectId/artifacts",
  requireAuth,
  async (req, res) => {
    try {
      const projects = await readJsonFile(PROJECTS_FILE, []);
      const project = projects.find(
        (item) =>
          item.id === req.params.projectId && item.ownerId === req.user.id,
      );

      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }

      const timestamp = nowIso();
      const artifact = {
        id: createId("artifact"),
        templateId: String(req.body.templateId || "").trim(),
        title: String(req.body.title || "Untitled Artifact").trim(),
        status: "draft",
        fieldValues: req.body.fieldValues || {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      project.artifacts.unshift(artifact);
      project.updatedAt = timestamp;

      await writeJsonFile(PROJECTS_FILE, projects);

      res.status(201).json(artifact);
    } catch (error) {
      res.status(500).json({ error: "Failed to create artifact." });
    }
  },
);

app.put(
  "/api/projects/:projectId/artifacts/:artifactId",
  requireAuth,
  async (req, res) => {
    try {
      const projects = await readJsonFile(PROJECTS_FILE, []);
      const project = projects.find(
        (item) =>
          item.id === req.params.projectId && item.ownerId === req.user.id,
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

      artifact.title = String(req.body.title || artifact.title).trim();
      artifact.status = String(req.body.status || artifact.status).trim();
      artifact.fieldValues = req.body.fieldValues || artifact.fieldValues;
      artifact.updatedAt = nowIso();
      project.updatedAt = artifact.updatedAt;

      await writeJsonFile(PROJECTS_FILE, projects);

      res.json(artifact);
    } catch (error) {
      res.status(500).json({ error: "Failed to update artifact." });
    }
  },
);

app.delete(
  "/api/projects/:projectId/artifacts/:artifactId",
  requireAuth,
  async (req, res) => {
    try {
      const projects = await readJsonFile(PROJECTS_FILE, []);
      const project = projects.find(
        (item) =>
          item.id === req.params.projectId && item.ownerId === req.user.id,
      );

      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }

      const artifactExists = project.artifacts.some(
        (item) => item.id === req.params.artifactId,
      );

      if (!artifactExists) {
        return res.status(404).json({ error: "Artifact not found." });
      }

      project.artifacts = project.artifacts.filter(
        (item) => item.id !== req.params.artifactId,
      );
      project.updatedAt = nowIso();

      await writeJsonFile(PROJECTS_FILE, projects);

      res.json({ ok: true, project });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete artifact." });
    }
  },
);

// API Route: Fetch clean summaries for navigation sidebar menu construction
app.get("/api/templates", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "templates.json"),
      "utf-8",
    );
    const templates = JSON.parse(data);
    const summary = Object.keys(templates).map((key) => ({
      id: key,
      title: templates[key].title,
      description: templates[key].description,
    }));
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: "Failed to read template definitions." });
  }
});

// API Route: Fetch functional breakdown fields matrix for selected workspace index canvas
app.get("/api/templates/:id", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "templates.json"),
      "utf-8",
    );
    const templates = JSON.parse(data);
    const template = templates[req.params.id];

    if (!template) {
      return res
        .status(404)
        .json({ error: "Template workspace matrix target layout not found." });
    }
    res.json(template);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch template detail structural breakdown." });
  }
});

app.listen(PORT, () => {
  console.log(`ArtifactHub running on port ${PORT}`);
});
