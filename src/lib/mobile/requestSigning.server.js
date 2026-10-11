import { NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import { verifyMobileRequest } from "@/lib/mobile/auth";

/**
 * Server-side check of the mobile request signature (production audit L-26 / REL-23).
 *
 * The apps can HMAC-sign requests (x-mobile-key / x-mobile-ts / x-mobile-sign, see
 * src/lib/mobile/auth.js), but nothing on the server ever verified them. This verifies every
 * /api/mobile/* request in src/proxy.js and, by default, only REPORTS: mismatches are counted per
 * outcome and logged (rate-limited), never rejected — so the real share of unsigned / mis-signed
 * traffic is known before anything is enforced.
 *
 * Mode — env MOBILE_REQUEST_SIGNING_MODE:
 *   report  (default) verify, count, log; never reject.
 *   enforce reject a failed signature with 401 `invalid_request_signature`.
 *   off     skip the check entirely.
 * Signing itself needs MOBILE_API_KEY_ID + MOBILE_API_SIGNING_SECRET; without them every request
 * counts as `not_configured` and enforce mode stays open (it cannot verify anything).
 *
 * ★Flip to enforce only when the report shows ~0 unsigned/invalid requests from current builds:
 * today the app does NOT attach the headers at all (createSignedHeaders in the app's
 * core/network/MobileRequestSigning.kt has no caller) and iOS ships an empty secret, so enforcing
 * now would reject every app request. A client secret is extractable anyway; App Check / Play
 * Integrity / App Attest is the stronger long-term gate for the paid AI routes.
 */

const logger = createLogger("api.mobile.request-signing");

export const MOBILE_REQUEST_SIGNING_MODES = Object.freeze(["off", "report", "enforce"]);
const DEFAULT_MODE = "report";
// A mismatch kind is logged on its first occurrence, then at most once per window, with counts.
const REPORT_INTERVAL_MS = 60_000;
// Public documentation, readable without the app.
const EXEMPT_PATHS = new Set(["/api/mobile/openapi"]);

const OUTCOMES = [
  "verified",
  "not_configured",
  "missing_headers",
  "invalid_key",
  "invalid_timestamp",
  "expired",
  "invalid_signature",
];

// Per process, on globalThis so a dev-server module reload keeps the counts.
const globalState = globalThis;
const state = (globalState.__nayrozMobileRequestSigning ??= {
  counters: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
  lastLoggedAt: {},
  sinceLastLog: {},
});

export function resolveMobileRequestSigningMode(env = process.env) {
  const raw = String(env?.MOBILE_REQUEST_SIGNING_MODE || "").trim().toLowerCase();
  return MOBILE_REQUEST_SIGNING_MODES.includes(raw) ? raw : DEFAULT_MODE;
}

/** Snapshot of the per-outcome counters since this process started. */
export function getMobileRequestSigningCounters() {
  return { ...state.counters };
}

/** Test hook. */
export function resetMobileRequestSigningStateForTests() {
  for (const outcome of OUTCOMES) state.counters[outcome] = 0;
  state.lastLoggedAt = {};
  state.sinceLastLog = {};
}

function reportOutcome(outcome, request, mode, now) {
  if (outcome === "verified") return;
  state.sinceLastLog[outcome] = (state.sinceLastLog[outcome] || 0) + 1;
  const last = state.lastLoggedAt[outcome] || 0;
  if (last && now - last < REPORT_INTERVAL_MS) return;
  let path = "";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "";
  }
  const context = {
    mode,
    outcome,
    count: state.counters[outcome],
    sinceLastReport: state.sinceLastLog[outcome],
    counters: getMobileRequestSigningCounters(),
    sample: { method: String(request.method || "").toUpperCase(), path },
  };
  if (outcome === "not_configured") {
    logger.info("Mobile request signing is not configured (MOBILE_API_KEY_ID / MOBILE_API_SIGNING_SECRET)", context);
  } else {
    logger.warn(
      mode === "enforce"
        ? "Mobile request signature rejected"
        : "Mobile request signature mismatch (report-only, not rejected)",
      context
    );
  }
  state.lastLoggedAt[outcome] = now;
  state.sinceLastLog[outcome] = 0;
}

/**
 * @param {Request} request
 * @param {{ mode?: string, now?: number, config?: { keyId: string, secret: string } }} [options]
 * @returns {{ mode: string, outcome: string, reject: boolean }}
 */
export function checkMobileRequestSignature(request, options = {}) {
  const mode = options.mode || resolveMobileRequestSigningMode();
  const now = options.now ?? Date.now();
  let path = "";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "";
  }
  if (mode === "off" || String(request.method || "").toUpperCase() === "OPTIONS" || EXEMPT_PATHS.has(path)) {
    return { mode, outcome: "skipped", reject: false };
  }

  const result = verifyMobileRequest(request, {
    now,
    ...(options.config ? { config: options.config } : {}),
  });
  const outcome = result.ok ? (result.reason === "skipped" ? "not_configured" : "verified") : result.reason;
  state.counters[outcome] = (state.counters[outcome] || 0) + 1;
  reportOutcome(outcome, request, mode, now);

  // Without a configured secret nothing can be verified, so even enforce mode lets it through.
  const reject = mode === "enforce" && outcome !== "verified" && outcome !== "not_configured";
  return { mode, outcome, reject };
}

export function invalidRequestSignatureResponse() {
  return NextResponse.json(
    { error: "The request signature is missing or invalid.", code: "invalid_request_signature" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}
