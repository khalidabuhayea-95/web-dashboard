import assert from "node:assert/strict";
import test from "node:test";

import { resolveUserTier } from "./subscriptionTier.server";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

test("free and missing users resolve to free", () => {
  assert.equal(resolveUserTier(null, NOW), "free");
  assert.equal(resolveUserTier(undefined, NOW), "free");
  assert.equal(resolveUserTier({ subscriptionTier: "free" }, NOW), "free");
  assert.equal(resolveUserTier({ subscriptionTier: "gold" }, NOW), "free");
});

test("pro with a future expiry is pro", () => {
  const user = {
    subscriptionTier: "plus",
    subscriptionExpiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR_MS),
  };
  assert.equal(resolveUserTier(user, NOW), "plus");
});

test("pro without an expiry is an indefinite (manual) grant", () => {
  assert.equal(resolveUserTier({ subscriptionTier: "plus", subscriptionExpiresAt: null }, NOW), "plus");
});

test("pro resolves like plus, with the same expiry guard", () => {
  const future = new Date(NOW.getTime() + 30 * 24 * HOUR_MS);
  assert.equal(resolveUserTier({ subscriptionTier: "pro", subscriptionExpiresAt: future }, NOW), "pro");
  assert.equal(resolveUserTier({ subscriptionTier: "pro", subscriptionExpiresAt: null }, NOW), "pro");
  const longExpired = new Date(NOW.getTime() - 25 * HOUR_MS);
  assert.equal(resolveUserTier({ subscriptionTier: "pro", subscriptionExpiresAt: longExpired }, NOW), "free");
});

test("recently-expired pro rides the 24h grace window, older ones do not", () => {
  const recentlyExpired = {
    subscriptionTier: "plus",
    subscriptionExpiresAt: new Date(NOW.getTime() - 2 * HOUR_MS),
  };
  assert.equal(resolveUserTier(recentlyExpired, NOW), "plus");

  const longExpired = {
    subscriptionTier: "plus",
    subscriptionExpiresAt: new Date(NOW.getTime() - 25 * HOUR_MS),
  };
  assert.equal(resolveUserTier(longExpired, NOW), "free");
});

test("string dates from JSON payloads are accepted", () => {
  const user = { subscriptionTier: "plus", subscriptionExpiresAt: "2026-09-26T12:00:00.000Z" };
  assert.equal(resolveUserTier(user, NOW), "plus");
});
