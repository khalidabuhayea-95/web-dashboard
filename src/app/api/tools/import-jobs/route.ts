import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { kickImportJob } from "@/lib/tools/importJobsRunner.server";
import {
  createImportJob,
  getImportJobByIdempotency,
} from "@/lib/tools/importJobsStore.server";
import { getEditorSession } from "@/lib/templates/server";
import { handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const CREATE_IMPORT_JOBS_LIMIT = {
  limit: 20,
  windowMs: 60_000,
};

function createJobId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return randomUUID();
}

function clampNumber(value: any, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isCanvaUrl(value: any): boolean {
  try {
    const parsed = new URL(String(value || "").trim());
    return /(\.|^)canva\.com$/i.test(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function sanitizeIdempotencyKey(value: any): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
}

function resolveHeaderIdempotencyKey(request: NextRequest): string {
  const keyFromHeader = request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");
  return sanitizeIdempotencyKey(keyFromHeader);
}

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

function sanitizeFreepikSelectedItems(value: any): any[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 300);
}

function sanitizeBackgroundCategoryValue(value: any): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

async function createCanvaJob(
  session: any,
  body: any,
  requestIdempotencyKey: string
): Promise<NextResponse> {
  const type = "canva-url";

  const url = String(body?.url || "").trim();
  if (!url) {
    return handleBadRequest("Canva URL is required");
  }
  if (!isCanvaUrl(url)) {
    return handleBadRequest("Expected a valid canva.com URL");
  }

  const idempotencyKey = requestIdempotencyKey || sanitizeIdempotencyKey(body?.idempotencyKey);
  if (idempotencyKey) {
    const existingJob = await getImportJobByIdempotency({
      ownerId: session.userId,
      type,
      idempotencyKey,
    });
    if (existingJob) {
      if (existingJob.status === "pending") {
        await kickImportJob(existingJob.id);
      }
      return NextResponse.json({ job: publicJob(existingJob) }, { status: 200 });
    }
  }

  const requestedJobId = createJobId();
  const job = await createImportJob({
    id: requestedJobId,
    ownerId: session.userId,
    type,
    idempotencyKey,
    input: {
      url,
      name: typeof body?.name === "string" ? body.name.trim() : "",
      slug: typeof body?.slug === "string" ? body.slug.trim() : "",
      maxDimension: clampNumber(body?.maxDimension, 1920, 320, 4096),
      timeoutMs: clampNumber(body?.timeoutMs, 180_000, 15_000, 300_000),
      interactiveBrowser: body?.interactiveBrowser === true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Failed to queue import job." }, { status: 500 });
  }

  if (job.status === "pending") {
    await kickImportJob(job.id);
  }

  const deduped = Boolean(idempotencyKey) && job.id !== requestedJobId;
  return NextResponse.json({ job: publicJob(job) }, { status: deduped ? 200 : 202 });
}

async function createFreepikIconsJob(
  session: any,
  body: any,
  requestIdempotencyKey: string
): Promise<NextResponse> {
  const type = "freepik-icons";
  const selectedItems = sanitizeFreepikSelectedItems(body?.selectedItems);
  if (selectedItems.length === 0) {
    return handleBadRequest("At least one selected Freepik icon is required");
  }

  const idempotencyKey = requestIdempotencyKey || sanitizeIdempotencyKey(body?.idempotencyKey);
  if (idempotencyKey) {
    const existingJob = await getImportJobByIdempotency({
      ownerId: session.userId,
      type,
      idempotencyKey,
    });
    if (existingJob) {
      if (existingJob.status === "pending") {
        await kickImportJob(existingJob.id);
      }
      return NextResponse.json({ job: publicJob(existingJob) }, { status: 200 });
    }
  }

  const requestedJobId = createJobId();
  const job = await createImportJob({
    id: requestedJobId,
    ownerId: session.userId,
    type,
    idempotencyKey,
    input: {
      selectedItems,
      query: body?.query && typeof body.query === "object" ? body.query : {},
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Failed to queue import job." }, { status: 500 });
  }

  if (job.status === "pending") {
    await kickImportJob(job.id);
  }

  const deduped = Boolean(idempotencyKey) && job.id !== requestedJobId;
  return NextResponse.json({ job: publicJob(job) }, { status: deduped ? 200 : 202 });
}

async function createFreepikBackgroundsJob(
  session: any,
  body: any,
  requestIdempotencyKey: string
): Promise<NextResponse> {
  const type = "freepik-backgrounds";
  const selectedItems = sanitizeFreepikSelectedItems(body?.selectedItems);
  const categoryValue = sanitizeBackgroundCategoryValue(body?.categoryValue || body?.category);
  if (selectedItems.length === 0) {
    return handleBadRequest("At least one selected Freepik background is required");
  }
  if (!categoryValue) {
    return handleBadRequest("Background category is required");
  }

  const idempotencyKey = requestIdempotencyKey || sanitizeIdempotencyKey(body?.idempotencyKey);
  if (idempotencyKey) {
    const existingJob = await getImportJobByIdempotency({
      ownerId: session.userId,
      type,
      idempotencyKey,
    });
    if (existingJob) {
      if (existingJob.status === "pending") {
        await kickImportJob(existingJob.id);
      }
      return NextResponse.json({ job: publicJob(existingJob) }, { status: 200 });
    }
  }

  const requestedJobId = createJobId();
  const job = await createImportJob({
    id: requestedJobId,
    ownerId: session.userId,
    type,
    idempotencyKey,
    input: {
      selectedItems,
      categoryValue,
      query: body?.query && typeof body.query === "object" ? body.query : {},
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Failed to queue import job." }, { status: 500 });
  }

  if (job.status === "pending") {
    await kickImportJob(job.id);
  }

  const deduped = Boolean(idempotencyKey) && job.id !== requestedJobId;
  return NextResponse.json({ job: publicJob(job) }, { status: deduped ? 200 : 202 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:tools:import-jobs:create",
      identifier: session.userId || resolveRequestIp(request),
      limit: CREATE_IMPORT_JOBS_LIMIT.limit,
      windowMs: CREATE_IMPORT_JOBS_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse("Too many import job requests. Please retry shortly.", rateLimitState);
    }

    const headerIdempotencyKey = resolveHeaderIdempotencyKey(request);
    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    
    logger.info("Creating import job", {
      userId: session.userId,
      contentType: contentType.includes("multipart") ? "multipart" : "json",
    });

    if (contentType.includes("multipart/form-data")) {
      return handleBadRequest("Multipart import jobs are no longer supported");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const type = String(body?.type || "").trim().toLowerCase();
    if (type === "canva-url") {
      return createCanvaJob(session, body, headerIdempotencyKey);
    }
    if (type === "freepik-icons") {
      return createFreepikIconsJob(session, body, headerIdempotencyKey);
    }
    if (type === "freepik-backgrounds") {
      return createFreepikBackgroundsJob(session, body, headerIdempotencyKey);
    }

    return handleBadRequest("Unsupported import job type");
  } catch (error: any) {
    logger.error("Failed to create import job", {
      error: error?.message,
    });
    return NextResponse.json(
      { error: error?.message || "Failed to create import job" },
      { status: 500 }
    );
  }
}
