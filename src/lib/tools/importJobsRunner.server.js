import fs from "node:fs/promises";

import {
  claimImportJob,
  getImportJobById,
  listImportJobCandidateIds,
  markImportJobFailed,
  markImportJobSucceeded,
  requeueStalledImportJob,
  updateImportJobProgress,
} from "@/lib/tools/importJobsStore.server";
import { runCanvaImportForOwner } from "@/app/api/tools/canva-import/route";
import { runVectorRasterImportForOwner } from "@/app/api/tools/vector-import/route";
import { runFreepikImportForOwner } from "@/lib/tools/freepikImport.server";

const activeJobs = new Set();

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

async function cleanupTempFile(filePath) {
  const safePath = String(filePath || "").trim();
  if (!safePath) return;
  await fs.rm(safePath, { force: true }).catch(() => {});
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
      });
      result = output?.payload && typeof output.payload === "object" ? output.payload : output;
    } else if (claimed.type === "vector-raster") {
      await updateImportJobProgress(jobId, "Importing file...");
      const filePath = String(input.filePath || "").trim();
      const fileBytes = await fs.readFile(filePath);
      try {
        result = await runVectorRasterImportForOwner({
          ownerId: claimed.ownerId,
          fileBytes,
          fileName: input.fileName,
          name: input.name,
          slug: input.slug,
          maxDimension: input.maxDimension,
          format: input.format,
        });
      } finally {
        await cleanupTempFile(filePath);
      }
    } else if (claimed.type === "freepik-icons") {
      await updateImportJobProgress(jobId, "Importing Freepik icons...");
      result = await runFreepikImportForOwner({
        ownerId: claimed.ownerId,
        selectedItems: Array.isArray(input.selectedItems) ? input.selectedItems : [],
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
