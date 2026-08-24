-- Baseline backfill (history repair, 2026-08-12).
--
-- The init migration reconstructs "Template" with only six columns, but the real
-- baseline at the plain-postgres cutover already had slug/status/version/
-- canvasSize/publishedAt/category/tags/thumbnailDataUrl plus their indexes, and
-- the "TemplateRevision" table. Those objects were never written into history,
-- so replaying the migrations on a clean database (what `prisma migrate dev`
-- does on its shadow database) died at 20260727120000_add_template_hot_path_indexes
-- with `column "status" does not exist` (P3006).
--
-- This migration restores the missing baseline at its correct point in history.
-- It is timestamped between init and every later migration, and everything is
-- guarded with IF NOT EXISTS so it is a no-op anywhere the objects already
-- exist. On the live database it was recorded via
-- `prisma migrate resolve --applied` and never executed.

-- AlterTable
ALTER TABLE "Template"
ADD COLUMN IF NOT EXISTS "slug" TEXT,
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "canvasSize" JSONB NOT NULL DEFAULT '{"width": 1080, "height": 1080}'::jsonb,
ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN IF NOT EXISTS "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "thumbnailDataUrl" TEXT;

-- slug is NOT NULL in the real baseline; enforce after the ADD so the replay
-- works even if a future replay target has pre-existing NULL-free data.
UPDATE "Template" SET "slug" = "id"::text WHERE "slug" IS NULL;
ALTER TABLE "Template" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
-- Prisma-conventional names so replayed history converges on schema.prisma.
-- (The live database still carries the pre-cutover names — template_slug_unique
-- and friends — which is pre-existing drift, not managed by this repair.)
CREATE UNIQUE INDEX IF NOT EXISTS "Template_slug_key" ON "Template"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Template_ownerId_name_key" ON "Template"("ownerId", "name");
CREATE INDEX IF NOT EXISTS "Template_status_idx" ON "Template"("status");
CREATE INDEX IF NOT EXISTS "Template_ownerId_idx" ON "Template"("ownerId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "TemplateRevision" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TemplateRevision_templateId_createdAt_idx" ON "TemplateRevision"("templateId", "createdAt" DESC);

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TemplateRevision_templateId_fkey'
  ) THEN
    ALTER TABLE "TemplateRevision"
    ADD CONSTRAINT "TemplateRevision_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
