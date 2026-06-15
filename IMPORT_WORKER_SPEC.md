# Import Worker Handoff Spec

> Verified against the actual `web-dashboard` codebase (Next.js 16 / Prisma / Postgres / Cloudflare R2). Every claim below is grounded in real files; the original draft's premise was wrong in one important way — see the callout.

## Current state (verified)

> **The single most important correction: the web route does NOT run jobs synchronously/inline.** It already INSERTs a `pending` row and returns **202 with a job id**, then fire-and-forgets execution via `kickImportJob → queueMicrotask(runImportJob)`. The enqueue + 202 + poll contract this project is "supposed to build" **already exists**. The real change is **"stop executing in the web process,"** not "switch from sync to async." Do not re-implement the enqueue path.

**Already true (don't rebuild):**
- **Enqueue + 202 + job id:** `src/app/api/tools/import-jobs/route.ts` — `createImportJob` INSERTs `status='pending'` (route.ts:124), returns `{ job }` with status `202` for new jobs / `200` for deduped (route.ts:148). Body always carries `job.id`.
- **Client already polls** (no websocket to build): `src/app/(dashboard)/freepik-import/FreepikImportClient.js` POSTs, reads `payload.job.id` (line 445), then `pollImportJob` GETs `/api/tools/import-jobs/{id}` until `succeeded`/`failed` (lines 175-210). Same in `FreepikBackgroundImportSection.js`, `FreepikImportWorkspaceClient.js`.
- **Job state is in Postgres** as a **RAW SQL table, NOT a Prisma model.** `src/lib/tools/importJobsStore.server.js` — created/queried entirely via `prisma.$queryRaw` / `$executeRawUnsafe`. There is **no `model ImportJob` in `prisma/schema.prisma`** and no `prisma.importJob.*` accessor. Table also exists as a real migration: `prisma/migrations/20260310103000_add_import_jobs/migration.sql`.
- **Atomic claim already exists:** `claimImportJob` (importJobsStore.server.js:298-325) = `UPDATE ... SET status='running' WHERE id=$ AND status='pending' RETURNING *`. Safe for concurrent workers.
- **Stale recovery already exists:** `requeueStalledImportJob` (store:327-360), default 300s, keyed off `updated_at`. `drainImportJobs` (importJobsRunner.server.js:158-208) requeues then runs candidates.
- **HTTP drain endpoint exists:** `src/app/api/tools/import-jobs/worker/route.ts` (POST, auth via `IMPORT_JOBS_WORKER_SECRET`, `maxDuration=300`) → `drainImportJobs`. Single-drain-per-call, no internal loop.
- **Structured logger exists** (do not add a new one): `src/lib/logging/logger.ts` (`logger`) used in 49 files including the import-job HTTP routes.

**Not true / does not exist:**
- No standalone worker process / `npm run worker` (package.json scripts: dev/build/start/lint + smoke scripts only).
- No SIGTERM/SIGINT/shutdown handling anywhere (greenfield).
- No `output:'standalone'` in `next.config.mjs`.
- No `/api/health` route.
- No max-attempts cap (the `attempts` column is incremented but **never read**).
- No `locked_at` / `worker_id` column.

---

## Work items

### 1. Make the web path enqueue-only

- **Goal:** Web only INSERTs `pending` + returns 202; never executes jobs.
- **What's true today:** Enqueue + 202 + id already done. Execution is triggered in-process from **two** files: create route `kickImportJob` calls at `route.ts:117, 144, 170, 224` (idempotency branches), AND poll route `[id]/route.ts:75-82` (re-kicks `pending` on every GET, re-kicks recovered stalled `running`).
- **What to change:** Remove **all** `kickImportJob` calls from `route.ts` **and** `[id]/route.ts`. The poll-route kicks are the easy miss — leave them and every client poll keeps executing jobs (incl. spawning Playwright) on the web thread.
- **Watch out for:** Do this only **after** a real worker is scheduled and live (see §2 + Prerequisites). On serverless, the `queueMicrotask` fire-and-forget may be frozen after 202; jobs today may only complete because the poll route re-kicks them. Strip kicks with no live worker → imports silently stop completing.

### 2. Standalone worker entrypoint (`npm run worker`)

- **Goal:** Long-running process that drains directly against the store, not via HTTP.
- **What's true today:** `drainImportJobs` (importJobsRunner.server.js:158) is HTTP-agnostic and reusable. But it is **single-drain-per-call** (limit clamped 1-20, default 5) with no loop. **Blocker:** the runner does `import { runCanvaImportForOwner } from "@/app/api/tools/canva-import/route.ts"` (importJobsRunner.server.js:10) — that route imports `next/server`, so importing the runner transitively loads Next.
- **What to change:** Add a worker entry that loops `drainImportJobs` on a poll interval + backoff, plus SIGTERM/SIGINT handlers (stop claiming, await in-flight, else rely on the 300s stale-requeue). Either run from the compiled Next build, or give the worker a transpile step (tsx/esbuild/swc) **with `@/*` alias resolution** (alias is in tsconfig/jsconfig only; no native node resolution; files mix `.js` ESM + `.ts`, no `"type":"module"`).
- **Watch out for:** Extract `runCanvaImportForOwner` out of `canva-import/route.ts` into a framework-free lib module first, or the worker drags in `next/server`. The two Freepik runners (`runFreepikImportForOwner`, `runFreepikBackgroundImportForOwner` from `src/lib/tools/freepikImport.server.js`) are NOT Next-coupled.

### 3. Safe claiming + stale recovery

- **Goal:** No job runs twice; crashed workers' jobs get reclaimed.
- **What's true today:** Claim is **already atomic** via conditional `UPDATE ... WHERE status='pending' RETURNING` — correct even for N workers. But selection (`listImportJobCandidateIds`, store:467-488) and claim are **two statements with no `FOR UPDATE SKIP LOCKED`**, so replicas all SELECT the same ids then thunder on the UPDATE (one wins, rest skip — wasteful). Staleness is inferred from `updated_at` (bumped only by `updateImportJobProgress`, store:362-392). No `locked_at`, no `worker_id`.
- **What to change:** For multi-replica efficiency, add `SELECT ... FOR UPDATE SKIP LOCKED` to candidate selection (raw SQL is already the norm — low friction). Consider a `locked_at`/`worker_id` fencing token so requeue can't double-run a slow-but-alive worker.
- **Watch out for:** A legit job quiet >300s gets requeued and run a **second time concurrently**. `markImportJobSucceeded`/`markImportJobFailed` (store:394-465) update **by id with no status guard** → the loser overwrites the winner's result. `started_at` is `COALESCE`'d once and never reset on requeue — don't key lease/timeout off it; use `updated_at` or a new `locked_at`.

### 4. Idempotency

- **Goal:** Retries don't create duplicate templates/media.
- **What's true today:** **Freepik is idempotent** (`ON CONFLICT (source, source_asset_id) DO UPDATE` — importedElements.server.js:456, importedBackgrounds.server.js:347). **Canva (`type=canva-url`) is NOT** — `canvaImportTemplate.js:175` does unconditional `tx.template.create` + `tx.templateRevision.create` (line 190); `ensureUniqueSlug`/`ensureUniqueName` (lines 67-94) deliberately append `-2`/` (2)` on collision, **guaranteeing a new visible template every re-run.** Enqueue-level `Idempotency-Key` dedup exists (unique index on `(owner_id, type, idempotency_key)`) but that dedupes **enqueue, not execution**.
- **What to change:** Add a stable Canva dedupe key (e.g. `owner_id + canva_url`) before retries/stall-requeue are enabled for Canva. Scope the "safe to re-run" guarantee per job type.
- **Watch out for:** R2 blob leak on Freepik re-runs — `uploadAssetToStorage` (freepikImport.server.js:957-981) keys objects with `${sourceAssetId}-${randomUUID()}` and `skipExistenceCheck:true`, so the DB row upserts cleanly but each retry leaks a new orphaned R2 object. Decide if orphan GC is in scope.

### 5. Retry cap + graceful shutdown

- **Goal:** Poison jobs don't loop forever; SIGTERM stops claiming and releases cleanly.
- **What's true today:** `attempts` column exists and increments in `claimImportJob` (store:302) but is **never read** (grep maxRetries/maxAttempts/retry_count = nothing). A job that times out mid-run (e.g. Playwright hang) never sets `finished_at`, gets requeued after 300s, re-claimed, **repeats forever.** No signal handling exists at all.
- **What to change:** Add a max-attempts gate in candidate-selection/claim/requeue → mark `failed` instead of re-queuing past the cap. Add SIGTERM/SIGINT handlers in the worker (§2): stop claiming, await in-flight or let the 300s stale-requeue release it.
- **Watch out for:** The poison loop is via the **stale-requeue** path, not the throw→`markImportJobFailed` path (that's terminal). Consider per-type caps — Canva (Playwright, non-idempotent) warrants a lower cap than idempotent Freepik. SIGTERM-interrupted jobs still consumed an `attempts` increment on claim.

### 6. Confirm shared state = Postgres + R2 only

- **Goal:** Web and worker share state only via Postgres + R2; flag local-disk reads.
- **What's true today:** Job state = Postgres (store). Media = R2 via `uploadObject` (objectStorage.server.js:302); public URL (not bytes) stored in DB. Freepik ZIP extraction writes to `os.tmpdir()` but deletes in `finally` (freepikImport.server.js:721-770) — ephemeral, never read by web. **The exception is Canva:** it spawns `scripts/import-canva-template.mjs` which launches Playwright with a **persistent profile at `<cwd>/.tmp/canva-import-profile`** (canva-import/route.ts:178) holding the Canva **login session**, reused across jobs → Canva jobs are **host-affine**, not pure DB/R2.
- **What to change:** Document that Freepik fits the Postgres+R2 model; Canva does not (host-local login profile). Decide how multiple replicas share/seed the Canva session, or pin Canva to one host.
- **Watch out for:** The only module-level in-memory state is `activeJobs` Set (importJobsRunner.server.js:16) — per-process dedup of IDs, **not** results. Cross-process safety rests entirely on `claimImportJob`'s `WHERE status='pending'`. rembg/Python is NOT in the import path (import bg-removal is in-memory sharp/canvas).

### 7. Worker container image / heavy ops split

- **Goal:** Worker image carries import-only heavy deps; web drops what it can.
- **What's true today:** Chromium/Playwright is import-feature-only (Canva) **but reachable via two entrypoints** — the job runner AND a still-wired synchronous `POST /api/tools/canva-import` (route.ts:610, `maxDuration=300`). `sharp` is used via dynamic `import("sharp")` and is **not listed in package.json** (transitive/hoisted). `playwright` is a **devDependency**.
- **What to change:** Build a worker image with Node + Chromium/Playwright, `sharp` (add explicitly), `canvas`/node-canvas + native libs (cairo/pango/libjpeg/giflib/librsvg), `@neplex/vectorizer`, `/usr/bin/unzip`. To let **web drop Chromium**, first remove/convert the synchronous `POST /api/tools/canva-import` to enqueue a job, then drop `playwright` from the web image.
- **Watch out for:** Worker does **NOT** need Replicate (`REPLICATE_API_TOKEN`, `*_REPLICATE_MODEL/VERSION` — mobile endpoints only) or rembg/Python. `/usr/bin/unzip` is a hard-coded absolute path (freepikImport.server.js:731), not configurable. Bucket-name env vars fall back to dev defaults (`nayroz-media-dev`) → a misconfigured prod worker silently writes to dev buckets. The Canva child opens its **own** `new PrismaClient()` (scripts/import-canva-template.mjs:7) → +1 connection per in-flight Canva job; size worker concurrency against Postgres `max_connections`.

### 8. Build prep + observability

- **Goal:** Shared build, `/api/health`, structured job-lifecycle logging.
- **What's true today:** `next.config.mjs` has no `output` key (only `experimental.proxyClientMaxBodySize` + headers). No `/api/health` (only auth-gated `src/app/api/admin/stats/route.ts`). Logger exists and HTTP routes log with jobId, but `importJobsRunner.server.js` and `importJobsStore.server.js` have **zero** log calls — `runImportJobInternal`, `claimImportJob`, `markImportJobSucceeded/Failed` are silent.
- **What to change:** Add `output:'standalone'`. Add unauthenticated `/api/health` (check DB connectivity + `getImportJobStatusSummary` backlog, store:490-520). Add `logger.info/error` for job start/finish/failure carrying `jobId/type/ownerId/durationMs` inside the runner/store, **reusing the existing logger** (`logger.ts`).
- **Watch out for:** `output:'standalone'` traces JS imports only — it will **NOT** include `scripts/` (referenced via runtime `path.join(process.cwd(),'scripts',...)`, not a static import), the Playwright Chromium binary, or native `.node` addons. Add `outputFileTracingIncludes`/explicit copy for these or Canva fails at runtime (not boot). Two duplicate loggers exist (`logger.ts` vs `logger.js`, divergent APIs) — consolidate before adding call sites. Don't introduce a new logger.

---

## Prerequisites & ordering

1. **Migrations before code.** Any new column (`locked_at`, `worker_id`, attempts-cap usage) must land in **BOTH** a new Prisma migration **AND** the runtime `IMPORT_JOBS_SCHEMA_STATEMENTS` / `ensureImportJobsSchema()` (importJobsStore.server.js:6-58), or the table shape diverges per environment. Deploy column adds before any code that reads them.
2. **Decide DDL ownership.** Every store fn calls `ensureImportJobsSchema()` → runs `CREATE/ALTER/CREATE INDEX` via `$executeRawUnsafe`. A least-privilege worker DB role without DDL throws on first claim. **Preferred:** apply schema via Prisma migrations out-of-band and drop the runtime DDL self-healing (removes the two-sources-of-truth drift).
3. **Extract Canva runner from the Next route** (§2 blocker) before standing up a non-Next worker process.
4. **Stand up + schedule the worker and verify it drains** before removing in-process kicks (§1). Confirm what currently triggers execution in prod first — no in-repo caller of the worker endpoint exists, and `IMPORT_JOBS_WORKER_SECRET` is not in `.env.example`.
5. **Add Canva dedupe key** (§4) before enabling retries/stall-requeue for Canva.
6. **Remove/convert sync `POST /api/tools/canva-import`** before dropping Chromium from the web image (§7).

---

## Env vars

| Var | Needed by worker? | Why |
|---|---|---|
| `DATABASE_URL` | **Yes** | Store raw SQL + reaches Freepik API key (DB `appSetting` row `freepik_import_settings_v1`). Canva child asserts it (scripts/import-canva-template.mjs). |
| `R2_ENDPOINT` | **Yes** | `requireEnv()` — throws at upload time if missing. |
| `R2_ACCESS_KEY_ID` | **Yes** | `requireEnv()`. |
| `R2_SECRET_ACCESS_KEY` | **Yes** | `requireEnv()`. |
| `R2_PUBLIC_BASE_URL` | **Yes** | `requireEnv()` for public URL construction. |
| `R2_ACCOUNT_ID`, `R2_REGION` | Yes | S3 client endpoint/region config. |
| `EDITOR_MEDIA_BUCKET`, `TEMPLATE_THUMBNAIL_BUCKET`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET` | Yes | Upload targets. **Have dev-default fallbacks** → set explicitly or prod writes to `nayroz-media-dev`. |
| `BACKGROUND_REMOVAL_REMBG_PYTHON_BIN` / `REMBG_PYTHON_BIN` | **No** | Import bg-removal is in-memory (sharp/canvas); rembg/Python is unreachable from imports. |
| `REPLICATE_API_TOKEN`, `*_REPLICATE_MODEL/_VERSION` | **No** | Mobile object-remove/ai-expand/upscale endpoints only. |
| `CANVA_IMPORT_TOKEN_SECRET` | **No** | Web extension-token/extension-import routes only; not in `runCanvaImportForOwner`. |
| `IMPORT_JOBS_WORKER_SECRET` | Only if worker calls the **HTTP** drain endpoint | Not needed if worker calls `drainImportJobs()` directly. **Not in `.env.example`** — undocumented. |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | **No** | Dashboard session auth only (`src/lib/auth/auth.js`). |
| `MOBILE_API_KEY_ID` / `MOBILE_API_SIGNING_SECRET` / `NEXT_PUBLIC_APP_URL` | **No** | Mobile HMAC / OpenAPI only. |

---

## Heavy ops

| Operation | Import-only? | Worker image | Web image |
|---|---|---|---|
| Playwright/Chromium (Canva import) | Feature-only, but reachable from sync `POST /api/tools/canva-import` too | **Required** | Required **until** that sync POST is removed/converted, then drop |
| `/usr/bin/unzip` (Freepik ZIP) | Yes | **Required** (hard-coded path) | No |
| `@neplex/vectorizer` (raster→SVG) | Yes | **Required** | No |
| `sharp` (unlisted dep) | No (thumbnails + import) | **Required** (add explicitly) | **Required** (add explicitly) |
| `canvas`/node-canvas + native libs | No | **Required** | **Required** (object-remove, ai-expand, thumbnails, shape raster) |
| rembg/Python 3.11+ (`rembg[cpu]`) | No — **synchronous** `/api/mobile/media/remove-background` | Not needed | **Required** (unless that endpoint moves off web) |
| ffmpeg/ffprobe (editor encode-preview) | No — sync editor route | Not needed | **Required** (bare-name spawn, no fallback) |
| Replicate (HTTP API, object-remove/ai-expand/upscale) | No — sync mobile, `maxDuration=300` | Not needed | Outbound HTTPS + `REPLICATE_API_TOKEN` (no native dep) |

---

## Key file paths

`src/app/api/tools/import-jobs/route.ts`, `src/app/api/tools/import-jobs/[id]/route.ts`, `src/app/api/tools/import-jobs/worker/route.ts`, `src/lib/tools/importJobsRunner.server.js`, `src/lib/tools/importJobsStore.server.js`, `src/lib/tools/freepikImport.server.js`, `src/app/api/tools/canva-import/route.ts`, `scripts/import-canva-template.mjs`, `src/lib/storage/objectStorage.server.js`, `src/lib/tools/canvaImportTemplate.js`, `src/lib/logging/logger.ts`, `next.config.mjs`, `prisma/migrations/20260310103000_add_import_jobs/migration.sql`.
