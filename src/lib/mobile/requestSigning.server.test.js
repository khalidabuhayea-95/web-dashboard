/**
 * Mobile request-signature verification, report-only by default (production audit L-26 / REL-23).
 * Run: node --import tsx --test src/lib/mobile/requestSigning.server.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { signMobileRequest } from "@/lib/mobile/auth";
import {
  checkMobileRequestSignature,
  getMobileRequestSigningCounters,
  resetMobileRequestSigningStateForTests,
  resolveMobileRequestSigningMode,
} from "@/lib/mobile/requestSigning.server";
import { proxy } from "@/proxy";

const CONFIG = { keyId: "test-key-id", secret: "test-signing-secret" };
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

function signedRequest(path, { keyId = CONFIG.keyId, secret = CONFIG.secret, timestamp = NOW, method = "GET" } = {}) {
  const url = new URL(`http://localhost${path}`);
  const signature = signMobileRequest({ method, path: url.pathname, search: url.search, timestamp, secret });
  return new NextRequest(url, {
    method,
    headers: { "x-mobile-key": keyId, "x-mobile-ts": String(timestamp), "x-mobile-sign": signature },
  });
}

function captureConsole(method) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  return { calls, restore: () => (console[method] = original) };
}

test.beforeEach(() => {
  resetMobileRequestSigningStateForTests();
  delete process.env.MOBILE_REQUEST_SIGNING_MODE;
  delete process.env.MOBILE_API_KEY_ID;
  delete process.env.MOBILE_API_SIGNING_SECRET;
});

test("mode defaults to report-only; only off/report/enforce are accepted", () => {
  assert.equal(resolveMobileRequestSigningMode({}), "report");
  assert.equal(resolveMobileRequestSigningMode({ MOBILE_REQUEST_SIGNING_MODE: "ENFORCE" }), "enforce");
  assert.equal(resolveMobileRequestSigningMode({ MOBILE_REQUEST_SIGNING_MODE: "off" }), "off");
  assert.equal(resolveMobileRequestSigningMode({ MOBILE_REQUEST_SIGNING_MODE: "yes please" }), "report");
});

test("every outcome is classified and counted", () => {
  const check = (request, options = {}) =>
    checkMobileRequestSignature(request, { mode: "report", now: NOW, config: CONFIG, ...options }).outcome;
  assert.equal(check(signedRequest("/api/mobile/templates?query=%D8%B1&page=1")), "verified");
  assert.equal(check(new NextRequest("http://localhost/api/mobile/templates")), "missing_headers");
  assert.equal(check(signedRequest("/api/mobile/templates", { keyId: "other-key" })), "invalid_key");
  assert.equal(check(signedRequest("/api/mobile/templates", { timestamp: NOW - 10 * 60_000 })), "expired");
  assert.equal(check(signedRequest("/api/mobile/templates", { secret: "wrong-secret" })), "invalid_signature");
  // Unix SECONDS are accepted too.
  assert.equal(check(signedRequest("/api/mobile/fonts", { timestamp: Math.floor(NOW / 1000) })), "verified");
  assert.equal(
    check(new NextRequest("http://localhost/api/mobile/templates"), { config: { keyId: "", secret: "" } }),
    "not_configured"
  );
  assert.deepEqual(getMobileRequestSigningCounters(), {
    verified: 2,
    not_configured: 1,
    missing_headers: 1,
    invalid_key: 1,
    invalid_timestamp: 0,
    expired: 1,
    invalid_signature: 1,
  });
});

test("report-only never rejects, and logs each mismatch kind at most once a minute with counts", () => {
  const warn = captureConsole("warn");
  try {
    for (let index = 0; index < 50; index += 1) {
      const result = checkMobileRequestSignature(new NextRequest("http://localhost/api/mobile/templates"), {
        mode: "report",
        now: NOW + index * 1000,
        config: CONFIG,
      });
      assert.equal(result.reject, false);
    }
    assert.equal(warn.calls.length, 1, "50 unsigned requests in 50 s → one log line");
    const later = checkMobileRequestSignature(new NextRequest("http://localhost/api/mobile/templates"), {
      mode: "report",
      now: NOW + 61_000,
      config: CONFIG,
    });
    assert.equal(later.reject, false);
    assert.equal(warn.calls.length, 2);
    assert.match(JSON.stringify(warn.calls[1]), /"count":51/);
    assert.match(JSON.stringify(warn.calls[1]), /"sinceLastReport":50/);
  } finally {
    warn.restore();
  }
});

test("enforce rejects failures but not verified or unconfigured requests; OPTIONS and the docs are exempt", () => {
  const enforce = (request, config = CONFIG) =>
    checkMobileRequestSignature(request, { mode: "enforce", now: NOW, config }).reject;
  const warn = captureConsole("warn");
  try {
    assert.equal(enforce(new NextRequest("http://localhost/api/mobile/templates")), true);
    assert.equal(enforce(signedRequest("/api/mobile/templates", { secret: "wrong" })), true);
    assert.equal(enforce(signedRequest("/api/mobile/templates")), false);
    assert.equal(enforce(new NextRequest("http://localhost/api/mobile/templates"), { keyId: "", secret: "" }), false);
    assert.equal(enforce(new NextRequest("http://localhost/api/mobile/templates", { method: "OPTIONS" })), false);
    assert.equal(enforce(new NextRequest("http://localhost/api/mobile/openapi")), false);
  } finally {
    warn.restore();
  }
});

test("the proxy: report mode lets an unsigned app request through; enforce answers 401", async () => {
  process.env.MOBILE_API_KEY_ID = CONFIG.keyId;
  process.env.MOBILE_API_SIGNING_SECRET = CONFIG.secret;
  const quiet = [captureConsole("log"), captureConsole("warn"), captureConsole("info")];
  try {
    const reported = await proxy(new NextRequest("http://localhost/api/mobile/templates/taxonomy"));
    assert.equal(reported.headers.get("x-middleware-next"), "1", "passed through to the route");

    process.env.MOBILE_REQUEST_SIGNING_MODE = "enforce";
    const rejected = await proxy(new NextRequest("http://localhost/api/mobile/templates/taxonomy"));
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).code, "invalid_request_signature");
    assert.equal(rejected.headers.get("cache-control"), "no-store");

    const signed = await proxy(signedRequest("/api/mobile/templates/taxonomy", { timestamp: Date.now() }));
    assert.equal(signed.headers.get("x-middleware-next"), "1");

    const dashboard = await proxy(new NextRequest("http://localhost/api/templates"));
    assert.equal(dashboard.headers.get("x-middleware-next"), "1", "non-mobile routes are never checked");
  } finally {
    quiet.forEach((spy) => spy.restore());
  }
});
