import prisma from "@/lib/prisma";

const JOB_STATUSES = new Set(["pending", "running", "succeeded", "failed"]);
let ensureImportJobsSchemaPromise = null;

const IMPORT_JOBS_SCHEMA_STATEMENTS = [
  `
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
    )
  `,
  `
    ALTER TABLE import_jobs
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS import_jobs_owner_idx
      ON import_jobs(owner_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS import_jobs_status_idx
      ON import_jobs(status, created_at DESC)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_owner_type_idempotency_key_idx
      ON import_jobs(owner_id, type, idempotency_key)
  `,
];

async function ensureImportJobsSchema() {
  if (ensureImportJobsSchemaPromise) {
    return ensureImportJobsSchemaPromise;
  }

  ensureImportJobsSchemaPromise = (async () => {
    for (const statement of IMPORT_JOBS_SCHEMA_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  })().catch((error) => {
    ensureImportJobsSchemaPromise = null;
    throw error;
  });

  return ensureImportJobsSchemaPromise;
}

function nowIsoString() {
  return new Date().toISOString();
}

function toSafeInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function normalizeJobType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeJobStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  return JOB_STATUSES.has(status) ? status : "pending";
}

function normalizeJobRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: String(row.id || ""),
    ownerId: String(row.owner_id || ""),
    type: normalizeJobType(row.type),
    status: normalizeJobStatus(row.status),
    idempotencyKey: String(row.idempotency_key || ""),
    input: row.input && typeof row.input === "object" ? row.input : {},
    result: row.result && typeof row.result === "object" ? row.result : null,
    error: String(row.error || ""),
    progress: String(row.progress || ""),
    attempts: Number(row.attempts || 0),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : "",
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIsoString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIsoString(),
  };
}

export async function getImportJobByIdempotency({ ownerId, type, idempotencyKey }) {
  await ensureImportJobsSchema();

  const normalizedOwnerId = String(ownerId || "").trim();
  const normalizedType = normalizeJobType(type);
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedOwnerId || !normalizedType || !normalizedKey) return null;

  const rows = await prisma.$queryRaw`
    SELECT
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
    FROM import_jobs
    WHERE owner_id = ${normalizedOwnerId}::uuid
      AND type = ${normalizedType}
      AND idempotency_key = ${normalizedKey}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function createImportJob({ id, ownerId, type, input, idempotencyKey = "" }) {
  await ensureImportJobsSchema();

  const jobId = String(id || "").trim();
  const normalizedOwnerId = String(ownerId || "").trim();
  const normalizedType = normalizeJobType(type);
  const payload = input && typeof input === "object" ? input : {};
  const normalizedIdempotencyKey = String(idempotencyKey || "").trim().slice(0, 128);

  if (normalizedIdempotencyKey) {
    const rows = await prisma.$queryRaw`
      INSERT INTO import_jobs (
        id,
        owner_id,
        type,
        status,
        idempotency_key,
        input,
        result,
        error,
        progress,
        attempts,
        started_at,
        finished_at,
        created_at,
        updated_at
      )
      VALUES (
        ${jobId}::uuid,
        ${normalizedOwnerId}::uuid,
        ${normalizedType},
        'pending',
        ${normalizedIdempotencyKey},
        ${JSON.stringify(payload)}::jsonb,
        NULL,
        NULL,
        '',
        0,
        NULL,
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT (owner_id, type, idempotency_key)
      DO NOTHING
      RETURNING
        id,
        owner_id,
        type,
        status,
        idempotency_key,
        input,
        result,
        error,
        progress,
        attempts,
        started_at,
        finished_at,
        created_at,
        updated_at
    `;

    if (Array.isArray(rows) && rows.length > 0) {
      return normalizeJobRow(rows[0]);
    }

    return getImportJobByIdempotency({
      ownerId: normalizedOwnerId,
      type: normalizedType,
      idempotencyKey: normalizedIdempotencyKey,
    });
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO import_jobs (
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
    )
    VALUES (
      ${jobId}::uuid,
      ${normalizedOwnerId}::uuid,
      ${normalizedType},
      'pending',
      NULL,
      ${JSON.stringify(payload)}::jsonb,
      NULL,
      NULL,
      '',
      0,
      NULL,
      NULL,
      NOW(),
      NOW()
    )
    RETURNING
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function getImportJobById(id) {
  await ensureImportJobsSchema();

  const jobId = String(id || "").trim();
  if (!jobId) return null;
  const rows = await prisma.$queryRaw`
    SELECT
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
    FROM import_jobs
    WHERE id = ${jobId}::uuid
    LIMIT 1
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function claimImportJob(jobId) {
  await ensureImportJobsSchema();

  const id = String(jobId || "").trim();
  if (!id) return null;
  const rows = await prisma.$queryRaw`
    UPDATE import_jobs
    SET
      status = 'running',
      attempts = attempts + 1,
      started_at = COALESCE(started_at, NOW()),
      updated_at = NOW()
    WHERE id = ${id}::uuid
      AND status = 'pending'
    RETURNING
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function requeueStalledImportJob(jobId, staleAfterSeconds = 300) {
  await ensureImportJobsSchema();

  const id = String(jobId || "").trim();
  if (!id) return null;
  const safeSeconds = Math.min(Math.max(Number(staleAfterSeconds) || 300, 30), 3600);
  const rows = await prisma.$queryRaw`
    UPDATE import_jobs
    SET
      status = 'pending',
      progress = '',
      updated_at = NOW()
    WHERE id = ${id}::uuid
      AND status = 'running'
      AND updated_at < (NOW() - (${safeSeconds} * INTERVAL '1 second'))
    RETURNING
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function updateImportJobProgress(jobId, progress) {
  await ensureImportJobsSchema();

  const id = String(jobId || "").trim();
  if (!id) return null;
  const safeProgress = String(progress || "").slice(0, 280);
  const rows = await prisma.$queryRaw`
    UPDATE import_jobs
    SET
      progress = ${safeProgress},
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function markImportJobSucceeded(jobId, result) {
  await ensureImportJobsSchema();

  const id = String(jobId || "").trim();
  if (!id) return null;
  const payload = result && typeof result === "object" ? result : {};
  const rows = await prisma.$queryRaw`
    UPDATE import_jobs
    SET
      status = 'succeeded',
      result = ${JSON.stringify(payload)}::jsonb,
      error = NULL,
      progress = '',
      finished_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function markImportJobFailed(jobId, errorValue, result = null) {
  await ensureImportJobsSchema();

  const id = String(jobId || "").trim();
  if (!id) return null;
  const safeError = String(errorValue || "Import failed.").slice(0, 1000);
  const payload = result && typeof result === "object" ? result : null;
  const rows = await prisma.$queryRaw`
    UPDATE import_jobs
    SET
      status = 'failed',
      result = ${payload ? JSON.stringify(payload) : null}::jsonb,
      error = ${safeError},
      progress = '',
      finished_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING
      id,
      owner_id,
      type,
      status,
      idempotency_key,
      input,
      result,
      error,
      progress,
      attempts,
      started_at,
      finished_at,
      created_at,
      updated_at
  `;

  return normalizeJobRow(Array.isArray(rows) ? rows[0] : null);
}

export async function listImportJobCandidateIds({ limit = 5, staleAfterSeconds = 300 } = {}) {
  await ensureImportJobsSchema();

  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const safeSeconds = Math.min(Math.max(Number(staleAfterSeconds) || 300, 30), 3600);
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM import_jobs
    WHERE status = 'pending'
      OR (status = 'running' AND updated_at < (NOW() - (${safeSeconds} * INTERVAL '1 second')))
    ORDER BY
      CASE WHEN status = 'running' THEN 0 ELSE 1 END ASC,
      updated_at ASC,
      created_at ASC
    LIMIT ${safeLimit}
  `;

  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => String(row?.id || "").trim())
    .filter(Boolean);
}

export async function getImportJobStatusSummary({ lookbackHours = 24 } = {}) {
  await ensureImportJobsSchema();

  const safeLookbackHours = Math.min(Math.max(Number(lookbackHours) || 24, 1), 24 * 30);
  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'running')::int AS running,
      COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE created_at >= (NOW() - (${safeLookbackHours} * INTERVAL '1 hour')))::int AS lookback_count,
      COUNT(*) FILTER (
        WHERE status = 'failed'
          AND created_at >= (NOW() - (${safeLookbackHours} * INTERVAL '1 hour'))
      )::int AS lookback_failed_count
    FROM import_jobs
  `;

  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    total: toSafeInt(row?.total),
    pending: toSafeInt(row?.pending),
    running: toSafeInt(row?.running),
    succeeded: toSafeInt(row?.succeeded),
    failed: toSafeInt(row?.failed),
    lookbackCount: toSafeInt(row?.lookback_count),
    lookbackFailedCount: toSafeInt(row?.lookback_failed_count),
    lookbackHours: safeLookbackHours,
  };
}
