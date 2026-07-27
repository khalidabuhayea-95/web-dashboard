# Backend / API / Dashboard / Editor Audit — Performance & Security

**Project:** `web-dashboard` (Next.js 16 App Router · React 19 · Prisma/Postgres · NextAuth · Konva)
**Date:** 2026-07-27
**Scope:** All server code — API routes, auth layer, mobile backend, import pipeline, storage, editor client, infra.
**Method:** 5 parallel deep-review passes (auth ×2, injection/SSRF/infra, backend perf, editor perf) + independent firsthand verification of every Critical/High against the current code and git history. This supersedes `AUDIT_REPORT.md` (2026-05-26); the codebase changed substantially since (8 commits, ~32k LOC).

---

## Summary

| Category | 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low/Info |
|---|---|---|---|---|
| Security | 2 | 3 | 6 | 7 |
| Performance — Backend | 1 | 4 | 5 | 3 |
| Performance — Editor | 1 | 3 | 5 | 4 |
| Build / Quality / Reliability | 1 | 2 | 3 | 2 |
| **Total** | **5** | **12** | **19** | **16** |

**Fix these five first:** `SEC-1` (hardcoded admin password), `SEC-2` (dependency CVEs), `SEC-3` (SVG stored XSS + no CSP), `PERF-B1` (search fetch-all), `PERF-E1` (60fps animation re-render).

**Overall health:** The architecture is fundamentally sound — no SQL injection, no IDOR, correct transaction usage, proper token rotation/hashing, healthy Zustand selectors, and correctly code-split bundles. The exposure is concentrated in **one committed secret**, **outdated dependencies**, **a handful of unauthenticated/unindexed public read paths**, and **un-memoized 60fps canvas rendering**. Most items are contained and cheaply fixable.

---

# 🔴 CRITICAL

## SEC-1 · Hardcoded, non-rotatable system-admin password committed to git
**File:** [dashboardUsers.server.js:11-16](src/lib/auth/dashboardUsers.server.js:11) · seeded at `:49-72` · triggered from [auth.js:39](src/lib/auth/auth.js:39)

```js
const SYSTEM_ADMIN = {
  name: "khalid AbuHayea",
  email: "khalidabuhayea@gmail.com",
  password: "Rtyu$56789",
  role: "admin",
};
```

`ensureSystemAdmin()` runs on **every login attempt** and every authenticated request ([roles.js:14](src/lib/auth/roles.js:14)). On a fresh DB it seeds a full `isSystemAdmin` account with `hashPassword("Rtyu$56789")`. Verified committed in `e0aa60f` and git-tracked. The account is **un-bannable, un-deletable, and its password cannot be changed through the app** (`updateDashboardUser` throws for the system admin, `:279-289`).

**Exploit:** Anyone with repo read access (contractor, leaked source, mirror) logs in at `/login` with `khalidabuhayea@gmail.com` / `Rtyu$56789` → permanent system-admin on every environment built from this code: user management, push-to-all-devices, and the mobile settings that hold bearer-token and OAuth secrets.

**Fix (do now):** Treat `Rtyu$56789` as compromised — **rotate immediately**. Remove the literal; seed from a required `SYSTEM_ADMIN_PASSWORD` env var (or a one-time random password logged to the operator only); allow rotation; purge from git history (`git filter-repo`). CWE-798.

## SEC-2 · Outdated dependencies — 1 critical + 15 high CVEs
**Source:** `npm audit` (30 total: 1 critical, 15 high, 12 moderate, 2 low)

- **`next-auth` ≤4.24.14 (CRITICAL):** `getToken()` DoS on malformed Bearer header; homoglyph email-normalization bypass; OAuth state/nonce/PKCE cookies not bound to provider. **Fix = patch bump to `4.24.15`** (not a major — the May report was wrong about this).
- **`next` 16.1.6 (HIGH):** HTTP request smuggling in rewrites, `next/image` cache-exhaustion DoS, Server-Actions CSRF bypass via null origin, RSC issues. **Bump to `next@16.2.12`.**
- **Other high (transitive, auto-fixable):** `ws`, `brace-expansion`, `@xmldom/xmldom` (XML injection — used by PSD/Canva parsing), `hono`/`@hono/node-server`, `path-to-regexp`, `picomatch`, `fast-uri`, `js-yaml`, `express-rate-limit`, `fast-xml-builder`, `flatted`.
- **`fabric` <7.4.0 (moderate, direct):** SVG gradient XSS — **but `fabric` is imported nowhere in `src` (dead dep); removing it eliminates the CVE entirely** (see PERF-E-L).
- **`firebase-admin` chain** (`uuid`/`gaxios`/`teeny-request`) needs a major bump — defer and review.

**Fix:** `npm audit fix` (clears most), manually bump `next`→16.2.12 and `next-auth`→4.24.15, remove dead deps `fabric` + `fonteditor-core`, then re-audit. Add `npm audit --omit=dev` to CI.

---

# 🟠 HIGH

## SEC-3 · Stored XSS via SVG upload served same-origin, with no CSP anywhere
**Files:** [editor/media/route.ts:132-143](src/app/api/editor/media/route.ts:132) (upload) + [storage/public/[...key]/route.ts:57](src/app/api/storage/public/[...key]/route.ts:57) (serve) + no CSP in `next.config.mjs`/`proxy.js`/`Caddyfile`

`ensureValidUpload` for `kind:"image"` only checks `mimeType.startsWith("image/")` — so `image/svg+xml` passes and is stored **raw** (plain image uploads aren't rasterized). The storage proxy streams it back with the **stored `Content-Type` verbatim** and **no `Content-Disposition`**, so it renders inline as a document on the app origin. Verified: **zero `Content-Security-Policy`** in the codebase, so nothing blocks inline script; `nosniff` doesn't help because the type genuinely is SVG.

**Exploit:** An authenticated editor uploads a `<script>`-bearing SVG → gets `/api/storage/public/users/<id>/…/evil.svg` (same origin). A victim who opens that link executes attacker JS with the victim's session/cookies/localStorage. (Passive `<img>` thumbnails don't execute SVG — the vector is a direct link.)

**Fix:** Reject `image/svg+xml` on upload (or sanitize with `svg-sanitizer`/DOMPurify); serve user media with `Content-Disposition: attachment` + neutral `Content-Type`, or from a separate cookieless origin. Add a strict CSP (`script-src`, `object-src 'none'`, `base-uri 'none'`) and HSTS — set via `next.config.mjs` `headers()` or Caddy (note `proxy.js`'s matcher excludes `.svg`, so middleware-only headers won't cover SVG responses). Same permissive check exists in [push/upload-image/route.ts:49](src/app/api/admin/push/upload-image/route.ts:49) (admin-only, lower reach).

## SEC-4 · Dashboard login has no brute-force protection
**Files:** [auth/[...nextauth]/route.js](src/app/api/auth/[...nextauth]/route.js) + `authorize()` in [auth.js:38-68](src/lib/auth/auth.js:38)

The credentials login path has **no rate limit, no failed-attempt counter, no lockout**. bcrypt cost 12 slows but does not stop online guessing against known admin emails — and SEC-1 hands attackers a valid admin email. The only block is a manual admin-set `bannedUntil`.

**Fix:** Add IP+email throttling and progressive lockout on the credentials callback (the in-repo `checkRateLimit` can back it — but see SEC-9 about its limits). Consider CAPTCHA after N failures.

## SEC-5 · Mobile catalog + OAuth endpoints are unauthenticated and unthrottled; the HMAC gate is dead code
**Files:** [mobile/auth.js:36-74](src/lib/mobile/auth.js:36) + all `mobile/templates|fonts|shapes|elements|background-categories|app-settings|taxonomy` routes

Two compounding issues:
1. **`verifyMobileRequest` (the HMAC app-attestation gate) is imported by zero routes** — it's dead code. It also **fails open** when `MOBILE_API_KEY_ID`/`MOBILE_API_SIGNING_SECRET` are empty, with no production guard ([:40-42](src/lib/mobile/auth.js:40)), and signs only method+path+query (not the body) with no replay/nonce protection — so it's unsafe to simply "turn on" later.
2. The **entire mobile catalog surface is public and carries no rate limiter**, and the **OAuth/refresh endpoints** (`auth/google|apple|facebook|refresh`) are unthrottled. The expensive per-user routes (AI media, favorites, devices) *are* correctly bearer-authenticated + rate-limited.

**Impact:** Full template/font/shape/asset catalog is anonymously scrapeable; the public [templates/[slug]/assets](src/app/api/mobile/templates/[slug]/assets/route.js:128) route does outbound `fetch` + `sharp` render with no throttle (CPU-DoS + limited stored-SSRF via designer-baked URLs); OAuth endpoints invite token-guessing/abuse.

**Fix:** Decide whether the catalog is intended public. Add IP rate-limiting to all catalog + OAuth routes (reuse `resolveRequestIp`). Either wire real auth (bearer) or, before ever relying on the HMAC, invert its fail-open (reject in production when unconfigured), sign the body, and add a nonce cache. Enforce centrally in `proxy.js` for `/api/mobile/:path*`.

---

# 🟡 MEDIUM — Security

## SEC-6 · Google mobile login accepts an ID token minted for any client when unconfigured
[userAuth.server.js:422-434](src/lib/mobile/userAuth.server.js:422) — the `aud` audience check is **skipped entirely** when no Android/iOS client IDs are configured (the default). Google's tokeninfo validates the token is genuinely Google-signed, but not that it was issued *for this app*. An attacker who captures a victim's Google ID token from any other OAuth app can replay it to `/api/mobile/auth/google` and be issued a first-party session → **account takeover**. Apple/Facebook do this correctly (fail closed). **Fix:** require ≥1 configured audience; reject when the allow-list is empty.

## SEC-7 · Two authenticated blind-SSRF fetchers (no host allowlist, no size cap, follow redirects)
- **Imported-background preview:** [backgrounds/imported/route.ts:190](src/app/api/editor/backgrounds/imported/route.ts:190) → `downloadRemoteAsset(assetUrl)` where `assetUrl` is request-body controlled. No allowlist, follows redirects, buffers full `arrayBuffer()` with no cap.
- **Canva raster-palette hydration:** [rasterPalette.server.ts:203-231](src/lib/tools/rasterPalette.server.ts:203) fetches client-supplied `fabricData.objects[].src` server-side.

Both let an authenticated user force server requests to `169.254.169.254`, `10.x`, `localhost:6379`, etc. Blind (only a thumbnail/palette returns), so best for internal probing + memory-exhaustion DoS rather than data theft. **Fix:** host allowlist (your CDN/R2 + Canva), resolve DNS and block RFC1918/link-local/loopback/IPv6-ULA, disable/re-validate redirects, cap response bytes. (Fixed-host importers — Freepik, Replicate, gwfh, appchief, Canva-URL — are correctly constrained.)

## SEC-8 · Canva import-token signing secret falls back to `DATABASE_URL`
[canvaImportAuth.js:20-27](src/lib/tools/canvaImportAuth.js:20) — `process.env.CANVA_IMPORT_TOKEN_SECRET || process.env.DATABASE_URL`. If the dedicated secret is unset, the DB connection string (with credentials) becomes the HMAC key. Anyone who learns `DATABASE_URL` can forge import tokens for arbitrary `userId`. **Fix:** require `CANVA_IMPORT_TOKEN_SECRET`; throw if unset — never reuse `DATABASE_URL` as key material.

## SEC-9 · Rate limiter is in-memory and IP-spoofable
[rateLimit.server.js:3](src/lib/security/rateLimit.server.js:3) uses a per-process `Map` — **ineffective across serverless/multi-instance/replicas** (each has its own buckets; resets on cold start). `resolveRequestIp` takes the client-supplied `X-Forwarded-For[0]` **first**, so an attacker can send a random XFF per request for a fresh bucket unless the edge overwrites it. **Fix:** back it with Redis/Upstash for shared state; trust only the proxy-set client IP (use `cf-connecting-ip` first behind Cloudflare, or a fixed trusted-hop index), not arbitrary XFF.

## SEC-10 · Container runs as root and ships the build toolchain
[Dockerfile](Dockerfile) — single-stage `node:22-bookworm`, installs `build-essential`/`python3`, runs `npm ci` (dev deps) and `playwright install chromium`, with **no `USER` directive** → runtime runs as UID 0 with compilers + full Chromium resident. Large post-exploit surface. **Fix:** multi-stage build (build tools/dev deps stay out of the runtime layer); add `USER node`; set `no-new-privileges`, drop capabilities, `read_only` where possible in production.

## SEC-11 · Unauthenticated public storage proxy, no `..` normalization, no throttle
[storage/public/[...key]/route.ts:13-17](src/app/api/storage/public/[...key]/route.ts:13) — `getObjectKey` does only `trim`/`filter(Boolean)`/`join`, **no `..` rejection**; GET/HEAD are unauthenticated and unthrottled. Scoped to the public bucket and S3/R2's flat keyspace, so `..` is **not** real traversal today (the May report's "properly validates" was overstated — it doesn't validate, S3 semantics save it). Real risks: any public-bucket object is world-readable by key (confidentiality = UUID unguessability only); latent traversal if the storage driver ever becomes filesystem-backed; no DoS throttle. **Fix:** reject `..`/leading-slash defensively; confirm nothing semi-private lands in the public bucket; add IP throttle.

---

# 🔵 LOW / INFO — Security

- **SEC-L1 · Sync `tools/canva-import` unthrottled** ([route.ts:15-41](src/app/api/tools/canva-import/route.ts:15)) — `maxDuration=300` headless-browser import behind session only; an authenticated designer can exhaust workers. The async `import-jobs` path *is* throttled. Add a per-user limit.
- **SEC-L2 · `settings/*` GET readable by any designer** — client IDs, app IDs, and which secrets are set are returned to non-admins (raw secrets *are* masked via `*Masked`/`*Configured`, so no raw leak). Writes are correctly admin-only. Consider admin-gating the reads.
- **SEC-L3 · `dangerouslySetInnerHTML` in fonts admin** ([FontsClient.js:121](src/app/(dashboard)/fonts/FontsClient.js:121)) — interpolates `font.fileUrl` into a `<style>` without escaping. Admin-only + server-generated URL today (Low), but validate it's `https:` and CSS-escape. This is the only `dangerouslySetInnerHTML` in the codebase.
- **SEC-L4 · Health endpoint leaks DB error detail** ([health/route.ts:24-30](src/app/api/health/route.ts:24)) — unauthenticated 503 returns `error.message` (can include host/port/user). Return a generic message; log details server-side.
- **SEC-L5 · Logout doesn't revoke the access JWT** — valid until `exp` (~60 min) after logout (refresh + device token *are* revoked). Standard JWT trade-off; note for completeness.
- **SEC-L6 · No CSRF token / origin check on mutating JSON routes** — relies on NextAuth's `SameSite=Lax` cookie (limits cross-site POST but no defense-in-depth). Consider explicit same-origin checks on mutating handlers.
- **SEC-L7 · Dev `AUTH_SECRET` fallback** ([auth.js:11-20](src/lib/auth/auth.js:11)) — `"local-dev-auth-secret-change-me"` used only in non-prod; **production correctly throws if unset**. Fail-safe; noted only because a `NODE_ENV=staging` deploy would use the committed value.

**SQL injection — none found.** Every `$queryRawUnsafe`/`$executeRawUnsafe` was traced: the flagged `templates/[id]` UNION uses bound params (`$queryRaw` tagged template) and the one interpolated identifier iterates a hardcoded constant array; `importedElements`/`importedBackgrounds`/`importJobsStore` parameterize all user values via a `nextParam()` `$N` helper and only interpolate constant DDL. Safe, but the manual `$N` building is a footgun — add allowlist assertions.

---

# 🟠 PERFORMANCE — Backend

## PERF-B1 · 🔴 Mobile search loads the entire published catalog and paginates in JS
[templateList.ts:218-228](src/lib/mobile/templateList.ts:218) — in `searchMode:"queryOnly"`, `findMany({ where: baseWhere })` with **no `take`/`skip`**, then `.filter()` + `.slice()` in Node. On a public endpoint this reads *all* published rows per request, sorts unindexed by `updatedAt`, and (because `select` includes `thumbnailDataUrl`, which holds base64 for Canva imports) can move tens–hundreds of MB DB→app per search. **Fix:** push the query into SQL (`contains` / `tags array_contains`) with `skip`/`take`/`count` inside the existing `$transaction` (the default branch already does this correctly); back with the indexes below.

## PERF-B2 · 🟠 Missing `Template` indexes on every hot filter/sort column
[schema.prisma:42-44](prisma/schema.prisma:42) indexes only `ownerId`, `status`, `slug`. Hot queries filter/sort on `category`, `subCategory`, `updatedAt`, and `tags (@>)` — none indexed → Postgres filters by low-selectivity `status` then sorts all matches in memory; `tags` seq-scans. **Fix:**
```prisma
@@index([status, category, subCategory, updatedAt(sort: Desc)])
@@index([status, updatedAt(sort: Desc)])
@@index([ownerId, updatedAt(sort: Desc)])
```
plus a raw migration: `CREATE INDEX … USING GIN (tags jsonb_path_ops)` and `pg_trgm` on `name`. The pattern already exists — `editor_element_assets` has tags GIN indexes; it just wasn't applied to `Template`.

## PERF-B3 · 🟠 Template delete runs 3 sequential full-JSON-blob text scans per media key
[templates/[id]/route.ts:44-117](src/app/api/templates/[id]/route.ts:44) — `isObjectKeyReferencedOutsideTemplate` runs, **per media key, sequentially**, a UNION over `Template`/`TemplateRevision`/`FontFile`/`AppSetting` plus 2 more raw queries, all using `POSITION(key IN <jsonb>::text)` — which detoasts and casts the entire blob to text (non-indexable). A design with K=30 keys → ~90 sequential large-blob seq scans per delete, scanning the ever-growing `TemplateRevision.snapshot` each time. **Fix:** maintain a `template_media_ref(objectKey, templateId)` join table populated on save → O(1) indexed lookups; at minimum `Promise.all` the per-key checks and use `= ANY($1)`.

## PERF-B4 · 🟠 Editor/admin template list returns the whole table when unpaginated
[templates/route.ts:604-610](src/app/api/templates/route.ts:604) — `GET /api/templates` only paginates when `?page`/`?perPage` is present; otherwise returns **all** matching rows (with `thumbnailDataUrl`), unbounded and growing forever, sorted unindexed. **Fix:** always apply a default `take` cap; drop `thumbnailDataUrl` from list selects.

## PERF-B5 · 🟠 Unbounded slug/name uniqueness loops (DoS / pool-exhaustion on writes)
[templates/route.ts:81-89, 96-112](src/app/api/templates/route.ts:81) + [canvaImportTemplate.js:72-94](src/lib/tools/canvaImportTemplate.js:72) — `while(true){ findUnique }` with no iteration cap, run on every create/update. A base name shared by many templates makes each new save walk the whole collision chain (one query each); it also races (`ensureUniqueName` has no unique-constraint backstop). **Fix:** cap at ~25 then append a random suffix; or resolve in one `LIKE` query; or rely on the unique constraint + a single `P2002` retry ([favorites.server.js:126](src/lib/mobile/favorites.server.js:126) is the model).

## Medium (backend)
- **PERF-B6 · Sequential external translation on request paths** ([arabicTranslate.server.js:63-70](src/lib/tools/arabicTranslate.server.js:63)) — N unique strings translated one-at-a-time (8s timeout each) synchronously in `publish-from-canvas` and `extension-import`. Use `p-limit(5)` / batch `q` params.
- **PERF-B7 · Per-item sequential upload+upsert loops** ([publish-from-canvas/route.ts:260-320](src/app/api/editor/elements/publish-from-canvas/route.ts:260), extension-import `:303-359`) — N sequential storage round-trips + DB upserts on a user-waited request. Bounded-concurrency `Promise.all`.
- **PERF-B8 · `by-subcategory` fan-out** ([by-subcategory/route.js:94-122](src/app/api/mobile/templates/by-subcategory/route.js:94)) — one `findMany` per (category×subcategory), dozens concurrent on a hot public endpoint → connection-pool bursts. Single windowed `ROW_NUMBER()` query, or cap concurrency + add the B2 index.
- **PERF-B9 · Base64 thumbnails shipped twice** ([mobileProject.js:1975](src/lib/templates/mobileProject.js:1975)) — emits `thumbnailUrl` **and** `thumbnailDataUrl` (same base64) per template; mobile `pageSize` up to 200 → multi-MB responses. Emit only the URL; migrate imported thumbnails to storage.
- **PERF-B10 · Snapshot recovery inlines base64** ([importSnapshotRecovery.js:345-428](src/lib/tools/importSnapshotRecovery.js:345)) — sequential external image refetch (10 MB each) stored back as base64 into `fabricData`, bloating `Template.data`. Bounded concurrency + re-host to storage.

## Low (backend)
- **PERF-B11 · OFFSET pagination** — deep pages scan-and-discard; switch to keyset on `(updatedAt, id)` once B2 lands.
- **PERF-B12 · admin/stats** aggregates over unindexed `Template.createdAt` + growing `TemplateRevision` (but correctly `Promise.all`'d and rate-limited) — add `@@index([createdAt])`, cache the response.
- **PERF-B13 · `TemplateRevision` grows unbounded** (no pruning) — the biggest multiplier for B3. Add retention (keep N latest per template) / archival.

---

# 🟠 PERFORMANCE — Editor

Metrics: `CanvasEditor.tsx` 4,598 LOC · `SidePanel.tsx` 5,968 · `Toolbar.tsx` 2,215 · `editorStore.ts` 2,424 (72 `set()`). **`React.memo` across all of `src/`: 0.**

## PERF-E1 · 🔴 Animation playback reconciles the whole scene tree through React at 60fps
[PagesTimeline.tsx:457-473](src/components/editor/PagesTimeline.tsx:457) — a RAF loop calls `setTimelinePlayheadMs(...)` ~60×/sec. The root `CanvasEditor` subscribes to that field ([:2189](src/components/editor/CanvasEditor.tsx:2189)), so the 4,598-line component re-renders every frame → the **un-memoized** `CanvasPageScene` ([:1531](src/components/editor/CanvasEditor.tsx:1531)) re-runs `elements.map` + `resolveAnimatedElementPoseAtFrame` per element and re-creates every (un-memoized) node → react-konva diffs and repaints all nodes. Fine at ~5 layers; drops frames on complex animated designs (a core feature). **Fix:** drive playback imperatively via a ref — the export recorder **already does this right** at [:2916](src/components/editor/CanvasEditor.tsx:2916) (`stage.getLayers().forEach(l => l.draw())` reading `timelinePlayheadMsRef`). Keep the live playhead in a ref and update Konva attrs directly; memoize `CanvasPageScene` + node components (stabilize the inline arrow props at `:4312-4319`/`:1727-1747` first, or memo is defeated).

## PERF-E2 · 🟠 Property sliders serialize the whole design + push an undo entry on every input tick
[PropertiesPanel.tsx:380-396](src/components/editor/PropertiesPanel.tsx:380) — the opacity `range` `onChange` calls `updateElement` **without `recordHistory:false`** (also `:595/:696/:735/:806`). `updateElement` unconditionally `recordHistory()` → `serializeHistorySnapshot` = `JSON.stringify` of all pages+elements + full-string dedupe. One slider drag = dozens of full-design stringifies (main-thread jank) + 30+ undo entries. **Fix:** pass `{ recordHistory:false }` during input, commit once on pointer-up (the image-filter path at `:253` already does this).

## PERF-E3 · 🟠 A hidden export `<Stage>` duplicates the whole scene at all times
[CanvasEditor.tsx:4487-4525](src/components/editor/CanvasEditor.tsx:4487) — a second `<Stage>` with a full `<CanvasPageScene elements={elements}>` inside an off-screen div, with **no mount guard** → always resident. ~2× Konva nodes and 2× decoded media (a second `HTMLImageElement`/`<video>` per layer) at rest. **Fix:** mount only while `isRenderingPreview`/`previewGenerationActive`, or build on-demand at export and tear down.

## PERF-E4 · 🟠 `/fonts` admin page renders all ~1900 families unvirtualized
[FontsClient.js:499](src/app/(dashboard)/fonts/FontsClient.js:499) — `fonts.map(...)` over the whole list + a `@font-face` rule injected per font → slow first paint, layout thrash, glyph-download flood. **Fix:** window it (`react-window`) or reuse the editor's incremental-reveal (`slice(0, visibleFontCount)`).

## Medium (editor)
- **PERF-E5 · Sync full-design `JSON.stringify` per commit** ([editorStore.ts:874](src/store/editorStore.ts:874)) — every drag-end/transform-end/property change stringifies the whole design. Structural snapshot + diff, or move off the commit path (`requestIdleCallback`).
- **PERF-E6 · Text re-measure on every element mutation** ([CanvasEditor.tsx:3320-3374](src/components/editor/CanvasEditor.tsx:3320), deps `[elements]`) — depend on a derived text-font signature instead.
- **PERF-E7 · Transformer shares the content Layer + re-attaches on every edit** (`:4289`/`:3297-3309`) — give it its own `<Layer>`; narrow deps to `selectedIds`.
- **PERF-E8 · Wheel-zoom re-renders the full scene per tick** (`viewport` local state, `:2537`) — apply zoom imperatively to the Stage via ref, or memoize the scene.
- **PERF-E9 · `SidePanel`/`Toolbar` re-render on every `pages` change** — split into leaf components subscribed to just what they need.

## Low (editor)
- **PERF-E10 · GIF RAF loop always running** ([CanvasEditor.tsx:608-617](src/components/editor/CanvasEditor.tsx:608)) — throttle to GIF frame rate; pause on `visibilitychange`.
- **PERF-E11 · Dead dependencies** — `fabric` and `fonteditor-core` are declared but imported **nowhere** in `src` (verified). Remove both (also clears the `fabric` CVE in SEC-2).
- **PERF-E12 · No `experimental.optimizePackageImports`** for `lucide-react` (widely imported) — minor first-load win.
- **PERF-E13 · Per-frame playhead clamp** ([editorStore.ts:1025-1028](src/store/editorStore.ts:1025)) — precompute total duration.

---

# 🟠 BUILD / QUALITY / RELIABILITY

- **QUAL-1 · 🔴 Build ships with 52 type errors and lint disabled.** `tsc --noEmit` reports **52 errors** (up from 24 in May); [next.config.mjs:9-10](next.config.mjs:9) sets `typescript.ignoreBuildErrors:true` + `eslint.ignoreDuringBuilds:true`, so `next build` ignores all of them. Errors cluster in `admin/fonts`, `admin/stats`, `mobile/auth/*`, `background-categories` (`item possibly null`), editor `TimelinePreviewStatus`, and a BigInt-needs-ES2020 issue at `templates/[id]:88`. **Fix:** fix the ~12 unique patterns, bump `target` to ES2020, remove the ignore flags, run `tsc --noEmit` in CI.
- **QUAL-2 · 🟠 No CI, no wired test runner.** `.github/workflows/` absent; no `vitest`/`jest`/`playwright` config despite `playwright` in devDeps. ~13 `*.test.ts` files exist (animation parity, previewRuntime) but nothing runs them. **Fix:** GitHub Actions running `tsc --noEmit`, `next build`, `npm audit`, and the existing tests.
- **QUAL-3 · 🟠 134 `.js` files (~37.8k LOC) escape type-checking.** `allowJs` is on, `checkJs` is off, so a third of `src` is untyped (grew from ~31k in May); 162 `any` (up from 93). New code trends into the unchecked half. **Fix:** enable `checkJs` incrementally; migrate leaf utilities to `.ts`.
- **QUAL-4 · 🟡 Duplicate logger** — `logger.js` and `logger.ts` coexist ([src/lib/logging](src/lib/logging)). Keep one.
- **QUAL-5 · 🟡 Repo junk in root** — `a.json` (captured auth-error), `n.txt` (Cloudflare 404 HTML), `.codex_canva_debug_*.js`, `.tmp-canva-gold-ribbon.webp`, a `.tmp/` dir of debug scripts. Remove / move under `scripts/dev/`.
- **QUAL-6 · 🟡 No observability** — errors hit Next defaults; the structured `logger` writes stdout only. Add Sentry/OTel tagged with the `requestId` the logger already threads.
- **REL-INFO · `proxy.js` is the global middleware** (Next 16 rename) — it sets security headers + request-ID logging on all non-static routes but does **no** auth/rate-limiting. It's the natural hook for centralizing SEC-4/SEC-5/SEC-9 enforcement.

---

# ✅ What's done right (verified — don't "fix" these)

**Security:** bcrypt cost 12; timing-safe comparisons (mobile HMAC + Canva token); mobile bearer auth **fails closed** (throws if secret unset); **no IDOR** anywhere (favorites/devices/media/templates/import-jobs all derive `userId` from the verified session/bearer, never from the body); refresh tokens hashed-at-rest with a pepper + single-use rotation + expiry; admin routes consistently `session → rate-limit → role`-gated; `app-settings` strips internal model IDs; `AUTH_SECRET` mandatory in prod; **no SQL injection** (all user input parameterized); Apple/Facebook logins pin audience/app_id; **no secrets in the client bundle**; fixed-host importers; `next/image` `remotePatterns` unset so the optimizer won't proxy arbitrary hosts.

**Backend perf:** paginated list+count in one `$transaction` with the `data` blob excluded (default list path); batched owner-name lookup (no N+1, capped at 50, single `findMany`); atomic job claim (`UPDATE … RETURNING`, no transaction held across network work); well-behaved worker (backoff, SIGTERM drain, in-process guard); memoized schema-ensure; `Cache-Control: max-age=300, SWR=600` on public mobile reads; editor/admin correctly no-cache.

**Editor perf:** Konva is properly code-split (`dynamic(ssr:false)`) — no editor-only heavy lib leaks into shared/non-editor bundles; heavy server libs are `serverExternalPackages`; Zustand uses 138 atomic primitive selectors (0 whole-store, 0 object-returning — no render storm); drag/transform commit imperatively on end; blur/shadow nodes `.cache()`/`clearCache()` disciplined with `perfectDrawEnabled={false}`; listeners balanced and every RAF has `cancelAnimationFrame`; in-editor lists bounded (incremental reveal + server pagination).

---

# Recommended order of work

| # | Item | Effort | Impact |
|---|---|---|---|
| 1 | **SEC-1** rotate + remove hardcoded admin password, purge git history | 30 min | Removes full-admin backdoor |
| 2 | **SEC-2** `npm audit fix` + bump `next`→16.2.12, `next-auth`→4.24.15, drop dead deps | 1–2 h | Closes 1 critical + 15 high CVEs |
| 3 | **SEC-3** block/sanitize SVG uploads, serve media as attachment, add CSP + HSTS | half day | Closes stored-XSS |
| 4 | **SEC-4/5/9** rate-limit login + catalog + OAuth in `proxy.js`; Redis-back + fix XFF | 1 day | Closes brute-force + scrape + bypass |
| 5 | **PERF-B1 + B2** SQL-side search + `Template` indexes | half day | Biggest public-path win |
| 6 | **PERF-E1 + E3** imperative playback + gate export stage | 1–2 days | Editor smoothness + memory |
| 7 | **SEC-6/7/8** Google `aud`, SSRF allowlist, Canva secret | 1 day | Closes takeover + SSRF |
| 8 | **QUAL-1/2** fix type errors, remove ignore flags, stand up CI | 1–2 days | Locks in everything above |
| 9 | **PERF-B3 + B5** media-ref table + cap slug loops | 1 day | Removes delete/write DoS |
| 10 | **SEC-10** non-root multi-stage Dockerfile | half day | Shrinks blast radius |

---
*Generated 2026-07-27 via multi-agent review with per-finding firsthand verification.*
