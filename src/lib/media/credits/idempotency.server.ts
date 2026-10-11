/**
 * `Idempotency-Key` support for the paid AI routes (production audit H-13 / ROB-05).
 *
 * A client that retries a paid run — after a timeout, an iOS suspension, a double tap — sends the
 * same key; the second request then never charges again:
 *   - the first run is still going      → 409 `idempotency_in_progress` (+ Retry-After);
 *   - the first run succeeded           → the stored response is replayed (`Idempotent-Replayed: true`);
 *   - the first run failed / was refunded → nothing is stored, the retry runs (and is charged) fresh;
 *   - the key arrives with another tool → 422 `idempotency_key_reused`.
 *
 * ★Process-local, like the rate limiter (src/lib/security/rateLimit.server.js): entries live in
 * this server's memory for ten minutes, bounded by count and bytes. That covers the single-
 * instance deployment this backend runs as. Behind several instances a retry can land on another
 * one and run again — then this needs a shared store (Redis, or a small table: a schema change).
 */

export type StoredIdempotentResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
};

type Entry = {
  fingerprint: string;
  expiresAt: number;
  state: "in_flight" | "completed" | "spent";
  response?: StoredIdempotentResponse;
  bytes: number;
  replays: number;
};

export type BeginIdempotentRunResult =
  | { kind: "proceed" }
  | { kind: "replay"; response: StoredIdempotentResponse }
  | { kind: "in_progress" }
  | { kind: "mismatch" }
  | { kind: "spent" };

const ENTRY_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 2_000;
const MAX_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 192 * 1024 * 1024;
// RFC draft "The Idempotency-Key HTTP Header Field": an opaque string; UUIDs are the norm.
const KEY_PATTERN = /^[\x21-\x7E]{8,255}$/;

type Store = { entries: Map<string, Entry>; totalBytes: number };

// On globalThis so a dev-server module reload keeps in-flight runs visible (like the Prisma client).
const globalStore = globalThis as typeof globalThis & { __nayrozPaidRunIdempotency?: Store };
const store: Store = (globalStore.__nayrozPaidRunIdempotency ??= { entries: new Map(), totalBytes: 0 });

function dropEntry(storeKey: string, entry: Entry | undefined = store.entries.get(storeKey)) {
  if (!entry) return;
  store.totalBytes -= entry.bytes;
  store.entries.delete(storeKey);
}

function purgeExpired(now: number) {
  for (const [storeKey, entry] of store.entries) {
    if (entry.expiresAt <= now) dropEntry(storeKey, entry);
  }
}

/** Drops stored bodies, oldest first, until the byte budget holds; keys stay "spent". */
function enforceBudget() {
  if (store.totalBytes <= MAX_TOTAL_BYTES && store.entries.size <= MAX_ENTRIES) return;
  for (const [storeKey, entry] of store.entries) {
    if (store.totalBytes <= MAX_TOTAL_BYTES && store.entries.size <= MAX_ENTRIES) break;
    if (store.entries.size > MAX_ENTRIES && entry.state !== "in_flight") {
      dropEntry(storeKey, entry);
      continue;
    }
    if (entry.state === "completed") {
      store.totalBytes -= entry.bytes;
      entry.bytes = 0;
      entry.response = undefined;
      entry.state = "spent";
    }
  }
}

/**
 * Reads and validates the request's Idempotency-Key. `key: null` when the header is absent (a
 * run without one behaves exactly as before); `ok: false` when it is present but malformed.
 */
export function readIdempotencyKey(request: Request): { ok: true; key: string | null } | { ok: false } {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return { ok: true, key: null };
  const key = raw.trim();
  return KEY_PATTERN.test(key) ? { ok: true, key } : { ok: false };
}

/** The store key: the same client key from another user or another route never collides. */
export function idempotencyStoreKey(mobileUserId: string, scope: string, key: string): string {
  return `${mobileUserId}\u0000${scope}\u0000${key}`;
}

/** Claims the key for a new run, or reports why this request must not run. */
export function beginIdempotentRun(storeKey: string, fingerprint: string, now = Date.now()): BeginIdempotentRunResult {
  purgeExpired(now);
  const existing = store.entries.get(storeKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) return { kind: "mismatch" };
    if (existing.state === "in_flight") return { kind: "in_progress" };
    if (existing.state === "completed" && existing.response) {
      existing.replays += 1;
      return { kind: "replay", response: existing.response };
    }
    return { kind: "spent" };
  }
  store.entries.set(storeKey, {
    fingerprint,
    expiresAt: now + ENTRY_TTL_MS,
    state: "in_flight",
    bytes: 0,
    replays: 0,
  });
  enforceBudget();
  return { kind: "proceed" };
}

/** Records the delivered outcome so a retry replays it instead of running (and charging) again. */
export function completeIdempotentRun(
  storeKey: string,
  response: StoredIdempotentResponse,
  now = Date.now()
): void {
  const entry = store.entries.get(storeKey);
  if (!entry) return;
  const bytes = response.body.byteLength;
  entry.expiresAt = now + ENTRY_TTL_MS;
  if (bytes > MAX_ENTRY_BYTES) {
    // Too big to keep: the key is still spent, so a retry is told so rather than charged twice.
    entry.state = "spent";
    return;
  }
  entry.state = "completed";
  entry.response = response;
  entry.bytes = bytes;
  store.totalBytes += bytes;
  enforceBudget();
}

/** Forgets a run that failed or was refunded, so a retry with the same key runs fresh. */
export function abandonIdempotentRun(storeKey: string): void {
  dropEntry(storeKey);
}

/** True once the stored result has been handed to a retry — the run was delivered after all. */
export function idempotentRunWasReplayed(storeKey: string): boolean {
  return (store.entries.get(storeKey)?.replays || 0) > 0;
}

/** Test hook: an empty store. */
export function resetIdempotencyStoreForTests(): void {
  store.entries.clear();
  store.totalBytes = 0;
}
