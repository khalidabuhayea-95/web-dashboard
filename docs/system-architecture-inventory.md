# Raha V4 Web Dashboard: System Architecture Inventory

Last updated: 2026-03-10

## 1) System Overview

This project is a Next.js 16 App Router application that provides:

- Role-based dashboard (admin/editor)
- Editor Pro canvas for creating templates (text/image/video)
- Template library management (draft/published)
- Canva import (URL + Chrome extension path)
- Vector/PSD import
- Mobile-facing template APIs
- Supabase Auth + Supabase Storage integration
- PostgreSQL persistence through Prisma

Core application path: `/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard`

## 2) Major System Components

| Component | Responsibility | Main files |
|---|---|---|
| Dashboard shell | Authenticated app shell, left navigation, top user bar | `src/app/(dashboard)/layout.js`, `src/app/(dashboard)/DashboardNav.js` |
| Dashboard pages | Templates, Canva Import, Vector Import, Settings, Users, Analytics, Push, Design System | `src/app/(dashboard)/**/page.js`, `*Client.js` |
| Editor Pro shell | Editor route protection + shell composition | `src/app/(editor)/layout.js`, `src/app/(editor)/editor-pro/page.tsx` |
| Editor UI composition | Toolbar, SidePanel, Properties, Timeline, canvas stage | `src/components/editor/EditorLayout.tsx` |
| Canvas engine | Render/manipulate text/image/video/shapes, selection, transform, clipping to page | `src/components/editor/CanvasEditor.tsx` |
| Editor state store | Central state/actions/history/template meta/font registry | `src/store/editorStore.ts` |
| Template service | CRUD, publish/unpublish, revisions, rollback, filtering | `src/app/api/templates/**` |
| Import pipeline: Canva (URL) | Canva URL scrape/import path | `src/app/api/tools/canva-import/route.js` |
| Import pipeline: Canva extension | Tokenized extension import endpoint, layer parity metadata | `src/app/api/tools/canva-import/extension-token/route.js`, `src/app/api/tools/canva-import/extension-import/route.js` |
| Import pipeline: Vector/PSD | PSD/SVG/PDF processing and import | `src/app/api/tools/vector-import/route.js` |
| Media upload service | Upload image/video/font to Supabase Storage | `src/app/api/editor/media/route.js` |
| Custom fonts service | Save/list/delete custom fonts (URL/data based), app settings persistence | `src/app/api/editor/fonts/route.js`, `src/lib/editor/customFonts.server.js` |
| Mobile API | Public endpoints for published templates (optional language headers) | `src/app/api/mobile/templates/route.js`, `src/app/api/mobile/templates/[slug]/route.js`, `src/app/api/mobile/templates/[slug]/assets/route.js`, `src/app/api/mobile/templates/by-subcategory/route.js`, `src/app/api/mobile/templates/taxonomy/route.js`, `src/app/api/mobile/openapi/route.js` |
| Admin API | User management + stats | `src/app/api/admin/users/route.js`, `src/app/api/admin/stats/route.js` |
| Taxonomy settings | Template category/subcategory settings | `src/app/api/settings/template-taxonomy/route.js`, `src/lib/templates/templateSettings*.js` |
| Auth + session bridge | Supabase client/server/admin clients, session refresh proxy | `src/lib/supabase/*.js`, `src/proxy.js` |
| Canva extension package | Chrome extension to extract Canva page/layers and send to API | `extension/canva-importer/*` |
| Utility scripts | CLI Canva import + mobile signature helper | `scripts/import-canva-template.mjs`, `scripts/sign-mobile-request.mjs` |

## 3) Databases and Storage

## 3.1 Physical data services

| Service | Usage in this system |
|---|---|
| PostgreSQL (Supabase) | Main relational database for app tables and Supabase-managed schemas |
| Supabase Storage | Media object storage (uploaded image/video/font files) |
| Supabase Auth | User identity and JWT claims (`user_role`) |

There is one primary PostgreSQL database connection configured via `DATABASE_URL`.

## 3.2 Application tables (public schema)

| Table | Purpose | Key fields |
|---|---|---|
| `Template` | Main template records | `id`, `ownerId`, `name`, `slug`, `status`, `version`, `canvasSize`, `category`, `subCategory`, `tags`, `thumbnailDataUrl`, `data`, timestamps |
| `TemplateRevision` | Version snapshots/history | `id`, `templateId`, `version`, `action`, `actorId`, `snapshot`, `createdAt` |
| `AppSetting` | Key-value JSON settings | `key`, `value`, timestamps |
| `user_roles` | RBAC role mapping (`admin`/`editor`) | `user_id`, `role` (enum `app_role`) |

## 3.3 Supabase-managed schemas/tables used

| Schema | Notes |
|---|---|
| `auth` | Supabase Auth users/sessions (`auth.users`) |
| `storage` | Buckets/objects metadata for Supabase Storage |

## 3.4 Media storage policy in current code

| Media type | Current persistence |
|---|---|
| Images uploaded from editor | Supabase Storage URL |
| Videos uploaded from editor | Supabase Storage URL |
| Fonts uploaded from editor | Supabase Storage URL (legacy data URL still supported) |
| Template records | Stored in PostgreSQL `Template`/`TemplateRevision` |

Default bucket for editor media: `editor-media` (override with `EDITOR_MEDIA_BUCKET`).

## 4) Technology Stack

## 4.1 Frontend and UI

| Technology | Version/notes | Where used |
|---|---|---|
| Next.js | `16.1.6` (App Router, Turbopack build) | full web app |
| React | `19.2.3` | client components |
| TypeScript | strict mode enabled, mixed JS/TS (`allowJs: true`) | editor + APIs + store |
| Tailwind CSS | v4 via `@tailwindcss/postcss` | styling |
| Lucide React | icon system | dashboard/editor UI |
| Zustand | editor state management | `src/store/editorStore.ts` |
| React Konva + Konva | canvas rendering/interaction | `CanvasEditor.tsx` |
| use-image | image loading hook for Konva nodes | canvas image/video rendering |
| shadcn-style UI primitives | local component wrappers | `src/components/ui/*` |

## 4.2 Backend/API and data

| Technology | Where used |
|---|---|
| Next.js Route Handlers | all `/api/*` endpoints |
| Prisma ORM | PostgreSQL app tables (`Template`, `TemplateRevision`, `AppSetting`) |
| Supabase JS + SSR | auth/session in browser/server/proxy contexts |
| Supabase Admin client | privileged operations and storage uploads |

## 4.3 Import and media processing

| Technology | Purpose |
|---|---|
| Playwright | Canva scraping/import automation |
| ag-psd | PSD parsing |
| node-canvas (`canvas`) | server-side canvas operations |
| pngjs | PNG parsing/processing |

## 4.4 Tooling

| Tool | Purpose |
|---|---|
| ESLint + `eslint-config-next` | linting |
| Next build pipeline | production compile/typecheck |
| Supabase CLI config + SQL migrations | local Supabase services + schema evolution |

## 5) API Surface (Current Routes)

| HTTP route | File | Responsibility |
|---|---|---|
| `GET /api/admin/stats` | `src/app/api/admin/stats/route.js` | Admin dashboard counters |
| `GET/POST/PATCH/DELETE /api/admin/users` | `src/app/api/admin/users/route.js` | Admin user/role operations |
| `GET/POST/DELETE /api/editor/fonts` | `src/app/api/editor/fonts/route.js` | Custom font records |
| `POST /api/editor/media` | `src/app/api/editor/media/route.js` | Media upload to Supabase Storage |
| `GET /api/mobile/templates` | `src/app/api/mobile/templates/route.js` | Mobile grouped list of published templates |
| `GET /api/mobile/templates/:id` | `src/app/api/mobile/templates/[slug]/route.js` | Mobile template detail by UUID (slug fallback supported) |
| `GET /api/mobile/templates/:id/assets` | `src/app/api/mobile/templates/[slug]/assets/route.js` | Resolve template media assets (binary/redirect, slug fallback supported) |
| `GET /api/mobile/templates/by-subcategory` | `src/app/api/mobile/templates/by-subcategory/route.js` | Mobile templates filtered by categoryId/subCategoryId |
| `GET /api/mobile/templates/taxonomy` | `src/app/api/mobile/templates/taxonomy/route.js` | Mobile taxonomy labels/options |
| `GET /api/mobile/openapi` | `src/app/api/mobile/openapi/route.js` | OpenAPI spec for mobile routes |
| `GET/PUT /api/settings/template-taxonomy` | `src/app/api/settings/template-taxonomy/route.js` | Category configuration |
| `GET/POST/PATCH/DELETE /api/templates` | `src/app/api/templates/route.js` | Template CRUD/list/publish |
| `GET/DELETE /api/templates/:id` | `src/app/api/templates/[id]/route.js` | Template detail/delete |
| `GET /api/templates/:id/history` | `src/app/api/templates/[id]/history/route.js` | Revision history |
| `POST /api/templates/:id/rollback` | `src/app/api/templates/[id]/rollback/route.js` | Rollback to revision |
| `POST /api/tools/canva-import` | `src/app/api/tools/canva-import/route.js` | Canva URL import |
| `POST /api/tools/canva-import/extension-token` | `src/app/api/tools/canva-import/extension-token/route.js` | Extension auth token |
| `OPTIONS/POST /api/tools/canva-import/extension-import` | `src/app/api/tools/canva-import/extension-import/route.js` | Extension payload import |
| `POST /api/tools/import-jobs/worker` | `src/app/api/tools/import-jobs/worker/route.js` | Secret-protected import worker drain endpoint |
| `POST /api/tools/vector-import` | `src/app/api/tools/vector-import/route.js` | PSD/SVG/PDF import |

## 6) Environment Variables in Use

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | Prisma | PostgreSQL connection |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase browser/server clients | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase browser/server clients | public client key |
| `SUPABASE_SECRET_KEY` | Supabase admin client | privileged server key |
| `SUPABASE_SERVICE_ROLE_KEY` | Canva import token fallback | secret fallback in token signing helper |
| `CANVA_IMPORT_TOKEN_SECRET` | Canva extension auth | token signing/verification secret |
| `IMPORT_JOBS_WORKER_SECRET` | import jobs worker endpoint | shared secret used by worker drain calls |
| `EDITOR_MEDIA_BUCKET` | media upload API | storage bucket override |
| `TEMPLATE_THUMBNAIL_BUCKET` | templates API | storage bucket for saved template thumbnails |
| `ADMIN_EMAILS` | admin users API | optional admin whitelist |
| `ADMIN_EMAIL_DOMAIN` | admin users API | optional admin domain allow list |
| `MOBILE_API_KEY_ID` | mobile auth | signed request key id |
| `MOBILE_API_SIGNING_SECRET` | mobile auth | HMAC secret for mobile endpoints |

## 7) File Structure (Key Project Tree)

```text
web-dashboard/
├─ docs/
│  ├─ canva-template-import.md
│  ├─ editor-canva-video-checklist.md
│  ├─ mobile-templates-api.md
│  └─ system-architecture-inventory.md
├─ extension/
│  └─ canva-importer/
│     ├─ manifest.json
│     ├─ background.js
│     ├─ popup.html
│     ├─ popup.js
│     └─ popup.css
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
├─ scripts/
│  ├─ import-canva-template.mjs
│  └─ sign-mobile-request.mjs
├─ src/
│  ├─ app/
│  │  ├─ (dashboard)/
│  │  │  ├─ layout.js
│  │  │  ├─ DashboardNav.js
│  │  │  ├─ DashboardClient.js
│  │  │  ├─ templates/
│  │  │  ├─ canva-import/
│  │  │  ├─ vector-import/
│  │  │  ├─ settings/
│  │  │  ├─ users/
│  │  │  ├─ analytics/
│  │  │  ├─ notifications/
│  │  │  └─ design-system/
│  │  ├─ (editor)/
│  │  │  ├─ layout.js
│  │  │  ├─ editor/
│  │  │  └─ editor-pro/
│  │  ├─ api/
│  │  │  ├─ admin/
│  │  │  ├─ editor/
│  │  │  ├─ mobile/
│  │  │  ├─ settings/
│  │  │  ├─ templates/
│  │  │  └─ tools/
│  │  ├─ login/
│  │  ├─ layout.js
│  │  └─ globals.css
│  ├─ components/
│  │  ├─ editor/
│  │  │  ├─ EditorLayout.tsx
│  │  │  ├─ Toolbar.tsx
│  │  │  ├─ SidePanel.tsx
│  │  │  ├─ CanvasEditor.tsx
│  │  │  ├─ PropertiesPanel.tsx
│  │  │  └─ PagesTimeline.tsx
│  │  └─ ui/
│  ├─ lib/
│  │  ├─ auth/
│  │  ├─ editor/
│  │  ├─ mobile/
│  │  ├─ supabase/
│  │  ├─ templates/
│  │  └─ tools/
│  ├─ store/
│  │  └─ editorStore.ts
│  ├─ types/
│  └─ proxy.js
└─ supabase/
   ├─ config.toml
   └─ migrations/
```

## 8) Architecture Notes

- The system uses App Router route groups:
  - `(dashboard)` for management UI
  - `(editor)` for editor screens
- Authorization model:
  - Supabase auth claim `user_role` (`admin` / `editor`)
  - Role source table: `public.user_roles`
- Template content is stored as JSON in PostgreSQL (`Template.data`) and managed by the Zustand store format.
- Media binary files are decoupled from template rows and now uploaded to Supabase Storage.
