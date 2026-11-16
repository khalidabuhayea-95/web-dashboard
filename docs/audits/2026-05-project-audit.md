# Project Audit Report — `web-dashboard`

**Scope:** Full codebase (Next.js 16 / React 19 / TypeScript / Prisma / Konva)
**Date:** 2026-05-26
**Files scanned:** 230 source files (66,770 LOC in `src/`, 19 Prisma models, 51 API routes, 28 client components)
**Stack risks at a glance:** TypeScript strict mode is on but 115 `.js` files (~31k LOC) escape it; 19 `npm audit` advisories (10 high); 22 of 24 mobile API routes are unauthenticated.

---

## Summary

| Category | 🔴 Critical | 🟡 Warning | 🔵 Info |
|---|---|---|---|
| Security | **4** | 5 | 3 |
| Performance | 2 | 7 | 4 |
| Code Quality / Maintainability | 1 | 8 | 5 |
| Reliability / Observability | 1 | 3 | 2 |
| **Total** | **8** | **23** | **14** |

> If you only have time to fix five things, fix **SEC-01, SEC-02, PERF-01, REL-01, QUAL-01**.

---

## 🔴 Critical Issues

### SEC-01 · Mobile API is effectively unauthenticated — 22 of 24 routes
**Files:** [src/lib/mobile/auth.js:40-42](src/lib/mobile/auth.js:40), [src/app/api/mobile/](src/app/api/mobile/) (entire tree except `media/object-remove` and `media/ai-expand`)
**Issue:** Two compounding problems:
1. The HMAC verifier `verifyMobileRequest` returns `{ ok: true, reason: "skipped" }` whenever `MOBILE_API_KEY_ID` or `MOBILE_API_SIGNING_SECRET` is empty — no `NODE_ENV === "production"` guard. A misconfigured deploy silently disables all mobile auth.
2. Only 2 of 24 mobile route files import `verifyMobileRequest` at all. Templates, fonts, elements, shapes, background-categories, app-settings, and all `[slug]/assets` endpoints serve data without checking signatures.
**Risk:** Anyone can scrape the full template / asset catalog, enumerate user IDs, and (where mobile auth is used elsewhere) bypass rate limiting tied to the mobile key.
**Fix:**
- Hard-fail in `verifyMobileRequest` when `NODE_ENV === "production"` and config is missing.
- Add a wrapper (`withMobileAuth(handler)`) and apply it to **every** route under `src/app/api/mobile/`, or enforce auth in `middleware.ts` matching `/api/mobile/:path*`.

### SEC-02 · 10 high-severity transitive vulnerabilities (fixes available)
**Source:** `npm audit`
**Highlights:**
- `next` ≤16.1.6 has 19 advisories including HTTP request smuggling, SSRF, multiple middleware bypasses, RSC cache poisoning, image-optimization DoS. Fix: bump to `next@16.2.6` (non-major).
- `@xmldom/xmldom` — XML injection (used by canva/PSD parsers in your dep tree).
- `path-to-regexp`, `picomatch` — ReDoS.
- `hono`, `@hono/node-server` — auth bypasses via encoded slashes (used as an indirect dep, but pulled in by build tooling).
- `fast-uri` — path traversal via percent-encoded dot segments.
**Fix:** `npm audit fix` (auto-fixes all 19; only `next-auth` requires a major bump and may be deferrable).

### SEC-03 · Dev fallback `AUTH_SECRET` is committed in code
**File:** [src/lib/auth/auth.js:14-15](src/lib/auth/auth.js:14)
**Issue:** `"local-dev-auth-secret-change-me"` is used when `NODE_ENV !== "production"` and no env var is set. If `NODE_ENV` is ever unset (Docker, CI sandbox, edge runtime quirks), production JWTs are signed with this string. The guard is also `!== "production"` rather than `=== "development"`, so `NODE_ENV=staging` or empty falls back.
**Fix:** Replace with `throw new Error(...)` when secret is missing — fail fast in every environment except local dev where the dev runner injects the secret via `.env.local`.

### SEC-04 · `$queryRawUnsafe` with interpolated table name
**File:** [src/app/api/templates/[id]/route.ts:77-85](src/app/api/templates/[id]/route.ts:77)
**Issue:** Table names are interpolated into the SQL string. The current callsite hardcodes them in an array (`["editor_element_assets", "editor_background_assets"]`), so it's not exploitable today, but the helper is a footgun for future refactors.
**Fix:** Whitelist table names at the function boundary (e.g., `if (!ALLOWED_TABLES.has(tableName)) throw`) and prefer `prisma.$queryRaw` (tagged template) wherever the table list is static.

### PERF-01 · Editor components are monolithic — render-cost cliff
**Files:**
- [src/components/editor/SidePanel.tsx](src/components/editor/SidePanel.tsx) — **5,102 LOC**, 40 `useState`, 35 `useMemo`, 14 `useCallback`, 16 `useEffect`
- [src/components/editor/CanvasEditor.tsx](src/components/editor/CanvasEditor.tsx) — **3,900 LOC**, 19+ `useEffect`
- [src/components/editor/Toolbar.tsx](src/components/editor/Toolbar.tsx) — **2,198 LOC**, 14 `useState`, 13 `useEffect`
- [src/store/editorStore.ts](src/store/editorStore.ts) — **2,326 LOC** single Zustand store with **72** `set(...)` calls
**Issue:** Single-component state explosions cause every `setState` to re-render the whole panel. Zero `React.memo`, only 2 `next/dynamic` imports, **0 `Suspense` boundaries**. Each Konva interaction triggers a top-level re-render.
**Fix (prioritized):**
1. Slice the Zustand store by domain (pages, selection, history, timeline, ui) — components subscribe only to their slice.
2. Extract animation/timeline/preview/text-tools into their own files & wrap with `React.memo`.
3. Lazy-load the editor route via `next/dynamic({ ssr: false })` — Konva and Fabric together pull ~600KB.
4. Replace `useMemo` chains on hot paths with selectors that take primitive args (cheaper equality).

### PERF-02 · Unbounded slug-collision loops with N+1 DB queries
**Files:** [src/app/api/templates/route.ts:81-88, 96-111](src/app/api/templates/route.ts:81); same pattern in [src/lib/tools/canvaImportTemplate.js:72,85](src/lib/tools/canvaImportTemplate.js:72)
**Issue:** `while (true)` loops issue one `findUnique` per attempt with no max-iteration cap. A user (or import job) with many similar names creates O(n) sequential DB round-trips per request and can pin the connection pool.
**Fix:** Cap at e.g. 50 attempts, then fall through to `${base}-${randomBytes(4).toString("hex")}`. Better: rely on the DB unique constraint and catch the violation with a single retry.

### REL-01 · No CI, no Dockerfile, no test runner configured, almost no tests
**Findings:**
- `.github/workflows/` does not exist.
- No `Dockerfile` / `docker-compose.yml`.
- `playwright` is in devDependencies but `playwright.config.*` is missing.
- No `vitest.config.*` / `jest.config.*` — the 3 `*.test.js` files in the repo are orphaned.
- `npm run lint` runs an OpenAPI-coverage check but ESLint produces 0 findings because the config (eslint.config.mjs) only inherits `next/core-web-vitals` defaults — it does **not enable `@typescript-eslint`, `no-unused-vars`, `no-console`, or any project rules**.
**Fix:** Add a GitHub Actions workflow that runs `tsc --noEmit`, `next build`, and `npm audit --omit=dev` on every PR. Wire `vitest` and Playwright with at least smoke tests for `/api/admin/users` and `/api/templates`.

### QUAL-01 · TypeScript strict is on but doesn't apply to ~30k LOC of `.js`
**Numbers:** 115 `.js` files in `src/` (excluding generated) — 31,330 LOC. `tsconfig.json` has `allowJs: true` but **no `checkJs`**, so JS files are imported untyped. Largest unchecked files:
- `src/lib/mobile/openapi.js` — 2,448 LOC
- `src/app/api/tools/canva-import/extension-import/route.js` — 1,933 LOC (an API route!)
- `src/lib/templates/mobileProject.js` — 1,833 LOC
- `src/lib/tools/freepikImport.server.js` — 1,336 LOC
**Issue:** `tsc --noEmit` already reports **24 type errors** in the TS half (see Appendix A) — the JS half is invisible to type checking. New code is statistically more likely to be added to the unchecked JS half because it stays "green."
**Fix:**
1. Enable `"checkJs": true` in `tsconfig.json` and triage the immediate errors.
2. Rename leaf utilities (single-export modules) to `.ts`. Skip the big monolithic files until you have time to split them.

---

## 🟡 Warnings

### SEC-05 · No global rate limiting on API routes
**Files:** Only 10 of 51 API routes import a rate limiter (`src/lib/security/rateLimit.server.js`). Public-facing routes (login, register, mobile catalog, storage proxy) are not throttled.
**Fix:** Add rate limiting in `middleware.ts`, or wrap the auth and search routes explicitly.

### SEC-06 · 24 TypeScript errors break compile-time guarantees
**Source:** `tsc --noEmit` — full list in Appendix A. Examples:
- `src/app/api/templates/[id]/route.ts:88` — `BigInt` literals require ES2020 target (your `tsconfig` is `ES2017`).
- `src/app/api/mobile/background-categories/[id]/images/route.ts:54-55` — `item is possibly 'null'`, used in 4 spots.
- `src/app/api/storage/public/[...key]/route.ts:59` — passes `{}` where `string` is expected.
- `src/components/editor/SidePanel.tsx:959` and `Toolbar.tsx:958, 1206` — `TimelinePreviewStatus` type narrowing is wrong; runtime status from API can be `null`.
**Fix:** Run `tsc --noEmit` in CI; bump `"target": "ES2020"`; fix the ~10 unique error patterns.

### SEC-07 · `next.config.mjs` lacks `images.remotePatterns` allowlist
**File:** [next.config.mjs](next.config.mjs)
**Issue:** Default Next image config allows any host once the optimizer is exposed. Combined with the unauthenticated `/api/storage/public/[...key]` route, this widens SSRF surface (and the `next` image-DoS CVE applies).
**Fix:** Add `images: { remotePatterns: [{ protocol: "https", hostname: "<r2-public-domain>" }] }` and `images: { unoptimized: false }`.

### SEC-08 · `dangerouslySetInnerHTML` — none found, but Permissions-Policy is partial
The headers in `next.config.mjs` deny camera/mic/geo but allow everything else. Add `interest-cohort=()` and consider `Strict-Transport-Security` (currently relying on the edge to inject it). No `Content-Security-Policy` is set.

### SEC-09 · 6 `console.*` calls in source code
**Issue:** A few server-side `console.log` calls bypass the structured `logger`. They won't include request IDs and may leak data in production logs.
**Fix:** Replace with `logger.info` / `logger.error`.

### PERF-03 · Raw `<img>` instead of `next/image` — 0 usages of `next/image` in the codebase
**Files:** [public/nayroz-tab-icon.svg](public/nayroz-tab-icon.svg) (1.7 MB), [public/nayroz-icon.png](public/nayroz-icon.png) (1.2 MB), 6 marketing images >500 KB each.
**Issue:** Public folder ships 6.6 MB of unoptimized images. No `next/image` means no automatic resize/AVIF/WebP. The landing page and dashboard ship them at full resolution.
**Fix:** (a) Re-export the SVG via SVGOMG; the 1.7 MB SVG is almost certainly an embedded raster — convert to PNG/WebP. (b) Migrate `<img>` to `next/image` in non-canvas contexts.

### PERF-04 · `prisma.findMany` without `select` — over-fetching
19 `prisma.*.findMany(` callsites; spot-checks show several without `select`, pulling all columns (including the JSON `data` blob on `Template`, which is huge).
**Fix:** Add `select: { ... }` to list endpoints — especially [src/app/api/admin/users/route.ts](src/app/api/admin/users/route.ts) and template lists.

### PERF-05 · `isObjectKeyReferencedOutsideTemplate` runs O(N×6) full-text scans
**File:** [src/app/api/templates/[id]/route.ts:44-97](src/app/api/templates/[id]/route.ts:44)
**Issue:** For every public-storage key in a template (potentially dozens), it runs a UNION ALL across `Template`, `TemplateRevision`, `FontFile`, `AppSetting`, plus 2 raw queries — each using `POSITION(... IN data::text)`, which forces a sequential scan of every JSON blob. On a 10k-row table this is multi-second per call.
**Fix:** Maintain a `template_media_refs` join table (templateId, key, refType) populated on save, then `SELECT 1 FROM template_media_refs WHERE key = $1 AND template_id <> $2 LIMIT 1`.

### PERF-06 · Sequential `await` in import loops
**Files:** [src/app/api/tools/canva-import/extension-import/route.js:300](src/app/api/tools/canva-import/extension-import/route.js:300), [src/app/api/editor/elements/publish-from-canvas/route.ts:260](src/app/api/editor/elements/publish-from-canvas/route.ts:260), [src/lib/tools/arabicTranslate.server.js:63](src/lib/tools/arabicTranslate.server.js:63)
**Issue:** `for (const x of items) { await fetch/translate/process(x) }` serializes calls.
**Fix:** `await Promise.all(items.map(...))` with concurrency-limited batching (`p-limit`-style) to avoid hammering R2 / Replicate.

### PERF-07 · `.next/` build cache is 3.1 GB
Likely accumulated across many dev/build cycles. Not a runtime cost, but slows fresh installs and CI cold starts.
**Fix:** `rm -rf .next` periodically; consider `next.config.mjs` `output: "standalone"` for slimmer deploy artifacts.

### PERF-08 · 11 code clones (jscpd)
**Highlights:**
- [src/lib/media/aiExpand/normalize.server.ts](src/lib/media/aiExpand/normalize.server.ts) ↔ [src/lib/media/objectRemoval/normalize.server.ts](src/lib/media/objectRemoval/normalize.server.ts) — 69 lines duplicated. Same pattern for `storage.server.ts` and `providers/replicate.server.ts`.
- [src/app/(dashboard)/settings/BackgroundCategoriesSection.js](src/app/(dashboard)/settings/BackgroundCategoriesSection.js) ↔ [src/app/(dashboard)/settings/SettingsClient.js](src/app/(dashboard)/settings/SettingsClient.js) — 41 + 31 lines duplicated.
- [src/lib/backgrounds/categorySettings.js](src/lib/backgrounds/categorySettings.js) ↔ [src/lib/templates/templateSettings.js](src/lib/templates/templateSettings.js) — 34 lines.
**Fix:** Extract `lib/media/replicate.common.ts` and `lib/settings/categorySection.shared.ts`.

### PERF-09 · No `runtime = "edge"` candidates declared
All routes default to nodejs runtime. Public read-only endpoints (`mobile/openapi`, `storage/public`) would benefit from edge runtime — lower latency and stronger DoS resilience.

### QUAL-02 · Duplicate logger implementations
**Files:** [src/lib/logging/logger.js](src/lib/logging/logger.js) (91 lines) AND [src/lib/logging/logger.ts](src/lib/logging/logger.ts) (76 lines) — both export a `logger` object with slightly different APIs.
**Fix:** Keep the `.ts` version (it supports `.child(context)`), delete the `.js` shim, repoint all imports.

### QUAL-03 · 93 `any` annotations + 9 `@ts-ignore`/`@ts-expect-error`
Concentrated in the API routes that touch Prisma JSON columns (e.g. `template: any`, `tx: any`).
**Fix:** Define `Template` view types in `src/types/template.ts` and use them at the route boundary.

### QUAL-04 · Prisma client generated into `src/generated/prisma`
Working but unusual; the generated directory is ~1.2k lines of `Template.ts` + namespace types committed to git. Each schema change forces a commit. With `output = "../node_modules/.prisma/client"` (the default) you avoid noisy diffs.
**Fix:** Move the Prisma client output back to `node_modules`; add `.prisma/client` to gitignore where needed.

### QUAL-05 · ESLint config is effectively empty
**File:** [eslint.config.mjs](eslint.config.mjs) — just inherits `next/core-web-vitals`. Result: `npx eslint src/` exits 0 with no findings even though there are 24 TS errors, dozens of `any`s, and 6 stray `console`s.
**Fix:** Add `@typescript-eslint/recommended`, `react-hooks/exhaustive-deps`, `no-console: ["warn", { allow: ["warn", "error"] }]`. Use `eslint-plugin-import` to catch the duplicate logger / circular imports.

### QUAL-06 · Mixed `.js`/`.tsx` for client components
Most settings/import/mobile-settings clients are `.js` despite being React 19 client components with non-trivial state. They lose JSX-prop type checking on top of the missing `checkJs`. See the list of >800 LOC `.js` files in QUAL-01.

### QUAL-07 · Inline route handlers >500 LOC
- [src/app/api/templates/route.ts](src/app/api/templates/route.ts) — 974 LOC, 4 `$transaction` blocks.
- [src/app/api/tools/canva-import/extension-import/route.js](src/app/api/tools/canva-import/extension-import/route.js) — 1,933 LOC.
**Fix:** Extract handlers into `src/lib/templates/handlers/` and have `route.ts` import + re-export `GET/POST`.

### QUAL-08 · `.env`, `.env.local`, and `.tmp-canva-gold-ribbon.webp` exist in working tree
`.env` is gitignored (good) but co-exists alongside `.env.example` and `.env.local` — confirm whether `.env` is the dev secret file or a leftover. The `.tmp-*` and `.codex_canva_debug_*.js` files in the repo root look like one-off debug scripts; consider moving them under `scripts/dev/`.

### REL-02 · No observability hooks (Sentry/OTel/Datadog absent)
Errors bubble up to Next's default handlers. The structured `logger` writes to stdout — fine for Vercel, opaque elsewhere.
**Fix:** Add `@sentry/nextjs` or OpenTelemetry middleware; tag with `userId` and `requestId` (the logger already supports child contexts).

### REL-03 · Single Zustand store, no persistence guarantees
`editorStore.ts` is fully in-memory. A page refresh during template editing loses unsaved state. Consider `zustand/middleware/persist` for draft autosave.

---

## 🔵 Info

- **SEC-INFO-1** — Bcrypt rounds = 12 ✅ Reasonable.
- **SEC-INFO-2** — Mobile signature uses 5-min skew tolerance ✅ standard.
- **SEC-INFO-3** — Storage proxy properly validates path segments ([src/app/api/storage/public/[...key]/route.ts](src/app/api/storage/public/[...key]/route.ts)).
- **PERF-INFO-1** — `Promise.all` used in 24 spots ✅ team is aware of parallelism.
- **PERF-INFO-2** — Prisma uses `$transaction` correctly in 10 places (no manual rollback bugs spotted).
- **PERF-INFO-3** — DB has 30 indexes across 11 models — coverage looks reasonable but verify against actual query patterns.
- **PERF-INFO-4** — 21 inline `style={{}}` JSX usages — low, acceptable.
- **QUAL-INFO-1** — `jsconfig.json` exists alongside `tsconfig.json` — likely redundant in a TS-first repo.
- **QUAL-INFO-2** — `tsconfig.tsbuildinfo` (289 KB) is committed-ish (gitignored, but present) — that's fine.
- **QUAL-INFO-3** — `proxy.js` in `src/` — confirm whether this is still wired up; it sits orphaned.
- **QUAL-INFO-4** — 30 `setInterval`/`setTimeout` usages, mostly in canvas animation; verify all are cleared on unmount (`useEffect` cleanup).
- **QUAL-INFO-5** — `src/app/api/tools/canva-import/extension-import/route.js` uses CORS — only place. Make sure it actually needs it.
- **REL-INFO-1** — `node_modules` is 810 MB. Could trim with `npm dedupe` and audit unused deps (e.g. is `swagger-ui-dist` shipped to clients or just used at build?).
- **REL-INFO-2** — Generated Prisma client commits a 783-LOC `prismaNamespace.ts` — diff noise.

---

## Recommended Next Steps (prioritized)

| # | Action | Effort | Impact |
|---|---|---|---|
| 1 | `npm audit fix` and bump to `next@16.2.6` | 30 min | Closes 10 high CVEs |
| 2 | Add `withMobileAuth` wrapper to every `src/app/api/mobile/**` route | 1 day | Closes data-scrape surface |
| 3 | Replace dev `AUTH_SECRET` fallback with hard fail | 10 min | Removes prod risk |
| 4 | Cap slug retry loops at 50 + DB-constraint fallback | 1 hour | Prevents accidental DoS |
| 5 | Stand up GitHub Actions (`tsc --noEmit`, `next build`, `npm audit`) | 2 hours | Locks in everything below |
| 6 | Fix 24 TypeScript errors and bump `target` to ES2020 | 1 day | Removes runtime BigInt + null surprises |
| 7 | Enable `checkJs` and migrate the top-10 large `.js` files to `.ts` | 2-3 days | Brings 30k LOC under type checking |
| 8 | Slice `editorStore.ts` and split `SidePanel.tsx` | 3-5 days | Major editor-perf win |
| 9 | Introduce `template_media_refs` table for storage GC | 1 day | Removes O(N) full-text scans |
| 10 | Add Sentry + structured request IDs everywhere | 4 hours | Production debuggability |

---

## Appendix A — Full TypeScript error list (`tsc --noEmit`)

```
src/app/api/admin/users/route.ts(172,47): TS2345 — optional vs required mismatch on update payload
src/app/api/editor/backgrounds/imported/route.ts(192,11): TS2353 — unknown property 'bytes'
src/app/api/editor/backgrounds/imported/route.ts(197,13): TS2353 — unknown property 'ownerId'
src/app/api/editor/fonts/route.ts(161,32): TS2339 — 'skippedDuplicate' not on result
src/app/api/editor/fonts/route.ts(166,28): TS2339 — same as above
src/app/api/editor/media/route.ts(400,11): TS2322 — "" not assignable to template-preview-* literal
src/app/api/mobile/app-settings/route.ts(46,7):  TS2353 — unknown property 'deviceType'
src/app/api/mobile/background-categories/[id]/images/route.ts(54-55): TS18047 ×4 — 'item' possibly null
src/app/api/mobile/background-categories/route.ts(38,33): TS7053 — implicit any string index
src/app/api/mobile/shapes/[id]/file/route.ts(49,29): TS2345 — Buffer not assignable to BodyInit
src/app/api/storage/public/[...key]/route.ts(59,40): TS2345 — {} not string
src/app/api/templates/[id]/route.ts(77,29): TS2347 — untyped function call w/ type args
src/app/api/templates/[id]/route.ts(86,14): TS7006 — implicit any on 'error'
src/app/api/templates/[id]/route.ts(88,26): TS2737 — BigInt requires ES2020
src/app/api/templates/route.ts(461,19): TS7006 — implicit any on 'owner'
src/components/editor/SidePanel.tsx(959,7): TS2322 — TimelinePreviewStatus mismatch
src/components/editor/Toolbar.tsx(958,13): TS2322 — null not assignable to TimelinePreviewStatus
src/components/editor/Toolbar.tsx(1206,17): TS2322 — string not assignable to TimelinePreviewStatus
src/lib/media/aiExpand/normalize.server.ts(263,13): TS7006 — implicit any on '_error'
src/lib/media/aiExpand/providers/replicate.server.ts(254,7): TS2322 — aspect-ratio literal mismatch
src/lib/mobile/templateList.ts(110,21): TS7006 — implicit any on 'tag'
```

---

## Appendix B — Dependency CVE summary (`npm audit`)

| Severity | Count | Auto-fixable |
|---|---|---|
| High | 10 | 9 (one needs major bump of `next-auth`) |
| Moderate | 9 | 8 |
| Low / Info | 0 | — |

Run `npm audit fix` to apply all non-major upgrades, then `npm audit fix --force` only for `next-auth` after reviewing the v5 migration guide.

---

*Generated by `code-quality` skill on 2026-05-26.*
