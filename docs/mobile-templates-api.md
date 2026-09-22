# Mobile Templates API Integration

This backend exposes mobile endpoints for published templates, editor elements, fonts, and media tools.

## Swagger / OpenAPI

- OpenAPI JSON: `GET /api/mobile/openapi`
- Swagger UI: `GET /mobile-api/swagger`

## Required Headers

Authorization headers are not required for the read-oriented `/api/mobile/**` routes in this phase.

The write-heavy media routes may require mobile signing headers when `MOBILE_API_KEY_ID` and `MOBILE_API_SIGNING_SECRET` are configured:

- `x-mobile-key`
- `x-mobile-ts`
- `x-mobile-sign`

- `x-lang` (optional): language from mobile app (`en` or `ar`)
- fallback language headers also supported: `lang`, `accept-language`

## Endpoints

### `GET /api/mobile/app-settings`

Query params:
- `deviceType` (required): `android` or `ios`
- `appVersion` (required): integer app version code such as `205`

Response:
- `deviceType`
- `appVersion`
- `forceUpdate`: `true` when the request version code is lower than the configured minimum supported version code for that platform
- `enableCache`: platform-level cache toggle from dashboard settings
- `redirectLink`: platform-level redirect destination from dashboard mobile settings, or `null` when unset

Notes:
- Returns `400` when `deviceType` or `appVersion` is missing/invalid.
- Returns `Cache-Control: no-store` so force-update decisions are not cached by clients or proxies.

### `GET /api/mobile/templates`

Query params:
- `categoryId` (optional, GUID)
- `subCategoryId` (optional, GUID)
- `query` (optional, name contains, case-insensitive)
- `tag` (optional, exact match, case-insensitive)
- `limit` (optional, default `100`, max `200`)

Response:
- `locale`
- `categories`: localized category/subcategory options with GUID IDs
- `templatesBySubCategory`: grouped list
  - group fields: `category`, `categoryId`, `categoryValue`, `subCategory`, `subCategoryId`, `subCategoryValue`
  - `templates` entries are summary objects (no `project` payload)
  - a template filed under several categories is repeated in each of its groups, and its flat
    `category*`/`subCategory*` fields describe the group it is listed under (see
    [Multi-category templates](#multi-category-templates))
  - if a generated MP4 preview exists, each template includes `previewVideoUrl` and `previewPosterUrl`
  - `previewVideoUrl` is a top-level alias for `preview.url`
  - `previewPosterUrl` is a top-level alias for `preview.posterUrl`

### `GET /api/mobile/templates/:id`

Path params:
- `id` (required, template UUID; slug also accepted for backward compatibility)

Response:
- `template`: full mobile template object (includes `project`)
  - `category` and `subCategory` are localized labels
  - `categoryValue` and `subCategoryValue` are the stable taxonomy values
  - `placements` lists every category the template is filed under (see
    [Multi-category templates](#multi-category-templates))
  - `thumbnailUrl` is the single static preview image field
  - if a generated MP4 preview exists, use `template.preview.url` for motion-capable previews
  - use `template.preview.posterUrl` as the static fallback image when `template.preview.url` is present
  - each project layer now also includes:
    - `timelineStartMs`
    - `timelineEndMs`
    - `animation`
  - `project` is slimmed to `canvasWidth`, `canvasHeight`, `background`, `layers`, and `pageCount` (plus `pages` when multi-page)
  - `project.meta`, top-level preview aliases, and redundant template/project identity fields are omitted on this endpoint

Multi-page templates:
- `template.pageCount` / `project.pageCount` give the number of design pages (1 for single-page).
- When `pageCount > 1`, `project.pages` is present and authoritative: an ordered array of
  `{id, name, width, height, durationMs, thumbnailUrl?, background, layers}` with the same
  background/layer contracts as the top-level fields.
- `pages[i].thumbnailUrl` is an optional ready-made preview image of that page, for page-strip
  UI. Page 1 falls back to the template's cover thumbnail (always present); later pages carry
  one only when captured at import/save time — otherwise the field is omitted and the client
  renders that page itself. Treat it as valid only while the page still matches the shipped
  content, and switch to a local render once the user edits that page.
- The top-level `project.background` / `project.layers` / `canvasWidth` / `canvasHeight`
  always mirror `pages[0]` (the design cover) so app builds without multi-page support keep
  rendering the first page.
- Layer asset URLs belonging to pages after the first carry a `page` query parameter; treat
  asset URLs as opaque.
- Template summaries (`/templates`, `/templates/by-subcategory`, favorites) also expose `pageCount`.

Example layer payload:

```json
{
  "id": "layer-1",
  "type": "IMAGE",
  "timelineStartMs": 0,
  "timelineEndMs": 4200,
  "animation": {
    "type": "RISE",
    "infinite": false,
    "durationMs": 900,
    "delayMs": 0,
    "direction": "UP",
    "easing": "SOFT_OUT",
    "intensity": 1
  },
  "transform": {
    "x": 540,
    "y": 960,
    "scale": 1,
    "scaleX": 1,
    "scaleY": 1,
    "rotation": 0
  },
  "opacity": 1,
  "hidden": false,
  "locked": false,
  "zIndex": 0
}
```

Notes:
- `timelineStartMs` / `timelineEndMs` define the layer visibility window on the template timeline.
- `animation.infinite = false` should be treated as a one-shot animation starting at `timelineStartMs`.
- `animation.infinite = true` should be treated as a looping animation while the layer remains visible.
- Legacy animation fields under `filters.animation*` may still be present for backward compatibility, but new clients should prefer the layer-level `animation` object.

### `GET /api/mobile/templates/:id/assets`

Resolves media referenced by template data.

Path params:
- `id` (required, template UUID; slug also accepted for backward compatibility)

Query params:
- `scope` (optional): `layer` (default), `background`, `thumbnail`
- `elementId` (optional): layer id
- `index` (optional): layer index fallback
- `field` (optional): source field key (example: `src`, `videoUri`, `imageUri`)

Behavior:
- Returns `307` redirect for remote asset URLs.
- Returns binary response for data URI assets.

### `GET /api/mobile/templates/taxonomy`

Query params:
- `locale` (optional, `en` or `ar`, default `en`)
  - language headers take priority over query params

Response:
- `locale`
- `categories`: each category/subcategory includes GUID `id` + `value` + localized labels

### `GET /api/mobile/templates/by-subcategory`

Query params:
- `categoryId` (required, GUID)
- `subCategoryId` (required, GUID)
- `query` (optional, name contains)
- `tag` (optional, exact match)
- `templatesPerSubCategory` / `limit` (optional, default `10`, max `50`)

Response:
- `subCategories`
  - `category`: includes `value`, `label`
  - `subCategory`: includes `value`, `label`
  - `templates`: slim summary template objects (no `project` payload)
    - `id`, `title`, `canvasWidth`, `canvasHeight`, `thumbnailUrl`
    - if a generated mobile preview is ready, the template also includes `preview`
    - `previewVideoUrl` and `previewPosterUrl` are only emitted when populated

### `GET /api/mobile/elements`

Query params:
- `query` / `search` / `q` (optional): search imported elements by English/Arabic name, tags, and labels
- `source` (optional): `all` or `freepik`
- `kind` (optional): `all`, `icon`, `vector`, or `image`
- `page` (optional, default `1`)
- `pageSize` / `page_size` / `per_page` / `limit` (optional, default `100`, max `100`)

Response:
- `locale`
- `elements`: flat paginated list of imported editor elements
  - `name`, `tags`, and `labels` are localized by request locale
  - `nameEn`, `nameAr`, `tagsEn`, `tagsAr`, `labelsEn`, and `labelsAr` are always included
- `page`
- `pageSize`
- `total`
- `totalPages`
- `hasNextPage`
- `hasPrevPage`

Notes:
- Search matches both English and Arabic names, tags, and labels.

### `GET /api/mobile/shapes`

Query params:
- `query` / `search` / `q` (optional): search built-in shapes by id, name, and keywords
- `page` (optional, default `1`)
- `pageSize` / `page_size` / `per_page` / `limit` (optional, default `100`, max `100`)

Response:
- `locale`
- `shapes`: flat paginated list of built-in editor shapes
  - each shape includes `id`, `name`, `nameEn`, `nameAr`, `tags`, `tagsEn`, `tagsAr`, `assetUrl`, `thumbnailUrl`, `width`, and `height`
- `page`
- `pageSize`
- `total`
- `totalPages`
- `hasNextPage`
- `hasPrevPage`

Notes:
- This route is intentionally flat and does not group by category.
- `name` and `tags` are localized by request locale, while `nameEn`, `nameAr`, `tagsEn`, and `tagsAr` are always included for client-side search or display.
- Search matches both English and Arabic names/tags.
- `assetUrl` and `thumbnailUrl` point to PNG-rendered shape files so the mobile app can render them like normal image assets.

### `GET /api/mobile/shapes/:id/file`

Path params:
- `id` (required): built-in shape id

Behavior:
- Returns `image/png`
- Renders the built-in SVG shape as a PNG for mobile clients
- Returns `404` if the shape id does not exist

### `POST /api/mobile/media/remove-background`

Accepts one uploaded image and returns a transparent `png`.

Request:
- `Content-Type: multipart/form-data`
- `file` (required): `png` or `jpg`/`jpeg`

Behavior:
- Rejects unsupported formats such as `gif`, `svg`, `pdf`, and `psd`
- Applies rate limiting
- Returns `image/png`
- Returns `Cache-Control: no-store`
- Currently public and does not require auth headers
- Uses local `rembg` as the primary remover
- Automatically falls back to the original local remover if `rembg` fails on a supported image
- The original remover remains the Freepik importer behavior and is unchanged there

Status codes:
- `200` background removed successfully
- `400` invalid multipart payload or missing file
- `413` uploaded image is too large
- `415` unsupported image type
- `422` background could not be isolated safely
- `429` rate limit exceeded

### `POST /api/mobile/media/object-remove`

Accepts one image plus one same-size mask and returns the object-removed image directly.

Request:
- `Content-Type: multipart/form-data`
- `image` (required): `png` or `jpg`/`jpeg`
- `mask` (required): `png`, same dimensions as the image

Behavior:
- Requires mobile signing headers when mobile signing is enabled
- Normalizes JPEG orientation before validating the mask dimensions
- Rejects unsupported image types, mismatched dimensions, empty masks, and oversized uploads
- Resizes image and mask together so the long edge is at most `1440`
- Stores staged inputs privately, calls Replicate `allenhooo/lama`, and returns the processed image body
- Returns `Cache-Control: no-store`
- Returns `X-Output-Width`, `X-Output-Height`, `X-Object-Removal-Provider`, and `X-Object-Removal-Model` headers

Status codes:
- `200` object removed successfully
- `400` invalid multipart payload, empty uploads, or mismatched dimensions
- `401` invalid or missing mobile signing headers when signing is enabled
- `413` uploaded image or mask is too large
- `415` unsupported image or mask type
- `422` image or mask could not be processed safely
- `429` rate limit exceeded
- `503` Replicate object removal is not configured or unavailable

### `POST /api/mobile/media/ai-expand`

Accepts one image plus target output dimensions and returns the expanded image directly.

Request:
- `Content-Type: multipart/form-data`
- `image` (required): `png` or `jpg`/`jpeg`
- `targetWidth` (required): integer
- `targetHeight` (required): integer

Behavior:
- Requires mobile signing headers when mobile signing is enabled
- Normalizes JPEG orientation before expansion
- Rejects unsupported image types, empty uploads, invalid target sizes, and oversized uploads
- Accepts no mask and no client prompt
- Automatically places the original image inside the requested target canvas on the server
- Automatically generates any required mask/canvas inputs for the selected Replicate model
- Uses the shared mobile AI Expand model setting
- Returns `Cache-Control: no-store`
- Returns `X-Output-Width`, `X-Output-Height`, `X-AI-Expand-Provider`, and `X-AI-Expand-Model` headers

Status codes:
- `200` image expanded successfully
- `400` invalid multipart payload, missing fields, or invalid target size
- `401` invalid or missing mobile signing headers when signing is enabled
- `413` uploaded image is too large
- `415` unsupported image type
- `422` image could not be processed safely
- `429` rate limit exceeded
- `503` Replicate AI Expand is not configured or unavailable

## Notes

- Mobile app logic should use IDs (`template id`, `categoryId`, `subCategoryId`) and treat labels as display-only.

## Seasonal boost (occasions)

The dashboard keeps a calendar of Arabic and Islamic occasions (`/occasions`). Content linked
to an occasion is surfaced first while the occasion's boost window is active
(`boostLeadDays` before its start until its last day). Ordering is the only thing that
changes — no payload field, no new endpoint, nothing hidden — so every shipped app build
benefits without an update:

- `/templates/by-subcategory`: linked templates lead their rail (in the order they were
  linked), then the usual `updatedAt desc`. Drafts stay hidden for the public audience.
- `/templates` and `/templates/search`: linked templates (and every template placed under a
  linked category) are pinned to the front across pages; `total` and paging are unchanged.
- `/templates/taxonomy`, `/element-categories`, `/background-categories`: categories linked to
  the occasion move to the front of the list when the occasion has *Hoist linked categories*
  on, so the app opens on the occasion.
- `/elements` and `/background-categories/:id/images`: linked assets first, then assets in a
  linked category, then recency.
- `/ai-tools`: linked AI templates lead their category, and categories that are linked or hold a
  linked template follow the Magic Tools section directly.

Outside a boost window every route behaves exactly as documented above. Public responses
are cached (`max-age=300`, `stale-while-revalidate=600`; catalog lists longer), plus a
one-minute server-side snapshot, so a window starting or ending can take up to ~15 minutes
to reach every client. Testers (`private, no-store`) see it within a minute.

## Multi-category templates

A template can be filed under several `{ category, subCategory }` placements at once, so the
same design can appear in more than one rail (a wedding card under both *Invitations · Wedding*
and *Events · Celebration*, say).

- `placements[]` carries the full list, primary first. Each entry has `categoryId`,
  `categoryValue`, `categoryLabel`, `subCategoryId`, `subCategoryValue` and `subCategoryLabel`.
- The flat `category*` / `subCategory*` fields are unchanged and always populated, so a client
  that ignores `placements` behaves exactly as before. In a grouped list they describe the group
  the entry is listed under; elsewhere they describe the first placement that is still published.
- Placements whose category or sub category is unpublished are omitted from `placements`, and a
  template is visible as long as **one** of its placements survives the published taxonomy.
- `categoryId` / `subCategoryId` filters match a template if **any** of its placements matches.
- Pagination counts templates, not placements: `total` does not double-count a template that
  appears in several groups.
- Slug support on `:id` routes is compatibility-only and should not be used for new client logic.
- Mobile request-signing helpers still exist in code, but the background-removal route is public for now.
- Object removal now uses a single synchronous mobile endpoint instead of a create-and-poll job flow.
