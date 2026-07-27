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
  // Prefer headers set by trusted infrastructure (Cloudflare / the reverse proxy)
  // over the client-controlled X-Forwarded-For. A client can forge X-Forwarded-For
  // to mint a fresh rate-limit bucket per request; cf-connecting-ip / x-real-ip are
  // overwritten by the edge and cannot be spoofed by the origin caller.
  const cfIp = String(request?.headers?.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;
  const realIp = String(request?.headers?.get("x-real-ip") || "").trim();
  if (realIp) return realIp;
  const forwardedFor = String(request?.headers?.get("x-forwarded-for") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  // Fall back to the last hop (added by the nearest proxy) rather than the first
  // (client-supplied) entry when only X-Forwarded-For is available.
  if (forwardedFor.length > 0) return forwardedFor[forwardedFor.length - 1];
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

/**
 * Convenience guard for public/unauthenticated routes: rate-limits by client IP
 * and returns a ready-to-return 429 Response when the limit is exceeded, or null
 * when the request is allowed.
 *
 *   const limited = enforceIpRateLimit(request, { scope: "api:mobile:templates" });
 *   if (limited) return limited;
 *
 * @param {Request} request
 * @param {{ scope?: string, limit?: number, windowMs?: number, message?: string }} [options]
 * @returns {import("next/server").NextResponse | null}
 */
export function enforceIpRateLimit(
  request,
  { scope, limit = 120, windowMs = 60_000, message } = {}
) {
  const rateLimit = checkRateLimit({
    scope: scope || "api:public",
    identifier: resolveRequestIp(request) || "anonymous",
    limit,
    windowMs,
  });
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      message || "Too many requests. Please retry shortly.",
      rateLimit
    );
  }
  return null;
}
