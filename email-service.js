import { config } from "./config.js";

function resetEmailHtml({ resetUrl, expiresAt }) {
  const escapedUrl = resetUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `
    <p>We received a request to reset your ArtifactHub password.</p>
    <p><a href="${escapedUrl}">Reset your password</a></p>
    <p>This link expires at ${expiresAt}. If you did not request a reset, you can ignore this email.</p>
  `.trim();
}

function resetEmailText({ resetUrl, expiresAt }) {
  return [
    "We received a request to reset your ArtifactHub password.",
    "",
    `Reset your password: ${resetUrl}`,
    "",
    `This link expires at ${expiresAt}. If you did not request a reset, you can ignore this email.`,
  ].join("\n");
}

function feedbackEmailHtml({ user, category, subject, message }) {
  return `
    <p><strong>ArtifactHub feedback received.</strong></p>
    <p><strong>From:</strong> ${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;</p>
    <p><strong>Category:</strong> ${escapeHtml(category)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <hr />
    <p>${escapeHtml(message).replace(/\n/g, "<br />")}</p>
  `.trim();
}

function feedbackEmailText({ user, category, subject, message }) {
  return [
    "ArtifactHub feedback received.",
    "",
    `From: ${user.name} <${user.email}>`,
    `Category: ${category}`,
    `Subject: ${subject}`,
    "",
    message,
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendResendEmail({ to, subject, html, text, replyTo }) {
  if (!config.email.resendApiKey || !config.email.from) {
    return { sent: false, reason: "RESEND_NOT_CONFIGURED" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.email.from,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend email failed with ${response.status}: ${body}`);
  }

  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = null;
  }

  return {
    sent: true,
    provider: "resend",
    providerMessageId: payload?.id || null,
  };
}

async function sendPasswordResetEmail({ to, resetUrl, expiresAt }) {
  const subject = "Reset your ArtifactHub password";
  const html = resetEmailHtml({ resetUrl, expiresAt });
  const text = resetEmailText({ resetUrl, expiresAt });

  if (config.email.provider === "resend") {
    return sendResendEmail({ to, subject, html, text });
  }

  if (config.email.provider === "console") {
    if (process.env.NODE_ENV === "production") {
      return { sent: false, reason: "CONSOLE_EMAIL_BLOCKED_IN_PRODUCTION" };
    }
    console.log(`[ArtifactHub email:password-reset] to=${to} resetUrl=${resetUrl}`);
    return { sent: true, provider: "console" };
  }

  if (config.email.provider === "test") {
    if (process.env.NODE_ENV !== "test") {
      return { sent: false, reason: "TEST_EMAIL_BLOCKED_OUTSIDE_TEST" };
    }
    return { sent: true, provider: "test" };
  }

  return { sent: false, reason: "EMAIL_PROVIDER_DISABLED" };
}

async function sendFeedbackEmail({ user, category, subject, message }) {
  const emailSubject = `[ArtifactHub feedback] ${subject}`;
  const html = feedbackEmailHtml({ user, category, subject, message });
  const text = feedbackEmailText({ user, category, subject, message });

  if (config.email.provider === "resend") {
    return sendResendEmail({
      to: config.email.feedbackTo,
      subject: emailSubject,
      html,
      text,
      replyTo: user.email,
    });
  }

  if (config.email.provider === "console") {
    if (process.env.NODE_ENV === "production") {
      return { sent: false, reason: "CONSOLE_EMAIL_BLOCKED_IN_PRODUCTION" };
    }
    console.log(`[ArtifactHub email:feedback] to=${config.email.feedbackTo}`);
    console.log(text);
    return { sent: true, provider: "console" };
  }

  if (config.email.provider === "test") {
    if (process.env.NODE_ENV !== "test") {
      return { sent: false, reason: "TEST_EMAIL_BLOCKED_OUTSIDE_TEST" };
    }
    return { sent: true, provider: "test" };
  }

  return { sent: false, reason: "EMAIL_PROVIDER_DISABLED" };
}

export { sendFeedbackEmail, sendPasswordResetEmail };
