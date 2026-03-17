import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { kickImportJob } from "@/lib/tools/importJobsRunner.server";
import { getImportJobById, requeueStalledImportJob } from "@/lib/tools/importJobsStore.server";
import { getEditorSession } from "@/lib/templates/server";
import { handleBadRequest, handleNotFound, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const maxDuration = 60;
const IMPORT_JOB_POLL_LIMIT = {
  limit: 240,
  windowMs: 60_000,
};

function publicJob(job: any): any {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress || "",
    error: job.error || "",
    result: job.result || null,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || "",
    finishedAt: job.finishedAt || "",
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const rateLimitState = checkRateLimit({
    scope: "api:tools:import-jobs:poll",
    identifier: session.userId || resolveRequestIp(request),
    limit: IMPORT_JOB_POLL_LIMIT.limit,
    windowMs: IMPORT_JOB_POLL_LIMIT.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse("Too many job status requests. Please retry shortly.", rateLimitState);
  }

  const resolvedParams = await params;
  const jobId = String(resolvedParams?.id || "").trim();
  if (!jobId) {
    return handleBadRequest("Missing job id");
  }

  const job = await getImportJobById(jobId);
  if (!job) {
    return handleNotFound("Import job not found");
  }

  if (session.role !== "admin" && job.ownerId !== session.userId) {
    return handleForbidden("Cannot access this import job");
  }

  logger.info("Polling import job", {
    userId: session.userId,
    jobId,
    status: job.status,
  });

  if (job.status === "pending") {
    await kickImportJob(job.id);
  } else if (job.status === "running") {
    const recovered = await requeueStalledImportJob(job.id, 300);
    if (recovered) {
      await kickImportJob(job.id);
    }
  }

  const freshJob = (await getImportJobById(job.id)) || job;
  return NextResponse.json({ job: publicJob(freshJob) });
}
