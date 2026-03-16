CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID NOT NULL PRIMARY KEY,
  owner_id UUID NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  progress TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS import_jobs_owner_idx
  ON import_jobs(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS import_jobs_status_idx
  ON import_jobs(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_owner_type_idempotency_key_idx
  ON import_jobs(owner_id, type, idempotency_key);
