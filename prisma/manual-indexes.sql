-- Manual (non-Prisma-managed) performance indexes.
--
-- These use Postgres features Prisma's schema cannot express cleanly (GIN /
-- pg_trgm), so they are kept OUT of the schema + migration history on purpose —
-- otherwise a future `prisma migrate dev` would try to DROP them.
--
-- Apply once per environment, e.g.:
--   psql "$DATABASE_URL" -f prisma/manual-indexes.sql
-- or:
--   npx prisma db execute --file prisma/manual-indexes.sql --schema prisma/schema.prisma
--
-- CREATE INDEX CONCURRENTLY avoids table locks on large tables but cannot run
-- inside a transaction — run this file directly (not wrapped in BEGIN/COMMIT).

-- Trigram search on Template.name (backs ILIKE '%query%' in mobile search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "template_name_trgm_idx"
  ON "Template" USING GIN ("name" gin_trgm_ops);

-- Containment lookups on Template.tags (backs tags @> '[...]' filtering).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "template_tags_gin_idx"
  ON "Template" USING GIN ("tags" jsonb_path_ops);
