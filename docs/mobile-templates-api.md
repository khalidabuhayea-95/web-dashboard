# Mobile Templates API Integration

This backend exposes public mobile endpoints for published templates.

## Swagger / OpenAPI

- OpenAPI JSON: `GET /api/mobile/openapi`
- Swagger UI: `GET /mobile-api/swagger`

## Required Headers

Authorization headers are not required for `/api/mobile/**` routes in this phase.

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

## Notes

- Mobile app logic should use IDs (`template id`, `categoryId`, `subCategoryId`) and treat labels as display-only.
- Slug support on `:id` routes is compatibility-only and should not be used for new client logic.
- Mobile request-signing helpers still exist in code, but mobile API routes currently do not enforce them.
