# Plain PostgreSQL Cutover

This app now treats plain PostgreSQL as the default database target and keeps
Cloudflare R2 as the object storage backend.

## What changed in code

- `DashboardUser` is the primary auth source of truth.
- `editor_background_assets` now has a tracked Prisma migration:
  `prisma/migrations/20260420193000_add_editor_background_assets/`

## Cutover checklist

1. Provision a PostgreSQL 17 server.
2. Create the app database and a dedicated app user.
3. Enable `pgcrypto` on the target database.
4. Freeze writes before final export.
5. Dump the current public schema and data:

   ```bash
   pg_dump \
     --format=custom \
     --no-owner \
     --no-privileges \
     --schema=public \
     --file=app-public.dump \
     "$SOURCE_DATABASE_URL"
   ```

6. Restore into the new PostgreSQL target:

   ```bash
   pg_restore \
     --clean \
     --if-exists \
     --no-owner \
     --no-privileges \
     --dbname="$TARGET_DATABASE_URL" \
     app-public.dump
   ```

7. Run Prisma migration verification:

   ```bash
   npx prisma migrate deploy
   ```

8. Update production env:
   - change `DATABASE_URL`
   - keep the R2 vars unchanged:
     - `R2_ENDPOINT`
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_PUBLIC_BUCKET`
     - `R2_PRIVATE_BUCKET`
     - `R2_PUBLIC_BASE_URL`

## Critical post-cutover verification

- `Template`
- `TemplateRevision`
- `DashboardUser`
- `DashboardInviteToken`
- `MobileUser`
- `MobileIdentity`
- `MobileRefreshToken`
- `AppSetting`
- `FontFamily`
- `FontFile`
- `FontAlias`
- `import_jobs`
- `editor_element_assets`
- `editor_background_assets`
- `_prisma_migrations`

## Notes

- UUID preservation matters for ownership fields such as `Template.ownerId`,
  `TemplateRevision.actorId`, and asset/import `owner_id` columns.
- Media binaries stay in Cloudflare R2. This DB move only relocates metadata
  and references.
