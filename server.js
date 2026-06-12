import express from "express";
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";
import { enrichArtifact, enrichProject } from "./artifact-service.js";
import { config, normalizeEmail } from "./config.js";
import { createSessionToken, hashPassword, verifyPassword } from "./src/server/auth-utils.js";
import {
  getAdminAnalytics,
  getAdminUserDetail,
  listUsageEvents,
  getSystemSettings,
  listAdminAuditEvents,
  recordAdminAuditEvent,
  recordUsageEvent,
  updateSystemSettings,
} from "./src/server/admin-store.js";
import {
  renderArtifactMarkdown as renderVersionedMarkdown,
  slugifyFilename,
} from "./export-service.js";
import { createPhase1Router } from "./phase1-routes.js";
import { getEffectiveAiStatus, getEffectiveFeatureAvailability } from "./src/server/runtime-settings.js";
import {
  listVersions,
  recordActivity,
  recordExport,
  setProvenance,
  upsertContextItems,
} from "./phase1-storage.js";
import {
  changePasswordForUser,
  assignArtifactToProject,
  createArtifact,
  createPasswordReset,
  createProject,
  createSession,
  createUser,
  deleteArtifact,
  deleteProjectByIdAndOwnerId,
  deleteSessionByToken,
  deleteSessionsByUserId,
  deleteUserById,
  getProjectByIdAndOwnerId,
  getArtifactByIdAndOwnerId,
  getStorageHealth,
  getUserById,
  getUserByEmail,
  getUserBySessionToken,
  initDatabase,
  listUsersForAdmin,
  listProjectsByOwnerId,
  listUnassignedArtifactsByOwnerId,
  resetPasswordWithToken,
  updateArtifact,
  updateOwnedArtifact,
} from "./storage.js";
import { getTemplate, listTemplates, readTemplateCatalog } from "./template-service.js";

const app = express();
const PORT = config.port;

// Resolve paths for modern ES Modules on macOS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_COOKIE_NAME = "artifacthub_session";
const ADMIN_EMAILS = config.adminEmails;

function isAdminEmail(email) {
  const normalized = normalizeEmail(email);
  return (
    normalized === normalizeEmail(config.bootstrapAdminEmail) ||
    ADMIN_EMAILS.has(normalized)
  );
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: isAdminEmail(user.email),
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

function parseRangeStart(range) {
  if (range === "24h") {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }
  if (range === "7d") {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (range === "30d") {
    return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return undefined;
}

function requestClientContext(req) {
  const timezone = String(req.get("x-artifacthub-timezone") || "").trim() || null;
  const locale = String(req.get("x-artifacthub-locale") || "").trim() || null;
  const landingPath =
    String(req.get("x-artifacthub-landing-path") || "").trim() || null;
  const referrer = String(
    req.get("x-artifacthub-referrer") || req.get("referer") || "",
  ).trim();
  const referrerUrl = referrer || null;
  let referrerDomain = null;
  try {
    referrerDomain = referrerUrl ? new URL(referrerUrl).hostname : null;
  } catch {
    referrerDomain = null;
  }

  const localHour = Number.parseInt(
    String(req.get("x-artifacthub-local-hour") || ""),
    10,
  );
  const utcOffsetMinutes = Number.parseInt(
    String(req.get("x-artifacthub-utc-offset") || ""),
    10,
  );

  return {
    timezone,
    locale,
    landingPath,
    referrer: referrerUrl,
    referrerDomain,
    utmSource: String(req.get("x-artifacthub-utm-source") || "").trim() || null,
    utmMedium: String(req.get("x-artifacthub-utm-medium") || "").trim() || null,
    utmCampaign:
      String(req.get("x-artifacthub-utm-campaign") || "").trim() || null,
    utmTerm: String(req.get("x-artifacthub-utm-term") || "").trim() || null,
    utmContent: String(req.get("x-artifacthub-utm-content") || "").trim() || null,
    userAgent: String(req.get("user-agent") || "").trim() || null,
    localHour:
      Number.isInteger(localHour) && localHour >= 0 && localHour <= 23
        ? localHour
        : null,
    utcOffsetMinutes: Number.isFinite(utcOffsetMinutes) ? utcOffsetMinutes : null,
    ipAddress:
      String(req.get("x-forwarded-for") || req.ip || "")
        .split(",")[0]
        .trim() || null,
    country: String(req.get("x-vercel-ip-country") || req.get("cf-ipcountry") || "")
      .trim() || null,
    region: String(req.get("x-vercel-ip-country-region") || "").trim() || null,
    city: String(req.get("x-vercel-ip-city") || "").trim() || null,
  };
}

async function recordRequestUsage(req, eventName, options = {}) {
  return recordUsageEvent({
    eventName,
    userId: options.userId || req.user?.id || null,
    sessionId: parseCookies(req)[SESSION_COOKIE_NAME] || null,
    requestPath: req.path,
    projectId: options.projectId || null,
    artifactId: options.artifactId || null,
    templateId: options.templateId || null,
    context: requestClientContext(req),
    metadata: options.metadata || {},
  });
}

function buildLibraryEndpointRegistry() {
  return [
    {
      method: "GET",
      path: "/api/templates",
      authRequired: false,
      purpose: "List all standardized artifact templates.",
      status: "available",
    },
    {
      method: "GET",
      path: "/api/templates/:id",
      authRequired: false,
      purpose: "Read a single template definition and field breakdown.",
      status: "available",
    },
    {
      method: "POST",
      path: "/api/artifacts",
      authRequired: true,
      purpose: "Start a private unassigned draft from a template.",
      status: "available",
    },
    {
      method: "GET",
      path: "/api/artifacts?scope=unassigned",
      authRequired: true,
      purpose: "List private unassigned drafts for the signed-in user.",
      status: "available",
    },
    {
      method: "GET",
      path: "/api/artifacts/:artifactId",
      authRequired: true,
      purpose: "Open a draft or assigned artifact owned by the signed-in user.",
      status: "available",
    },
    {
      method: "PUT",
      path: "/api/artifacts/:artifactId",
      authRequired: true,
      purpose: "Save an owned artifact draft with revision protection.",
      status: "available",
    },
    {
      method: "POST",
      path: "/api/artifacts/:artifactId/assign",
      authRequired: true,
      purpose: "Assign a private draft to an owned project.",
      status: "available",
    },
  ];
}

async function ensureBootstrapAdminAccount() {
  const existing = await getUserByEmail(config.bootstrapAdminEmail);
  if (existing) {
    return existing;
  }

  return createUser({
    name: "Prashant Admin",
    email: config.bootstrapAdminEmail,
    passwordHash: hashPassword(config.bootstrapAdminPassword),
  });
}

let bootstrapAdminReady;

async function ensureBootstrapAdminReady() {
  if (!bootstrapAdminReady) {
    bootstrapAdminReady = ensureBootstrapAdminAccount();
  }
  return bootstrapAdminReady;
}

async function readTemplates() {
  return readTemplateCatalog();
}

function markdownValue(value) {
  const text = String(value || "").trim();
  return text || "_Not provided._";
}

function renderArtifactMarkdown({ artifact, project, template }) {
  const lines = [
    `# ${artifact.title || template.title || "Artifact"}`,
    "",
    `Project: ${project?.name || "Unassigned draft"}`,
    `Template: ${template.title || artifact.templateId}`,
    `Status: ${artifact.status}`,
    `Last updated: ${artifact.updatedAt}`,
    "",
  ];

  if (project?.sponsor) {
    lines.push(`Sponsor: ${project.sponsor}`, "");
  }

  if (project?.objective) {
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
  if (!isAdminEmail(req.user?.email)) {
    return res.status(403).json({ error: "Administrator access required." });
  }

  next();
}

app.use(express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use(express.json());
app.use(async (req, res, next) => {
  try {
    await ensureBootstrapAdminReady();
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const storage = await getStorageHealth();

    res.json({
      ok: true,
      storage,
      runtime: {
        environment: process.env.NODE_ENV || "development",
        ai: {
          featureEnabled: config.ai.enabled,
          provider: config.ai.provider,
          betaAllowlistConfigured: config.ai.betaEmails.size > 0,
        },
      },
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
      token: createSessionToken(),
    });
    setSessionCookie(res, session.token);
    await recordRequestUsage(req, "auth.signup_completed", { userId: user.id });

    res.status(201).json({
      user: safeUser(user),
      features: await getEffectiveFeatureAvailability(user),
    });
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
      token: createSessionToken(),
    });
    setSessionCookie(res, session.token);
    await recordRequestUsage(req, "auth.login_completed", { userId: user.id });

    res.json({
      user: safeUser(user),
      features: await getEffectiveFeatureAvailability(user),
    });
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

    await recordRequestUsage(req, "auth.password_reset_requested", {
      userId: reset?.userId || null,
      metadata: { email },
    });

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
    await recordRequestUsage(req, "auth.password_reset_completed", {
      userId: reset.userId || null,
    });
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
      token: createSessionToken(),
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
    await recordRequestUsage(req, "auth.password_changed", { userId: user.id });
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

    res.json({
      user: safeUser(user),
      features: await getEffectiveFeatureAvailability(user),
    });
  } catch (error) {
    console.error("Failed to fetch current user.", error);
    res.status(500).json({ error: "Failed to fetch current user." });
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [analytics, auditEvents, storage, aiStatus, settings, users] =
      await Promise.all([
        getAdminAnalytics(String(req.query.range || "7d")),
        listAdminAuditEvents(10),
        getStorageHealth(),
        getEffectiveAiStatus(req.user),
        getSystemSettings(),
        listUsersForAdmin(),
      ]);

    res.json({
      metrics: analytics.metrics,
      storage,
      aiStatus,
      settings,
      recentAdminActions: auditEvents,
      recentUsers: analytics.topUsers.slice(0, 8),
      totalUsers: users.length,
    });
  } catch (error) {
    console.error("Failed to fetch admin overview.", error);
    res.status(500).json({ error: "Failed to fetch admin overview." });
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

app.get("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const detail = await getAdminUserDetail(req.params.userId);
    if (!detail) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json(detail);
  } catch (error) {
    console.error("Failed to fetch admin user detail.", error);
    res.status(500).json({ error: "Failed to fetch admin user detail." });
  }
});

app.post(
  "/api/admin/users/:userId/password-reset-link",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const target = await getUserById(req.params.userId);
      if (!target) {
        return res.status(404).json({ error: "User not found." });
      }

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const reset = await createPasswordReset({ email: target.email, expiresAt });
      if (!reset) {
        return res.status(404).json({ error: "User not found." });
      }
      const resetUrl = `${getBaseUrl(req)}/?resetToken=${encodeURIComponent(
        reset.token,
      )}`;
      await recordAdminAuditEvent({
        adminUserId: req.user.id,
        action: "admin.password_reset_link_generated",
        targetUserId: target.id,
        targetType: "user",
        targetId: target.id,
        metadata: { email: target.email },
      });
      await recordRequestUsage(req, "admin.password_reset_link_generated", {
        userId: req.user.id,
        metadata: { targetUserId: target.id },
      });
      res.json({ ok: true, resetUrl, expiresAt });
    } catch (error) {
      console.error("Failed to generate admin reset link.", error);
      res.status(500).json({ error: "Failed to generate reset link." });
    }
  },
);

app.post(
  "/api/admin/users/:userId/temporary-password",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const target = await getUserById(req.params.userId);
      const temporaryPassword = String(req.body.temporaryPassword || "");
      if (!target) {
        return res.status(404).json({ error: "User not found." });
      }
      if (temporaryPassword.length < 8) {
        return res.status(400).json({
          error: "Temporary password must be at least 8 characters.",
        });
      }

      await changePasswordForUser({
        userId: target.id,
        passwordHash: hashPassword(temporaryPassword),
      });
      await recordAdminAuditEvent({
        adminUserId: req.user.id,
        action: "admin.temp_password_set",
        targetUserId: target.id,
        targetType: "user",
        targetId: target.id,
      });
      await recordRequestUsage(req, "admin.temp_password_set", {
        userId: req.user.id,
        metadata: { targetUserId: target.id },
      });
      res.json({ ok: true });
    } catch (error) {
      console.error("Failed to set temporary password.", error);
      res.status(500).json({ error: "Failed to set temporary password." });
    }
  },
);

app.post(
  "/api/admin/users/:userId/invalidate-sessions",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const target = await getUserById(req.params.userId);
      if (!target) {
        return res.status(404).json({ error: "User not found." });
      }
      await deleteSessionsByUserId(target.id);
      await recordAdminAuditEvent({
        adminUserId: req.user.id,
        action: "admin.sessions_invalidated",
        targetUserId: target.id,
        targetType: "user",
        targetId: target.id,
      });
      await recordRequestUsage(req, "admin.sessions_invalidated", {
        userId: req.user.id,
        metadata: { targetUserId: target.id },
      });
      res.json({ ok: true });
    } catch (error) {
      console.error("Failed to invalidate sessions.", error);
      res.status(500).json({ error: "Failed to invalidate sessions." });
    }
  },
);

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

      await recordAdminAuditEvent({
        adminUserId: req.user.id,
        action: "admin.user_deleted",
        targetUserId: req.params.userId,
        targetType: "user",
        targetId: req.params.userId,
      });
      await recordRequestUsage(req, "admin.user_deleted", {
        userId: req.user.id,
        metadata: { targetUserId: req.params.userId },
      });

      res.json({ ok: true });
    } catch (error) {
      console.error("Failed to delete user.", error);
      res.status(500).json({ error: "Failed to delete user." });
    }
  },
);

app.get("/api/admin/analytics", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getAdminAnalytics(String(req.query.range || "7d")));
  } catch (error) {
    console.error("Failed to fetch admin analytics.", error);
    res.status(500).json({ error: "Failed to fetch admin analytics." });
  }
});

app.get("/api/admin/events", requireAuth, requireAdmin, async (req, res) => {
  try {
    const eventName =
      typeof req.query.eventName === "string"
        ? req.query.eventName.trim() || undefined
        : undefined;
    const userId =
      typeof req.query.userId === "string" ? req.query.userId.trim() || undefined : undefined;
    const rawRange = typeof req.query.range === "string" ? req.query.range : "7d";
    const rawSince = typeof req.query.since === "string" ? req.query.since.trim() : "";
    const sinceCandidate = rawSince || parseRangeStart(rawRange);
    const parsedSince = sinceCandidate
      ? (() => {
          const parsed = new Date(sinceCandidate);
          return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
        })()
      : undefined;
    const rawLimit = Number.parseInt(
      typeof req.query.limit === "string" ? req.query.limit : "120",
      10,
    );
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 120;

    const [events, users] = await Promise.all([
      listUsageEvents({
        since: parsedSince,
        limit,
        userId,
        eventName,
      }),
      listUsersForAdmin(),
    ]);

    const userById = new Map(users.map((user) => [user.id, user]));

    res.json({
      total: events.length,
      events: events.map((event) => {
        const user = event.userId ? userById.get(event.userId) : null;
        return {
          ...event,
          userEmail: user?.email || null,
          userName: user?.name || null,
        };
      }),
    });
  } catch (error) {
    console.error("Failed to fetch admin event log.", error);
    res.status(500).json({ error: "Failed to fetch admin event log." });
  }
});

app.get("/api/admin/library-endpoints", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ endpoints: buildLibraryEndpointRegistry() });
  } catch (error) {
    console.error("Failed to fetch library endpoint registry.", error);
    res.status(500).json({ error: "Failed to fetch library endpoints." });
  }
});

app.get("/api/admin/system", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [settings, aiStatus] = await Promise.all([
      getSystemSettings(),
      getEffectiveAiStatus(req.user),
    ]);
    res.json({ settings, aiStatus });
  } catch (error) {
    console.error("Failed to fetch admin system status.", error);
    res.status(500).json({ error: "Failed to fetch admin system status." });
  }
});

app.put("/api/admin/system", requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await updateSystemSettings(
      {
        aiEnabledOverride:
          req.body.aiEnabledOverride === true || req.body.aiEnabledOverride === false
            ? req.body.aiEnabledOverride
            : null,
        outboundApiCallsEnabled:
          req.body.outboundApiCallsEnabled === false ? false : true,
      },
      req.user.id,
    );
    await recordAdminAuditEvent({
      adminUserId: req.user.id,
      action: "admin.system_toggle_changed",
      targetType: "system",
      targetId: "runtime-settings",
      metadata: settings,
    });
    await recordRequestUsage(req, "admin.system_toggle_changed", {
      userId: req.user.id,
      metadata: settings,
    });
    res.json({
      settings,
      aiStatus: await getEffectiveAiStatus(req.user),
    });
  } catch (error) {
    console.error("Failed to update admin system status.", error);
    res.status(500).json({ error: "Failed to update admin system status." });
  }
});

app.get("/api/projects", requireAuth, async (req, res) => {
  try {
    const projects = await listProjectsByOwnerId(req.user.id);
    await recordRequestUsage(req, "projects.list_viewed");
    res.json(
      await Promise.all(
        projects.map((project) => enrichProject(project, req.user.id)),
      ),
    );
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

    await upsertContextItems(project.id, req.user.id, [
      {
        category: "project-basics",
        key: "project-name",
        label: "Project name",
        value: project.name,
        trustState: "confirmed",
        sourceType: "user",
      },
      {
        category: "objectives-outcomes",
        key: "objective",
        label: "Project objective",
        value: project.objective,
        trustState: project.objective ? "confirmed" : "proposed",
        sourceType: "user",
      },
      {
        category: "project-basics",
        key: "sponsor",
        label: "Project sponsor",
        value: project.sponsor,
        trustState: project.sponsor ? "confirmed" : "proposed",
        sourceType: "user",
      },
    ]);
    await recordActivity(
      project.id,
      req.user.id,
      "project.created",
      `Created ${project.name}.`,
    );
    await recordRequestUsage(req, "project.created", {
      projectId: project.id,
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

    await recordRequestUsage(req, "project.opened", {
      projectId: project.id,
    });
    res.json(await enrichProject(project, req.user.id));
  } catch (error) {
    console.error("Failed to fetch project.", error);
    res.status(500).json({ error: "Failed to fetch project." });
  }
});

app.post("/api/artifacts", requireAuth, async (req, res) => {
  try {
    const templateId = String(req.body.templateId || "").trim();
    const template = await getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ error: "Template not found." });
    }

    const artifact = await createArtifact({
      projectId: null,
      ownerId: req.user.id,
      templateId,
      title: String(req.body.title || template.title || "Untitled Artifact").trim(),
      fieldValues: req.body.fieldValues || {},
      templateVersion: template.version,
    });

    await setProvenance(
      artifact.id,
      Object.keys(artifact.fieldValues).map((fieldId) => ({
        fieldId,
        sourceType: "user-authored",
      })),
    );
    await recordRequestUsage(req, "artifact.unassigned_started", {
      artifactId: artifact.id,
      templateId,
    });

    res.status(201).json(await enrichArtifact(null, artifact, req.user.id));
  } catch (error) {
    console.error("Failed to create unassigned artifact.", error);
    res.status(500).json({ error: "Failed to create artifact." });
  }
});

app.get("/api/artifacts", requireAuth, async (req, res) => {
  try {
    const scope = String(req.query.scope || "unassigned").trim();
    if (scope !== "unassigned") {
      return res.status(400).json({ error: "Unsupported artifact scope." });
    }

    const artifacts = await listUnassignedArtifactsByOwnerId(req.user.id);
    await recordRequestUsage(req, "library.viewed");
    res.json({
      artifacts: await Promise.all(
        artifacts.map((artifact) => enrichArtifact(null, artifact, req.user.id)),
      ),
    });
  } catch (error) {
    console.error("Failed to list artifacts.", error);
    res.status(500).json({ error: "Failed to list artifacts." });
  }
});

app.get("/api/artifacts/:artifactId", requireAuth, async (req, res) => {
  try {
    const artifact = await getArtifactByIdAndOwnerId(
      req.params.artifactId,
      req.user.id,
    );

    if (!artifact) {
      return res.status(404).json({ error: "Artifact not found." });
    }

    await recordRequestUsage(req, "artifact.opened", {
      artifactId: artifact.id,
      projectId: artifact.projectId,
      templateId: artifact.templateId,
    });
    res.json(await enrichArtifact(artifact.projectId, artifact, req.user.id));
  } catch (error) {
    console.error("Failed to fetch artifact.", error);
    res.status(500).json({ error: "Failed to fetch artifact." });
  }
});

app.put("/api/artifacts/:artifactId", requireAuth, async (req, res) => {
  try {
    if (req.body.expectedRevision === undefined) {
      return res.status(400).json({
        error: "expectedRevision is required.",
        code: "EXPECTED_REVISION_REQUIRED",
      });
    }

    const result = await updateOwnedArtifact({
      artifactId: req.params.artifactId,
      ownerId: req.user.id,
      title: String(req.body.title || "Untitled Artifact").trim(),
      status: String(req.body.status || "draft").trim(),
      fieldValues: req.body.fieldValues || {},
      expectedRevision: req.body.expectedRevision,
      workflowStage: req.body.workflowStage,
    });

    if (!result.artifact) {
      if (result.stale) {
        return res.status(409).json({
          error: "The artifact changed in another session.",
          code: "STALE_ARTIFACT_REVISION",
          latestArtifact: await enrichArtifact(
            result.latestArtifact.projectId,
            result.latestArtifact,
            req.user.id,
          ),
        });
      }
      return res.status(404).json({ error: "Artifact not found." });
    }

    await setProvenance(
      result.artifact.id,
      Object.keys(req.body.fieldValues || {}).map((fieldId) => ({
        fieldId,
        sourceType: "user-edited",
      })),
    );
    await recordRequestUsage(req, "artifact.updated", {
      artifactId: result.artifact.id,
      projectId: result.artifact.projectId,
      templateId: result.artifact.templateId,
    });

    res.json(await enrichArtifact(result.artifact.projectId, result.artifact, req.user.id));
  } catch (error) {
    console.error("Failed to update artifact.", error);
    res.status(500).json({ error: "Failed to update artifact." });
  }
});

app.post("/api/artifacts/:artifactId/assign", requireAuth, async (req, res) => {
  try {
    const projectId = String(req.body.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "Project is required." });
    }

    const result = await assignArtifactToProject({
      artifactId: req.params.artifactId,
      projectId,
      ownerId: req.user.id,
    });

    if (!result.projectFound) {
      return res.status(404).json({ error: "Project not found." });
    }
    if (!result.artifactFound) {
      return res.status(404).json({ error: "Artifact not found." });
    }
    if (result.alreadyAssigned) {
      return res.status(409).json({ error: "Artifact is already assigned to a project." });
    }

    await recordActivity(
      projectId,
      req.user.id,
      "artifact.assigned",
      `Assigned ${result.artifact.title}.`,
      { artifactId: result.artifact.id, templateId: result.artifact.templateId },
    );
    await recordRequestUsage(req, "artifact.assigned", {
      artifactId: result.artifact.id,
      projectId,
      templateId: result.artifact.templateId,
    });

    res.json({
      artifact: await enrichArtifact(projectId, result.artifact, req.user.id),
    });
  } catch (error) {
    console.error("Failed to assign artifact.", error);
    res.status(500).json({ error: "Failed to assign artifact." });
  }
});

app.get("/api/artifacts/:artifactId/export.md", requireAuth, async (req, res) => {
  try {
    const artifact = await getArtifactByIdAndOwnerId(
      req.params.artifactId,
      req.user.id,
    );

    if (!artifact) {
      return res.status(404).json({ error: "Artifact not found." });
    }

    const template = await getTemplate(
      artifact.templateId,
      artifact.templateVersion,
    );

    if (!template) {
      return res.status(404).json({ error: "Template not found." });
    }

    const project = artifact.projectId
      ? await getProjectByIdAndOwnerId(artifact.projectId, req.user.id)
      : null;
    const markdown = renderArtifactMarkdown({ artifact, project, template });
    const filename = `${slugifyFilename(
      project?.name || "unassigned",
    )}-${slugifyFilename(artifact.title)}.md`;
    await recordExport(artifact.id, null, "markdown", req.user.id);
    await recordRequestUsage(req, "artifact.exported", {
      artifactId: artifact.id,
      projectId: artifact.projectId,
      templateId: artifact.templateId,
      metadata: { format: "markdown" },
    });

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
});

// Create Artifact Draft
app.post(
  "/api/projects/:projectId/artifacts",
  requireAuth,
  async (req, res) => {
    try {
      const templateId = String(req.body.templateId || "").trim();
      const template = await getTemplate(templateId);
      if (!template) {
        return res.status(404).json({ error: "Template not found." });
      }
      const artifact = await createArtifact({
        projectId: req.params.projectId,
        ownerId: req.user.id,
        templateId,
        title: String(req.body.title || "Untitled Artifact").trim(),
        fieldValues: req.body.fieldValues || {},
        templateVersion: template.version,
      });

      if (!artifact) {
        return res.status(404).json({ error: "Project not found." });
      }

      await setProvenance(
        artifact.id,
        Object.keys(artifact.fieldValues).map((fieldId) => ({
          fieldId,
          sourceType: "user-authored",
        })),
      );
      await recordActivity(
        req.params.projectId,
        req.user.id,
        "artifact.created",
        `Created ${artifact.title}.`,
        { artifactId: artifact.id, templateId },
      );
      await recordRequestUsage(req, "artifact.created", {
        artifactId: artifact.id,
        projectId: req.params.projectId,
        templateId,
      });
      res
        .status(201)
        .json(await enrichArtifact(req.params.projectId, artifact, req.user.id));
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
      if (req.body.expectedRevision === undefined) {
        return res.status(400).json({
          error: "expectedRevision is required.",
          code: "EXPECTED_REVISION_REQUIRED",
        });
      }

      const result = await updateArtifact({
        projectId: req.params.projectId,
        artifactId: req.params.artifactId,
        ownerId: req.user.id,
        title: String(req.body.title || "Untitled Artifact").trim(),
        status: String(req.body.status || "draft").trim(),
        fieldValues: req.body.fieldValues || {},
        expectedRevision: req.body.expectedRevision,
        workflowStage: req.body.workflowStage,
      });

      if (!result.projectFound) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (!result.artifact) {
        if (result.stale) {
          return res.status(409).json({
            error: "The artifact changed in another session.",
            code: "STALE_ARTIFACT_REVISION",
            latestArtifact: await enrichArtifact(
              req.params.projectId,
              result.latestArtifact,
              req.user.id,
            ),
          });
        }
        return res.status(404).json({ error: "Artifact not found." });
      }

      await setProvenance(
        result.artifact.id,
        Object.keys(req.body.fieldValues || {}).map((fieldId) => ({
          fieldId,
          sourceType: "user-edited",
        })),
      );
      await recordRequestUsage(req, "artifact.updated", {
        artifactId: result.artifact.id,
        projectId: req.params.projectId,
        templateId: result.artifact.templateId,
      });
      res.json(
        await enrichArtifact(
          req.params.projectId,
          result.artifact,
          req.user.id,
        ),
      );
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

      const template = await getTemplate(
        artifact.templateId,
        artifact.templateVersion,
      );

      if (!template) {
        return res.status(404).json({ error: "Template not found." });
      }

      const versions = await listVersions(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      const requestedVersion = Number(req.query.version);
      const version = Number.isInteger(requestedVersion)
        ? versions.find((item) => item.versionNumber === requestedVersion) || null
        : versions[0] || null;
      if (Number.isInteger(requestedVersion) && !version) {
        return res.status(404).json({ error: "Artifact version not found." });
      }
      const exportArtifact = version?.snapshot?.artifact || artifact;
      const exportTemplate = version?.snapshot?.template || template;
      const markdown = renderVersionedMarkdown({
        artifact: exportArtifact,
        project,
        template: exportTemplate,
        version,
      });
      const filename = `${slugifyFilename(project.name)}-${slugifyFilename(
        exportArtifact.title,
      )}.md`;
      await recordExport(
        artifact.id,
        version?.id,
        "markdown",
        req.user.id,
      );
      await recordRequestUsage(req, "artifact.exported", {
        artifactId: artifact.id,
        projectId: req.params.projectId,
        templateId: artifact.templateId,
        metadata: { format: "markdown", version: version?.versionNumber || null },
      });

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
    await recordRequestUsage(req, "library.viewed");
    res.json(await listTemplates());
  } catch (error) {
    console.error("Failed to read template definitions.", error);
    res.status(500).json({ error: "Failed to read template definitions." });
  }
});

// API Route: Fetch functional breakdown fields matrix for selected workspace index canvas
app.get("/api/templates/:id", async (req, res) => {
  try {
    const template = await getTemplate(req.params.id, req.query.version);

    if (!template) {
      return res
        .status(404)
        .json({ error: "Template workspace matrix target layout not found." });
    }
    await recordRequestUsage(req, "library.template_opened", {
      templateId: template.id,
    });
    res.json(template);
  } catch (error) {
    console.error("Failed to fetch template detail.", error);
    res
      .status(500)
      .json({ error: "Failed to fetch template detail structural breakdown." });
  }
});

app.use("/api", createPhase1Router(requireAuth));

app.get("/{*path}", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }

  res.sendFile(path.join(__dirname, "dist", "index.html"), (error) => {
    if (error) next();
  });
});

async function startServer(port = PORT) {
  await initDatabase();
  await ensureBootstrapAdminReady();

  const server = app.listen(port, () => {
    console.log(`ArtifactHub running on port ${port}`);
  });

  // Keep an explicit strong reference to the listener for local dev shells
  // that otherwise appear to drop back to the prompt immediately.
  server.ref?.();
  return server;
}

const entryArg = process.argv[1];

if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  startServer()
    .then((server) => {
      // Keep direct local runs attached in environments where the listener
      // alone does not reliably hold the Node process open.
      const keepAlive = setInterval(() => {}, 60_000);

      function shutdown(signal) {
        server.close(() => {
          clearInterval(keepAlive);
          process.exit(signal === "SIGINT" ? 0 : 1);
        });
      }

      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((error) => {
      console.error("Failed to initialize persistence layer.", error);
      process.exit(1);
    });
}

export { app, startServer };
