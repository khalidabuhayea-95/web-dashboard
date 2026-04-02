# Mobile Templates API Integration

This backend exposes mobile endpoints for published templates, editor elements, fonts, and media tools.

## Swagger / OpenAPI

- OpenAPI JSON: `GET /api/mobile/openapi`
- Swagger UI: `GET /mobile-api/swagger`

## Required Headers

Authorization headers are not required for the read-oriented `/api/mobile/**` routes in this phase.

The background-removal upload route may require mobile signing headers when `MOBILE_API_KEY_ID` and `MOBILE_API_SIGNING_SECRET` are configured:

- `x-mobile-key`
- `x-mobile-ts`
- `x-mobile-sign`

- `x-lang` (optional): language from mobile app (`en` or `ar`)
- fallback language headers also supported: `lang`, `accept-language`

## Endpoints

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

### `GET /api/mobile/templates/:id`

Path params:
- `id` (required, template UUID; slug also accepted for backward compatibility)

Response:
- `locale`
- `template`: full mobile template object (includes `project`)
  - includes `categoryId` and `subCategoryId` GUID values
  - `category` and `subCategory` are localized labels

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
- `limit` (optional, default `100`, max `200`)

Response:
- `locale`
- `category`: includes `id`, `value`, `label`
- `subCategory`: includes `id`, `categoryId`, `value`, `label`
- `templates`: summary template objects (no `project` payload)

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

## Notes

- Mobile app logic should use IDs (`template id`, `categoryId`, `subCategoryId`) and treat labels as display-only.
- Slug support on `:id` routes is compatibility-only and should not be used for new client logic.
- Mobile request-signing helpers still exist in code, but the background-removal route is public for now.
