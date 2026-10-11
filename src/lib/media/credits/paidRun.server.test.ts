/**
 * Credit reservations and the paid-run orchestrator against a real Postgres (production audit
 * H-13 / ROB-05): atomic reserve, no overdraw under concurrency, finalize, refund on provider
 * failure / client abort / timeout / interrupted delivery, Idempotency-Key replay.
 *
 * Needs a DISPOSABLE database with the Prisma schema pushed — never the shared dev database:
 *   docker run --rm -d --name nayroz-backend-fix-tests -p 127.0.0.1:55433:5432 \
 *     -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=nayroz_fix_test postgres:17
 *   DATABASE_URL=postgresql://test:test@127.0.0.1:55433/nayroz_fix_test npx prisma db push --skip-generate
 *   NAYROZ_TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:55433/nayroz_fix_test \
 *     node --import tsx --test src/lib/media/credits/paidRun.server.test.ts
 * Skipped when NAYROZ_TEST_DATABASE_URL is not set.
 */
import assert from "node:assert/strict";
import test from "node:test";

const TEST_DATABASE_URL = process.env.NAYROZ_TEST_DATABASE_URL || "";

function assertDisposableDatabase(url: string) {
  const parsed = new URL(url);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  const disposable = /_test$/.test(parsed.pathname.replace(/^\//, ""));
  if (!local || !disposable) {
    throw new Error(`Refusing to write test rows to ${parsed.hostname}${parsed.pathname}: use a local *_test database.`);
  }
}

const skip = !TEST_DATABASE_URL;
if (!skip) {
  assertDisposableDatabase(TEST_DATABASE_URL);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const USER_ID = "00000000-0000-4000-8000-0000000000c1";
const ALLOWANCE = 150;

let prisma: any;
let credits: typeof import("./index.server");
let paidRun: typeof import("./paidRun.server");
let idempotency: typeof import("./idempotency.server");

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };

async function resetWallet() {
  idempotency.resetIdempotencyStoreForTests();
  await prisma.mediaUsage.deleteMany({ where: { mobileUserId: USER_ID } });
}

async function usageRows() {
  return prisma.mediaUsage.findMany({ where: { mobileUserId: USER_ID }, orderBy: { createdAt: "asc" } });
}

async function used() {
  return (await usageRows()).reduce((sum: number, row: any) => sum + row.credits, 0);
}

async function waitFor(predicate: () => Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for: ${label}`);
}

function paidRequest(headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("http://localhost/api/mobile/ai-tools/run", { method: "POST", headers, signal });
}

function runTool(
  request: Request,
  {
    cost = 100,
    fingerprint = "tool-a",
    timeoutMs = 5_000,
    execute = async () => ({ bytes: new TextEncoder().encode("png") }),
  }: {
    cost?: number;
    fingerprint?: string;
    timeoutMs?: number;
    execute?: (signal: AbortSignal) => Promise<{ bytes: Uint8Array }>;
  } = {}
) {
  return paidRun.runPaidMediaOperation({
    request,
    logger: quietLogger,
    mobileUserId: USER_ID,
    feature: "ai-tools",
    costOverride: cost,
    idempotencyScope: "ai-tools:run",
    fingerprint,
    timeoutMs,
    execute,
    respond: (result, { chargedCredits }) => ({
      usage: { provider: "replicate", model: "test/model" },
      headers: { "Content-Type": "image/png", "X-Credits-Charged": String(chargedCredits) },
      body: result.bytes,
    }),
  });
}

test.before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).default;
  credits = await import("./index.server");
  paidRun = await import("./paidRun.server");
  idempotency = await import("./idempotency.server");
  await prisma.mediaUsage.deleteMany({ where: { mobileUserId: USER_ID } });
  await prisma.mobileUser.deleteMany({ where: { id: USER_ID } });
  // A free account with its own allowance: one 100-credit run fits, a second does not.
  await prisma.mobileUser.create({ data: { id: USER_ID, name: "credits-test", creditAllowance: ALLOWANCE } });
});

test.after(async () => {
  if (skip) return;
  await prisma.mobileUser.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

test.beforeEach(async () => {
  if (!skip) await resetWallet();
});

test("control: the old read-then-record path lets concurrent runs overdraw the wallet", { skip }, async () => {
  const attempts = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const balance = await credits.checkMediaCredits({ mobileUserId: USER_ID, feature: "ai-tools", costOverride: 100 });
      if (!balance.allowed) return false;
      await credits.recordMediaUsage({ mobileUserId: USER_ID, feature: "ai-tools", credits: 100 });
      return true;
    })
  );
  assert.ok(attempts.filter(Boolean).length > 1, "every concurrent run saw the same untouched balance");
  assert.ok((await used()) > ALLOWANCE, "…and together they spent more than the allowance");
});

test("reservations are atomic: six concurrent 100-credit runs on a 150 wallet → exactly one", { skip }, async () => {
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      credits.reserveMediaCredits({ mobileUserId: USER_ID, feature: "ai-tools", costOverride: 100 })
    )
  );
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(await used(), 100);
  const refused = results.find((result) => !result.ok)!;
  assert.equal(refused.balance.remaining, 50);
  assert.equal(refused.balance.allowed, false);
});

test("a hold is a usage row; finalize records the provider, refund deletes it", { skip }, async () => {
  const reserved = await credits.reserveMediaCredits({ mobileUserId: USER_ID, feature: "upscale" });
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  assert.equal(reserved.reservation.credits, 20, "upscale's configured cost");
  assert.equal(reserved.balance.remaining, ALLOWANCE - 20, "the post-hold balance");
  let [row] = await usageRows();
  assert.equal(row.provider, credits.MEDIA_CREDIT_RESERVATION_PROVIDER);

  assert.equal(await credits.finalizeMediaCreditReservation(reserved.reservation, { provider: "replicate", model: "nightmareai/real-esrgan" }), true);
  [row] = await usageRows();
  assert.equal(row.provider, "replicate");
  assert.equal(row.model, "nightmareai/real-esrgan");
  assert.equal(row.credits, 20);
  assert.ok(row.costMicros > 0, "provider cost priced from the model table");

  assert.equal(await credits.refundMediaCreditReservation(reserved.reservation, "test"), true);
  assert.equal((await usageRows()).length, 0);
  assert.equal(await credits.refundMediaCreditReservation(reserved.reservation, "test again"), false, "idempotent");
});

test("a hold orphaned by a crashed process is released by the next reservation", { skip }, async () => {
  await prisma.mediaUsage.create({
    data: {
      mobileUserId: USER_ID,
      feature: "ai-tools",
      provider: credits.MEDIA_CREDIT_RESERVATION_PROVIDER,
      credits: 100,
      periodKey: "2026-10",
      createdAt: new Date(Date.now() - 20 * 60_000),
    },
  });
  const reserved = await credits.reserveMediaCredits({ mobileUserId: USER_ID, feature: "ai-tools", costOverride: 100 });
  assert.equal(reserved.ok, true, "the stale 100-credit hold no longer blocks the wallet");
  assert.equal(await used(), 100);
});

test("success: 200, the wallet after the run in X-Credits-*, charged once, row finalized", { skip }, async () => {
  const response = await runTool(paidRequest());
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer())), "png");
  assert.equal(response.headers.get("x-credits-remaining"), String(ALLOWANCE - 100));
  assert.equal(response.headers.get("x-credits-allowance"), String(ALLOWANCE));
  assert.equal(response.headers.get("x-credits-charged"), "100");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const rows = await usageRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "replicate");
});

test("insufficient credits: 429 insufficient_credits and the provider is never called", { skip }, async () => {
  let called = false;
  const response = await runTool(paidRequest(), {
    cost: ALLOWANCE + 1,
    execute: async () => {
      called = true;
      return { bytes: new Uint8Array() };
    },
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, "insufficient_credits");
  assert.equal(called, false);
  assert.equal(await used(), 0);
});

test("provider failure: the error reaches the route's own mapping and nothing is charged", { skip }, async () => {
  await assert.rejects(
    runTool(paidRequest(), {
      execute: async () => {
        throw Object.assign(new Error("model crashed"), { statusCode: 502 });
      },
    }),
    /model crashed/
  );
  assert.equal(await used(), 0);
});

test("client leaves mid-run (Back, cancel, iOS suspension): 499 and a full refund", { skip }, async () => {
  const controller = new AbortController();
  let reached!: () => void;
  const providerStarted = new Promise<void>((resolve) => (reached = resolve));
  const pending = runTool(paidRequest({}, controller.signal), {
    execute: async () => {
      reached();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { bytes: new TextEncoder().encode("late") };
    },
  });
  await providerStarted;
  assert.equal(await used(), 100, "held while the provider runs");
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal(await used(), 0);
  await new Promise((resolve) => setTimeout(resolve, 350)); // the abandoned run settles quietly
  assert.equal(await used(), 0);
});

test("timeout: 504 ai_run_timeout and a full refund", { skip }, async () => {
  const response = await runTool(paidRequest(), {
    timeoutMs: 50,
    execute: () => new Promise((resolve) => setTimeout(() => resolve({ bytes: new Uint8Array() }), 400)),
  });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, "ai_run_timeout");
  assert.equal(await used(), 0);
});

test("delivery cut off after the response was handed over: refunded", { skip }, async () => {
  const controller = new AbortController();
  const response = await runTool(paidRequest({}, controller.signal));
  assert.equal(response.status, 200);
  assert.equal(await used(), 100);
  // Next aborts request.signal when the socket closes before the body finished writing.
  controller.abort();
  await waitFor(async () => (await used()) === 0, "refund after an interrupted delivery");
});

test("Idempotency-Key: a retry replays the result instead of charging again", { skip }, async () => {
  let runs = 0;
  const execute = async () => {
    runs += 1;
    return { bytes: new TextEncoder().encode(`result-${runs}`) };
  };
  const headers = { "Idempotency-Key": "8a4f0c2e-6a52-4c1c-9f6e-2f4f1d1e9b10" };
  const first = await runTool(paidRequest(headers), { execute });
  const second = await runTool(paidRequest(headers), { execute });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("idempotent-replayed"), "true");
  assert.equal(new TextDecoder().decode(new Uint8Array(await second.arrayBuffer())), "result-1");
  assert.equal(second.headers.get("x-credits-remaining"), String(ALLOWANCE - 100), "fresh wallet, not a second charge");
  assert.equal(runs, 1);
  assert.equal(await used(), 100);
});

test("Idempotency-Key: duplicate while running → 409; other tool → 422; malformed → 400", { skip }, async () => {
  const headers = { "Idempotency-Key": "3c1d2b9e-0f5a-4e7c-8d6b-1a2b3c4d5e6f" };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const first = runTool(paidRequest(headers), {
    execute: async () => {
      await gate;
      return { bytes: new TextEncoder().encode("done") };
    },
  });
  await waitFor(async () => (await used()) === 100, "first run holding its credits");
  const duplicate = await runTool(paidRequest(headers));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "idempotency_in_progress");
  assert.ok(Number(duplicate.headers.get("retry-after")) > 0);
  release();
  assert.equal((await first).status, 200);

  const otherTool = await runTool(paidRequest(headers), { fingerprint: "tool-b" });
  assert.equal(otherTool.status, 422);
  assert.equal((await otherTool.json()).code, "idempotency_key_reused");

  const malformed = await runTool(paidRequest({ "Idempotency-Key": "no" }));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "invalid_idempotency_key");
  assert.equal(await used(), 100, "only the first run was ever charged");
});

test("Idempotency-Key: a failed run frees the key, so the retry runs (and is charged) once", { skip }, async () => {
  const headers = { "Idempotency-Key": "c0ffee00-1234-4abc-8def-0123456789ab" };
  await assert.rejects(
    runTool(paidRequest(headers), {
      execute: async () => {
        throw new Error("provider down");
      },
    })
  );
  assert.equal(await used(), 0);
  const retry = await runTool(paidRequest(headers));
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get("idempotent-replayed"), null);
  assert.equal(await used(), 100);
});
