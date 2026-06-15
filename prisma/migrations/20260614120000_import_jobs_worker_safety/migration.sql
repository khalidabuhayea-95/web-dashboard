-- Worker-safety columns for the standalone import worker.
-- Mirror of the runtime self-healing DDL in
-- src/lib/tools/importJobsStore.server.js (IMPORT_JOBS_SCHEMA_STATEMENTS).
-- Keep the two in sync.

-- Fencing / ownership token for a claimed job (which worker holds it, since when).
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

-- Canva retry dedupe: the template id a prior attempt of this job produced, so
-- a retry/stale-requeue reuses it instead of creating a duplicate template.
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS produced_template_id UUID;
