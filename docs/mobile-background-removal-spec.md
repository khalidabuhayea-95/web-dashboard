# Mobile Background Removal Service Spec

Last updated: 2026-03-26

## Objective

Introduce a reusable background-removal service that can be called from multiple backend locations and expose a new mobile-facing API that accepts `png`/`jpg`/`jpeg` uploads and returns the same image with the background removed.

Primary outcome:
- Mobile app can upload a local image and receive a transparent `png` result.
- Backend code no longer keeps background-removal logic embedded inside a single importer flow.
- Existing Freepik GIF transparency handling continues to work without regression.

Assumptions:
- Target users are mobile app users importing photos, stickers, and icon-like artwork.
- Success is measured by a working mobile flow plus a reusable backend service interface.
- No fixed delivery date was provided.

## Current behavior today

What exists now:
- `src/lib/tools/freepikImport.server.js` contains Freepik import orchestration.
- That importer only applies transparency processing for GIF assets through `convertGifWhiteToTransparent(...)`.
- GIF chroma-key processing lives in `src/lib/media/gifChromaKey.server.js`.
- There is no generic `png`/`jpg` background-removal service.
- There is no POST mobile upload endpoint for image processing.
- Existing mobile APIs under `/api/mobile/*` are read-oriented and documented through `src/lib/mobile/openapi.js`.
- Multipart upload handling already exists in `src/app/api/editor/media/route.ts`.
- A mobile request-signing helper exists in `src/lib/mobile/auth.js`, but current mobile GET routes do not enforce it.

Current gap:
- Uploading a `png` or `jpg` from mobile and receiving a cut-out image is not supported today.
- Background-removal logic is not exposed as a reusable service boundary.

## Scope and non-goals

In scope:
- Extract background-removal into a dedicated backend service module.
- Keep the current Freepik GIF flow working through the new service boundary or a compatible adapter.
- Add a new mobile API endpoint for `png`/`jpg`/`jpeg` uploads.
- Return a transparent `png` result.
- Add OpenAPI documentation for the new mobile endpoint.
- Add request validation, rate limiting, logging, and mobile request-signing enforcement for this write-heavy route.

Non-goals:
- No dashboard UI is required in v1.
- No GIF upload support for the new mobile endpoint.
- No batch processing in v1.
- No asynchronous job queue in v1 unless the chosen provider makes synchronous processing unworkable.
- No permanent library/catalog persistence for mobile uploads in v1.

## User flows or system behavior

### Flow A: Mobile upload and receive transparent image

1. User selects a local `png` or `jpg` image in the mobile app.
2. Mobile app sends `multipart/form-data` to the new endpoint.
3. API validates signature headers, file type, file size, and rate limits.
4. API calls the shared background-removal service.
5. Service normalizes input, runs background removal, and returns a transparent `png` buffer.
6. API streams the processed `png` back to the client.

### Flow B: Existing backend caller reuse

1. Backend code calls the shared service with raw bytes and input metadata.
2. Service chooses the proper strategy/provider.
3. Caller receives processed bytes plus metadata and decides whether to upload, persist, or return the result.

### Flow C: Freepik importer compatibility

1. Freepik importer continues to download assets as it does today.
2. GIF assets use the existing white-to-transparent behavior through the new service facade or adapter.
3. No change in Freepik job contract or imported element schema is required for v1.

## Functional requirements

Mandatory:
- Create a reusable service module under a media-focused namespace, for example `src/lib/media/backgroundRemoval/`.
- Service must expose one stable backend contract for callers, not importer-specific helpers.
- Mobile endpoint must accept only `image/png`, `image/jpeg`, and `image/jpg`.
- Mobile endpoint must reject GIF, SVG, WEBP, PDF, PSD, and other unsupported inputs with a clear error.
- Endpoint must return `image/png` so transparency is preserved.
- Service must preserve the visible subject and remove the background with transparent alpha.
- Existing EXIF orientation in JPEG uploads must be normalized before processing.
- Existing transparent regions in PNG inputs must remain transparent.
- Service must not upscale images.
- Service must fail safely when subject extraction is not possible; it must not silently return an all-transparent image.
- Route must apply rate limiting.
- Route must support mobile request signing via `verifyMobileRequest(...)`.
- Route must log request outcome, timing, mime type, input size, output size, and failure reason without logging raw image data.
- OpenAPI spec must describe the new route and request/response types.

Recommended:
- Cap supported source dimensions to a safe long edge before provider execution.
- Return deterministic filenames such as `<original-name>-no-bg.png`.
- Include width/height metadata in response headers.

Nice to have:
- Optional storage persistence mode for future callers.
- Optional mask-confidence/debug metadata for internal logging only.

## API and data contracts

### Internal service contract

Proposed module interface:

```ts
type BackgroundRemovalInput = {
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  source?: "mobile-upload" | "freepik-import" | "internal";
  strategy?: "auto" | "gif-white-key" | "raster-provider";
};

type BackgroundRemovalResult = {
  bytes: Buffer;
  mimeType: "image/png" | "image/gif";
  width: number;
  height: number;
  fileName: string;
  strategy: "gif-white-key" | "raster-provider";
  provider: string;
  removedBackground: boolean;
};

async function removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalResult>;
```

Behavior:
- `auto` chooses `gif-white-key` for GIF input and `raster-provider` for PNG/JPEG input.
- Raster output must always be `image/png`.
- Service must throw typed errors that routes can map to `400`, `413`, `415`, `422`, `429`, `500`, or `503`.

### New mobile endpoint

Endpoint:
- `POST /api/mobile/media/remove-background`

Request:
- `Content-Type: multipart/form-data`
- Form fields:
  - `file` (required): binary image upload

Required headers in configured environments:
- `x-mobile-key`
- `x-mobile-ts`
- `x-mobile-sign`

Success response:
- `200 OK`
- `Content-Type: image/png`
- `Cache-Control: no-store`
- `Content-Disposition: inline; filename="<original-name>-no-bg.png"`

Optional success headers:
- `X-Output-Width`
- `X-Output-Height`
- `X-Background-Removal-Strategy`

Error response body:

```json
{
  "error": "Unsupported image type."
}
```

Status behavior:
- `400` invalid multipart payload or missing file
- `401` invalid or missing mobile signature when signing is enabled
- `413` file too large
- `415` unsupported media type
- `422` subject could not be isolated or provider returned unusable output
- `429` rate limit exceeded
- `500` unexpected processing failure
- `503` provider/service not configured

### OpenAPI delta

Add to `src/lib/mobile/openapi.js`:
- New tag or reuse a media-focused mobile tag:
  - preferred: `Mobile Media`
- New path:
  - `POST /api/mobile/media/remove-background`
- Request body:
  - `multipart/form-data`
  - `file: string(binary)`
- Success response:
  - binary `image/png`
- Error responses:
  - JSON `{ error: string }`

Compatibility impact:
- Non-breaking additive API.
- Existing mobile GET endpoints continue unchanged.
- Existing importer/database contracts continue unchanged.

## Migration and compatibility

Database:
- No schema migration required in v1.

Backend:
- Existing GIF transparency logic should be preserved behind the new service boundary.
- Freepik importer should switch from calling `convertGifWhiteToTransparent(...)` directly to the shared facade or adapter.

Client compatibility:
- New mobile capability is additive.
- No changes required for existing mobile template/font/element consumers.
- Mobile signing behavior differs from current read-only mobile routes and must be documented clearly.

Version behavior:
- v1 endpoint supports only single-file PNG/JPEG uploads.
- GIF upload to the new mobile route is explicitly unsupported even though GIF transparency remains supported internally for Freepik import.

## Technical considerations

### Service architecture

Recommended structure:
- `src/lib/media/backgroundRemoval/index.ts`
- `src/lib/media/backgroundRemoval/errors.ts`
- `src/lib/media/backgroundRemoval/providers/gifWhiteKey.server.js`
- `src/lib/media/backgroundRemoval/providers/rasterProvider.server.ts`
- `src/lib/media/backgroundRemoval/imageNormalization.server.ts`

Reasoning:
- Keeps caller API stable.
- Allows current GIF behavior and new raster behavior to share one facade.
- Avoids coupling mobile API implementation to Freepik import internals.

### Provider strategy

Assumption:
- Production-quality PNG/JPEG background removal will use a provider-backed raster strategy because the repo currently has no dedicated segmentation dependency or local model pipeline for this task.

Requirement:
- Provider-specific HTTP logic must stay inside the raster provider adapter.
- The route and callers must depend only on the shared internal interface.

### File validation and normalization

Recommended validation defaults:
- Max upload size: `10 MB` for mobile v1
- Allowed mime types: `image/png`, `image/jpeg`
- Max source long edge after normalization: `4096 px`

Normalization requirements:
- Normalize EXIF orientation before provider processing.
- Strip unsupported metadata from the output.
- Keep original dimensions when already within limits.
- Do not enlarge small images.

### Security and abuse prevention

This route is more expensive than current mobile GET endpoints, so it should not follow the same trust model.

Mandatory protections:
- Enforce `verifyMobileRequest(request)` when mobile signing env vars are configured.
- Rate limit by signed key when present, otherwise by request IP.
- Use `Cache-Control: no-store`.
- Do not persist uploads by default in v1.
- Do not log raw file names if they may contain sensitive user data beyond sanitized output naming.

Suggested starting rate limit:
- `10` requests per `5` minutes per client identity

### Observability

Log fields:
- request id
- route
- source mime type
- input bytes
- output bytes
- width/height
- strategy/provider
- processing duration
- success/failure category

### Documentation and tooling

Required updates:
- `src/lib/mobile/openapi.js`
- `docs/mobile-templates-api.md`

Important existing gap:
- `scripts/check-mobile-openapi-coverage.mjs` currently scans `route.js` files only.
- If the new mobile route is implemented as `route.ts`, the checker will not enforce documentation coverage.

Requirement:
- Either update the checker to scan both `route.js` and `route.ts`, or deliberately implement the route in `route.js`.

## Validation plan

Unit coverage:
- input mime type validation
- file size validation
- strategy selection in the service facade
- GIF adapter compatibility path
- raster normalization behavior
- error mapping from service errors to HTTP status codes
- mobile signature validation branch behavior

Integration coverage:
- successful multipart PNG upload returns `200 image/png`
- successful multipart JPEG upload returns `200 image/png`
- missing file returns `400`
- unsupported GIF upload returns `415`
- oversized upload returns `413`
- invalid mobile signature returns `401` when signing is configured
- provider unavailable returns `503`
- rate limit returns `429`

Manual QA:
- upload portrait JPEG with EXIF rotation and verify subject is upright
- upload transparent PNG with a visible object and verify transparency is preserved
- upload a photo with complex edges such as hair or shadows
- verify Freepik GIF import still produces transparent results after refactor
- verify OpenAPI includes the new route

Regression focus:
- Freepik icon import
- editor media upload route
- existing public mobile GET routes
- mobile OpenAPI generation

## Acceptance criteria

- A shared backend background-removal module exists and is not tied to Freepik-specific logic.
- Mobile app can POST a PNG or JPEG file to one endpoint and receive a transparent PNG response.
- The new route rejects unsupported formats and oversized inputs with stable error responses.
- Existing Freepik GIF transparency behavior remains functional.
- Mobile OpenAPI includes the new endpoint and payload/response documentation.
- Route enforces rate limiting and mobile signing when configured.
- No database migration is required for the v1 release.

## Open questions and risks

Open questions:
- Which raster background-removal provider will be used in production?
- Is mobile request signing mandatory in production for this route from day one, or only when env is configured?
- Should v1 return only binary image data, or should it also support an optional persisted URL response mode?
- What final upload limit does product want for mobile users: `10 MB`, `15 MB`, or `25 MB`?

Risks:
- Provider quality may vary on hair, shadows, semi-transparent objects, and white-on-white subjects.
- A synchronous route may hit latency ceilings if provider response time is unstable.
- Public unauthenticated access would create abuse risk and storage/compute cost exposure.
- If the route is added under `/api/mobile/*`, project docs must stop claiming that all mobile routes are authorization-free.

## Definition of Ready

- Product confirms that v1 scope is single-image PNG/JPEG upload only.
- Engineering chooses the raster provider and confirms credentials/env vars.
- Engineering confirms whether the route returns binary only or also needs a persisted URL mode.
- Security decision is made for mobile request signing enforcement in production.
- Final upload size limit is agreed.
- OpenAPI update scope is agreed, including checker behavior for `route.ts`.
- Acceptance criteria are testable in CI and by manual QA.
- Rollback plan is defined: disable the new route and keep existing Freepik GIF flow intact.

## Delivery summary

This feature should be delivered as a reusable backend media service plus one new mobile upload endpoint. The service owns strategy selection and image-processing orchestration, while the mobile route owns validation, auth, rate limiting, and binary response streaming. The first release should stay narrow: PNG/JPEG in, transparent PNG out, no persistence by default, and no change to existing read-only mobile APIs beyond documentation updates.
