import crypto from "crypto";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");

  return (
    stored.length === candidate.length &&
    crypto.timingSafeEqual(stored, candidate)
  );
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export { createSessionToken, hashPassword, verifyPassword };
