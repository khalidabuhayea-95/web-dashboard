-- Nayroz Pro flags for the remaining catalogs: fonts, backgrounds, elements.
-- (Templates, AI templates, magic tools and text effects already carry one.)
-- Hand-written for the same reason as the subscriptions migration: `prisma migrate
-- diff` against this database drags in pre-existing cutover drift.
--
-- The two editor_* tables are @@ignore'd raw-SQL tables whose DDL also lives in
-- src/lib/editor/imported{Backgrounds,Elements}.server.js and is applied at runtime
-- by ensureImported*Schema(); the ADD COLUMN there is idempotent and mirrors this.

-- AlterTable
ALTER TABLE "FontFamily" ADD COLUMN "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (raw-SQL catalog tables)
ALTER TABLE editor_background_assets ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE editor_element_assets ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
