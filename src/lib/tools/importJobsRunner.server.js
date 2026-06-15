import {
  claimImportJob,
  getImportJobById,
  listImportJobCandidateIds,
  markImportJobFailed,
  markImportJobSucceeded,
  requeueStalledImportJob,
  setImportJobProducedTemplate,
  updateImportJobProgress,
} from "@/lib/tools/importJobsStore.server";
import { runCanvaImportForOwner } from "@/lib/tools/canvaImport.server";
import {
  runFreepikBackgroundImportForOwner,
  runFreepikImportForOwner,
} from "@/lib/tools/freepikImport.server";
import { logger } from "@/lib/logging/logger";

const activeJobs = new Set();

const DEFAULT_MAX_IMPORT_JOB_ATTEMPTS = 3;

// Per-type retry caps. Canva is non-idempotent across separate attempts and
// drives an external browser, so it gets a tighter cap; Freepik writes are
// idempotent (ON CONFLICT upserts) and safe to retry more.
const MAX_IMPORT_JOB_ATTEMPTS_BY_TYPE = {
  "canva-url": 2,
  "freepik-icons": 5,
  "freepik-backgrounds": 5,
};

function maxAttemptsForType(type) {
  const key = String(type || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MAX_IMPORT_JOB_ATTEMPTS_BY_TYPE, key)) {
    return MAX_IMPORT_JOB_ATTEMPTS_BY_TYPE[key];
  }
  const envDefault = Number(process.env.IMPORT_JOBS_MAX_ATTEMPTS);
  return Number.isFinite(envDefault) && envDefault > 0
    ? Math.floor(envDefault)
    : DEFAULT_MAX_IMPORT_JOB_ATTEMPTS;
}

function toErrorMessage(error, fallback = "Import failed.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

function buildErrorResult(error) {
  if (!error || typeof error !== "object") return null;
  const payload = error.payload;
  return payload && typeof payload === "object" ? payload : null;
}

async function runImportJobInternal(jobId) {
  const claimed = await claimImportJob(jobId);
  if (!claimed) {
    const existing = await getImportJobById(jobId);
    return {
      claimed: false,
      status: String(existing?.status || "").trim().toLowerCase(),
      reason: "not-claimable",
    };
  }

  // Poison-job guard: `attempts` is incremented on every claim, so a job whose
  // count now exceeds its cap has already been run `maxAttempts` times. Fail it
  // terminally instead of letting the stale-requeue path loop it forever.
  const maxAttempts = maxAttemptsForType(claimed.type);
  if (claimed.attempts > maxAttempts) {
    logger.error("Import job exceeded max attempts", {
      jobId,
      type: claimed.type,
      attempts: claimed.attempts,
      maxAttempts,
    });
    const failed = await markImportJobFailed(
      jobId,
      `Import job exceeded maximum attempts (${maxAttempts}).`
    );
    return {
      claimed: true,
      status: String(failed?.status || "failed").trim().toLowerCase() || "failed",
      jobId,
      reason: "max-attempts-exceeded",
    };
  }

  const input = claimed.input && typeof claimed.input === "object" ? claimed.input : {};

  try {
    let result = null;

    if (claimed.type === "canva-url") {
      await updateImportJobProgress(jobId, "Importing from Canva...");
      const output = await runCanvaImportForOwner({
        ownerId: claimed.ownerId,
        url: input.url,
        name: input.name,
        slug: input.slug,
        maxDimension: input.maxDimension,
        timeoutMs: input.timeoutMs,
        interactiveBrowser: input.interactiveBrowser === true,
        // Retry-safety: reuse the template a prior attempt of this job created
        // (if any), and record any new one the moment it exists.
        existingTemplateId: claimed.producedTemplateId || "",
        onTemplateProduced: async (templateId) => {
          await setImportJobProducedTemplate(jobId, templateId);
        },
      });
      result = output?.payload && typeof output.payload === "object" ? output.payload : output;
    } else if (claimed.type === "freepik-icons") {
      await updateImportJobProgress(jobId, "Importing Freepik icons...");
      result = await runFreepikImportForOwner({
        ownerId: claimed.ownerId,
        selectedItems: Array.isArray(input.selectedItems) ? input.selectedItems : [],
        onProgress: async (message) => {
          await updateImportJobProgress(jobId, message);
        },
      });
    } else if (claimed.type === "freepik-backgrounds") {
      await updateImportJobProgress(jobId, "Importing Freepik backgrounds...");
      result = await runFreepikBackgroundImportForOwner({
        ownerId: claimed.ownerId,
        selectedItems: Array.isArray(input.selectedItems) ? input.selectedItems : [],
        categoryValue: input.categoryValue,
        query: input.query && typeof input.query === "object" ? input.query : {},
        onProgress: async (message) => {
          await updateImportJobProgress(jobId, message);
        },
      });
    } else {
      throw new Error(`Unsupported import job type "${claimed.type}".`);
    }

    const completed = await markImportJobSucceeded(jobId, result || {});
    return {
      claimed: true,
      status: String(completed?.status || "succeeded").trim().toLowerCase() || "succeeded",
      jobId,
    };
  } catch (error) {
    const resultPayload = buildErrorResult(error);
    const completed = await markImportJobFailed(jobId, toErrorMessage(error), resultPayload);
    return {
      claimed: true,
      status: String(completed?.status || "failed").trim().toLowerCase() || "failed",
      jobId,
    };
  }
}

export function getActiveImportJobCount() {
  return activeJobs.size;
}

export async function runImportJob(jobId) {
  const id = String(jobId || "").trim();
  if (!id) {
    return {
      claimed: false,
      status: "",
      reason: "missing-id",
    };
  }
  if (activeJobs.has(id)) {
    return {
      claimed: false,
      status: "",
      reason: "already-active",
    };
  }

  const existing = await getImportJobById(id);
  if (!existing) {
    return {
      claimed: false,
      status: "",
      reason: "not-found",
    };
  }
  if (existing.status === "succeeded" || existing.status === "failed") {
    return {
      claimed: false,
      status: existing.status,
      reason: "already-finished",
    };
  }

  activeJobs.add(id);
  try {
    return await runImportJobInternal(id);
  } finally {
    activeJobs.delete(id);
  }
}

export async function kickImportJob(jobId) {
  const id = String(jobId || "").trim();
  if (!id) return;
  if (activeJobs.has(id)) return;

  const existing = await getImportJobById(id);
  if (!existing) return;
  if (existing.status === "succeeded" || existing.status === "failed") return;

  queueMicrotask(async () => {
    await runImportJob(id);
  });
}

export async function drainImportJobs({ limit = 5, staleAfterSeconds = 300 } = {}) {
  const candidateIds = await listImportJobCandidateIds({
    limit,
    staleAfterSeconds,
  });
  if (candidateIds.length === 0) {
    return {
      attempted: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      recovered: 0,
      active: getActiveImportJobCount(),
      candidateIds: [],
    };
  }

  const outcome = {
    attempted: candidateIds.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    recovered: 0,
    active: 0,
    candidateIds,
  };

  for (let index = 0; index < candidateIds.length; index += 1) {
    const candidateId = candidateIds[index];
    const recovered = await requeueStalledImportJob(candidateId, staleAfterSeconds);
    if (recovered) outcome.recovered += 1;

    const result = await runImportJob(candidateId);
    if (!result?.claimed) {
      outcome.skipped += 1;
      continue;
    }

    outcome.processed += 1;
    if (result.status === "succeeded") {
      outcome.succeeded += 1;
    } else if (result.status === "failed") {
      outcome.failed += 1;
    }
  }

  outcome.active = getActiveImportJobCount();
  return outcome;
}
