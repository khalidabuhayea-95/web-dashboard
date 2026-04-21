import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

function getTokenSecret() {
  const secret =
    process.env.CANVA_IMPORT_TOKEN_SECRET ||
    process.env.DATABASE_URL;
  if (!secret) {
    throw new Error("Missing token secret.");
  }
  return secret;
}

function signPayload(payloadSegment) {
  const secret = getTokenSecret();
  const signature = createHmac("sha256", secret).update(payloadSegment).digest("base64url");
  return signature;
}

function safeEqualString(a, b) {
  const aBuffer = Buffer.from(String(a || ""));
  const bBuffer = Buffer.from(String(b || ""));
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function createCanvaImportToken(userId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!userId) {
    throw new Error("Cannot create token without user id.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(userId),
    iat: nowSec,
    exp: nowSec + Math.max(60, Math.floor(Number(ttlSeconds) || DEFAULT_TTL_SECONDS)),
  };

  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const signatureSegment = signPayload(payloadSegment);
  const token = `${TOKEN_VERSION}.${payloadSegment}.${signatureSegment}`;
  const expiresAt = new Date(payload.exp * 1000).toISOString();

  return { token, expiresAt };
}

export function verifyCanvaImportToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing token." };
  }

  const [version, payloadSegment, signatureSegment] = token.split(".");
  if (version !== TOKEN_VERSION || !payloadSegment || !signatureSegment) {
    return { valid: false, reason: "Invalid token format." };
  }

  const expectedSignature = signPayload(payloadSegment);
  if (!safeEqualString(signatureSegment, expectedSignature)) {
    return { valid: false, reason: "Invalid token signature." };
  }

  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(payloadSegment).toString("utf8"));
  } catch (_error) {
    return { valid: false, reason: "Invalid token payload." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Number(payload?.exp);
  const sub = String(payload?.sub || "");
  if (!sub) {
    return { valid: false, reason: "Token is missing subject." };
  }
  if (!Number.isFinite(exp) || exp <= nowSec) {
    return { valid: false, reason: "Token has expired." };
  }

  return {
    valid: true,
    userId: sub,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
