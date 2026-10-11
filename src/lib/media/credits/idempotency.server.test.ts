/**
 * Idempotency-Key bookkeeping for the paid AI routes (production audit H-13 / ROB-05).
 * Run: node --import tsx --test src/lib/media/credits/idempotency.server.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  abandonIdempotentRun,
  beginIdempotentRun,
  completeIdempotentRun,
  idempotencyStoreKey,
  idempotentRunWasReplayed,
  readIdempotencyKey,
  resetIdempotencyStoreForTests,
} from "./idempotency.server";

const response = (text: string) => ({
  status: 200,
  headers: { "Content-Type": "image/png" },
  body: new TextEncoder().encode(text),
});

test.beforeEach(() => resetIdempotencyStoreForTests());

test("the header is optional, and validated when present", () => {
  const read = (value?: string) =>
    readIdempotencyKey(new Request("http://localhost/x", { headers: value === undefined ? {} : { "Idempotency-Key": value } }));
  assert.deepEqual(read(), { ok: true, key: null });
  assert.deepEqual(read("6f1c2c58-1b1e-4a0b-9d63-8a8f2b7f4e21"), {
    ok: true,
    key: "6f1c2c58-1b1e-4a0b-9d63-8a8f2b7f4e21",
  });
  assert.deepEqual(read("short"), { ok: false });
  assert.deepEqual(read("has spaces in it"), { ok: false });
  assert.deepEqual(read("x".repeat(256)), { ok: false });
});

test("keys are scoped per user and per route", () => {
  assert.notEqual(idempotencyStoreKey("user-a", "media:upscale", "k"), idempotencyStoreKey("user-b", "media:upscale", "k"));
  assert.notEqual(idempotencyStoreKey("user-a", "media:upscale", "k"), idempotencyStoreKey("user-a", "media:edit-image", "k"));
});

test("first claim proceeds; a duplicate while running is in progress; after success it replays", () => {
  const key = idempotencyStoreKey("user", "ai-tools:run", "key-00000001");
  assert.deepEqual(beginIdempotentRun(key, "tool-a"), { kind: "proceed" });
  assert.deepEqual(beginIdempotentRun(key, "tool-a"), { kind: "in_progress" });
  completeIdempotentRun(key, response("png-bytes"));
  const replay = beginIdempotentRun(key, "tool-a");
  assert.equal(replay.kind, "replay");
  assert.equal(new TextDecoder().decode((replay as { response: { body: Uint8Array } }).response.body), "png-bytes");
  assert.equal(idempotentRunWasReplayed(key), true);
});

test("the same key for a different run is refused", () => {
  const key = idempotencyStoreKey("user", "ai-tools:run", "key-00000002");
  beginIdempotentRun(key, "tool-a");
  assert.deepEqual(beginIdempotentRun(key, "tool-b"), { kind: "mismatch" });
});

test("an abandoned (failed / refunded) run frees the key for a fresh, charged retry", () => {
  const key = idempotencyStoreKey("user", "media:upscale", "key-00000003");
  beginIdempotentRun(key, "model:2");
  abandonIdempotentRun(key);
  assert.deepEqual(beginIdempotentRun(key, "model:2"), { kind: "proceed" });
});

test("entries expire after their TTL", () => {
  const key = idempotencyStoreKey("user", "media:upscale", "key-00000004");
  const now = Date.now();
  beginIdempotentRun(key, "fp", now);
  completeIdempotentRun(key, response("x"), now);
  assert.equal(beginIdempotentRun(key, "fp", now + 60_000).kind, "replay");
  assert.equal(beginIdempotentRun(key, "fp", now + 11 * 60_000).kind, "proceed");
});

test("a result too large to keep leaves the key spent — refused, never charged twice", () => {
  const key = idempotencyStoreKey("user", "media:upscale", "key-00000005");
  beginIdempotentRun(key, "fp");
  completeIdempotentRun(key, { status: 200, headers: {}, body: new Uint8Array(25 * 1024 * 1024) });
  assert.deepEqual(beginIdempotentRun(key, "fp"), { kind: "spent" });
});
