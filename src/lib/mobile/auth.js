import crypto from "node:crypto";

const MAX_SKEW_MS = 5 * 60 * 1000;

function getConfig() {
  const keyId = process.env.MOBILE_API_KEY_ID || "";
  const secret = process.env.MOBILE_API_SIGNING_SECRET || "";
  return { keyId, secret };
}

function buildSigningPayload(request, timestamp) {
  const url = new URL(request.url);
  return [request.method.toUpperCase(), url.pathname, url.search, timestamp].join("\n");
}

function toTimestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  // Allow both unix seconds and milliseconds to reduce mobile client friction.
  if (Math.abs(numeric) < 1_000_000_000_000) return numeric * 1000;
  return numeric;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a || "", "utf8");
  const right = Buffer.from(b || "", "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function signMobileRequest({ method, path, search = "", timestamp, secret }) {
  const payload = [method.toUpperCase(), path, search, String(timestamp)].join("\n");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Checks the x-mobile-key / x-mobile-ts / x-mobile-sign headers. `reason` is a stable code for
 * metrics (src/lib/mobile/requestSigning.server.js counts them): "skipped" when signing is not
 * configured, "verified", or one of "missing_headers" | "invalid_key" | "invalid_timestamp" |
 * "expired" | "invalid_signature". `config`/`now` default to the environment and the clock.
 */
export function verifyMobileRequest(request, { config = getConfig(), now = Date.now() } = {}) {
  const { keyId, secret } = config;

  // Keep local development simple if signing is not configured.
  if (!keyId || !secret) {
    return { ok: true, reason: "skipped" };
  }

  const incomingKey = request.headers.get("x-mobile-key") || "";
  const incomingSignature = request.headers.get("x-mobile-sign") || "";
  const timestampValue = request.headers.get("x-mobile-ts") || "";

  if (!incomingKey || !incomingSignature || !timestampValue) {
    return { ok: false, reason: "missing_headers", error: "Missing mobile signature headers." };
  }

  if (!timingSafeEqual(incomingKey, keyId)) {
    return { ok: false, reason: "invalid_key", error: "Invalid mobile key." };
  }

  const timestampMs = toTimestampMs(timestampValue);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid_timestamp", error: "Invalid mobile timestamp." };
  }

  if (Math.abs(now - timestampMs) > MAX_SKEW_MS) {
    return { ok: false, reason: "expired", error: "Mobile signature expired." };
  }

  const payload = buildSigningPayload(request, timestampValue);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (!timingSafeEqual(incomingSignature, expected)) {
    return { ok: false, reason: "invalid_signature", error: "Invalid mobile signature." };
  }

  return { ok: true, reason: "verified" };
}
