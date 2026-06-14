import "./src/server/load-env.js";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseEmailSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const bootstrapAdminEmail = "prashant@grafley.com";
const adminEmails = parseEmailSet(process.env.ADMIN_EMAILS);
adminEmails.add(bootstrapAdminEmail);
const emailProvider = String(
  process.env.EMAIL_PROVIDER || (process.env.NODE_ENV === "production" ? "disabled" : "console"),
)
  .trim()
  .toLowerCase();

const config = {
  port: Number(process.env.PORT) || 3000,
  publicUrl: String(process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  bootstrapAdminEmail,
  bootstrapAdminPassword: "admin4Artifacthub!",
  adminEmails,
  ai: {
    enabled: parseBoolean(process.env.AI_FEATURE_ENABLED),
    betaEmails: parseEmailSet(process.env.AI_BETA_EMAILS),
    provider: String(process.env.AI_PROVIDER || "fake").trim().toLowerCase(),
    model: String(process.env.OPENAI_MODEL || "gpt-5.5").trim(),
    reasoningEffort: String(
      process.env.OPENAI_REASONING_EFFORT || "medium",
    ).trim(),
    maxMessageCharacters: 8000,
    timeoutMs: 45000,
    turnsPerHour: 30,
    retries: 1,
  },
  email: {
    provider: emailProvider,
    from: String(process.env.EMAIL_FROM || "").trim(),
    resendApiKey: String(process.env.RESEND_API_KEY || "").trim(),
  },
  rateLimits: {
    authWindowMs: parseInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    loginMaxAttempts: parseInteger(process.env.LOGIN_RATE_LIMIT_MAX, 20),
    signupMaxAttempts: parseInteger(process.env.SIGNUP_RATE_LIMIT_MAX, 10),
    passwordResetRequestMaxAttempts: parseInteger(
      process.env.PASSWORD_RESET_REQUEST_RATE_LIMIT_MAX,
      5,
    ),
    passwordResetConfirmMaxAttempts: parseInteger(
      process.env.PASSWORD_RESET_CONFIRM_RATE_LIMIT_MAX,
      10,
    ),
  },
};

function getFeatureAvailability(user) {
  const email = normalizeEmail(user?.email);
  const allowlisted =
    config.ai.betaEmails.size === 0 || config.ai.betaEmails.has(email);
  const aiAssistant = config.ai.enabled && allowlisted;

  return {
    aiAssistant,
    reviewWorkflow: true,
    docxExport: true,
  };
}

export { config, getFeatureAvailability, normalizeEmail, parseBoolean };
