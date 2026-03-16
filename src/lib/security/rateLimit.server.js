import { NextResponse } from "next/server";

const WINDOW_BUCKETS = new Map();
const CLEANUP_INTERVAL = 400;
const MAX_BUCKETS = 50_000;

let hitCount = 0;

function nowMs() {
  return Date.now();
}

function normalizeIdentifier(value, fallback = "anonymous") {
  const source = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .slice(0, 160);
  return source || fallback;
}

export function resolveRequestIp(request) {
  const forwardedFor = String(request?.headers?.get("x-forwarded-for") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (forwardedFor.length > 0) return forwardedFor[0];
  const realIp = String(request?.headers?.get("x-real-ip") || "").trim();
  if (realIp) return realIp;
  const cfIp = String(request?.headers?.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;
  return "";
}

function cleanupExpiredBuckets(now) {
  for (const [key, value] of WINDOW_BUCKETS.entries()) {
    if (!value || Number(value.resetAt || 0) <= now) {
      WINDOW_BUCKETS.delete(key);
    }
  }
}

export function checkRateLimit({
  scope,
  identifier,
  limit,
  windowMs,
  weight = 1,
}) {
  const maxHits = Math.max(1, Math.floor(Number(limit) || 1));
  const windowDurationMs = Math.max(1_000, Math.floor(Number(windowMs) || 60_000));
  const itemWeight = Math.max(1, Math.floor(Number(weight) || 1));
  const now = nowMs();
  const windowStart = now - (now % windowDurationMs);
  const resetAt = windowStart + windowDurationMs;
  const safeScope = normalizeIdentifier(scope, "global");
  const safeIdentifier = normalizeIdentifier(identifier, "anonymous");
  const key = `${safeScope}:${safeIdentifier}:${windowStart}`;

  const current = WINDOW_BUCKETS.get(key) || { hits: 0, resetAt };
  const nextHits = current.hits + itemWeight;
  const allowed = nextHits <= maxHits;

  WINDOW_BUCKETS.set(key, {
    hits: nextHits,
    resetAt,
  });

  hitCount += 1;
  if (WINDOW_BUCKETS.size > MAX_BUCKETS || hitCount % CLEANUP_INTERVAL === 0) {
    cleanupExpiredBuckets(now);
  }

  const retryAfterSeconds = Math.max(0, Math.ceil((resetAt - now) / 1000));
  return {
    allowed,
    limit: maxHits,
    remaining: Math.max(0, maxHits - nextHits),
    retryAfterSeconds,
    resetAtIso: new Date(resetAt).toISOString(),
  };
}

export function createRateLimitHeaders(rateLimitState) {
  return {
    "Retry-After": String(Math.max(0, Number(rateLimitState?.retryAfterSeconds || 0))),
    "X-RateLimit-Limit": String(Math.max(0, Number(rateLimitState?.limit || 0))),
    "X-RateLimit-Remaining": String(Math.max(0, Number(rateLimitState?.remaining || 0))),
    "X-RateLimit-Reset": String(rateLimitState?.resetAtIso || ""),
  };
}

export function createRateLimitResponse(
  message = "Too many requests.",
  rateLimitState
) {
  return NextResponse.json(
    {
      error: String(message || "Too many requests."),
    },
    {
      status: 429,
      headers: createRateLimitHeaders(rateLimitState),
    }
  );
}
