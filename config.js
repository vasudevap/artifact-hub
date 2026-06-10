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

const config = {
  port: Number(process.env.PORT) || 3000,
  publicUrl: String(process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  adminEmails: parseEmailSet(process.env.ADMIN_EMAILS),
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
