import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

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

export const runtime = "nodejs";
export const maxDuration = 60;

const TEMP_IMPORT_DIR = path.join(process.cwd(), ".tmp", "import-jobs");
const CREATE_IMPORT_JOBS_LIMIT = {
  limit: 20,
  windowMs: 60_000,
};

function createJobId() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return randomUUID();
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isCanvaUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return /(\.|^)canva\.com$/i.test(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function resolveRasterFormat({ format, fileName, mimeType }) {
  const explicit = String(format || "").trim().toLowerCase();
  if (explicit === "pdf" || explicit === "psd") return explicit;

  const safeFileName = String(fileName || "").trim().toLowerCase();
  const safeMimeType = String(mimeType || "").trim().toLowerCase();
  if (safeFileName.endsWith(".pdf") || safeMimeType.includes("application/pdf")) return "pdf";
  if (
    safeFileName.endsWith(".psd") ||
    safeMimeType.includes("image/vnd.adobe.photoshop") ||
    safeMimeType.includes("application/vnd.adobe.photoshop") ||
    safeMimeType.includes("application/photoshop") ||
    safeMimeType.includes("application/x-photoshop")
  ) {
    return "psd";
  }
  return "";
}

function sanitizeIdempotencyKey(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
}

function resolveHeaderIdempotencyKey(request) {
  const keyFromHeader = request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");
  return sanitizeIdempotencyKey(keyFromHeader);
}

function publicJob(job) {
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

function sanitizeFreepikSelectedItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 300);
}

async function createCanvaJob(session, body, requestIdempotencyKey) {
  const type = "canva-url";

  const url = String(body?.url || "").trim();
  if (!url) {
    return NextResponse.json({ error: "Canva URL is required." }, { status: 400 });
  }
  if (!isCanvaUrl(url)) {
    return NextResponse.json({ error: "Expected a valid canva.com URL." }, { status: 400 });
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

async function createFreepikIconsJob(session, body, requestIdempotencyKey) {
  const type = "freepik-icons";
  const selectedItems = sanitizeFreepikSelectedItems(body?.selectedItems);
  if (selectedItems.length === 0) {
    return NextResponse.json(
      { error: "At least one selected Freepik icon is required." },
      { status: 400 }
    );
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

async function createVectorRasterJob(session, request, requestIdempotencyKey) {
  let formData;
  try {
    formData = await request.formData();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const type = String(formData.get("type") || "")
    .trim()
    .toLowerCase();
  if (type !== "vector-raster") {
    return NextResponse.json({ error: "Unsupported import job type." }, { status: 400 });
  }

  const idempotencyKey = requestIdempotencyKey || sanitizeIdempotencyKey(formData.get("idempotencyKey"));
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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
  }
  if (Number(file.size || 0) <= 0) {
    return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
  }

  const fileName = sanitizeFileName(file.name) || "upload.bin";
  const format = resolveRasterFormat({
    format: formData.get("format"),
    fileName,
    mimeType: file.type,
  });
  if (!format) {
    return NextResponse.json({ error: "Only PDF and PSD are supported for raster import jobs." }, { status: 400 });
  }

  const requestedJobId = createJobId();
  await fs.mkdir(TEMP_IMPORT_DIR, { recursive: true });
  const tempFilePath = path.join(TEMP_IMPORT_DIR, `${requestedJobId}-${fileName}`);
  await fs.writeFile(tempFilePath, Buffer.from(await file.arrayBuffer()));

  try {
    const job = await createImportJob({
      id: requestedJobId,
      ownerId: session.userId,
      type,
      idempotencyKey,
      input: {
        format,
        fileName,
        filePath: tempFilePath,
        mimeType: String(file.type || "").trim().toLowerCase(),
        name: String(formData.get("name") || "").trim(),
        slug: String(formData.get("slug") || "").trim(),
        maxDimension: clampNumber(formData.get("maxDimension"), 1920, 320, 4096),
      },
    });

    if (!job) {
      throw new Error("Failed to queue import job.");
    }

    const deduped = Boolean(idempotencyKey) && job.id !== requestedJobId;
    if (deduped) {
      await fs.rm(tempFilePath, { force: true }).catch(() => {});
    }

    if (job.status === "pending") {
      await kickImportJob(job.id);
    }

    return NextResponse.json({ job: publicJob(job) }, { status: deduped ? 200 : 202 });
  } catch (error) {
    await fs.rm(tempFilePath, { force: true }).catch(() => {});
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to queue import job.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
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
  if (contentType.includes("multipart/form-data")) {
    return createVectorRasterJob(session, request, headerIdempotencyKey);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = String(body?.type || "").trim().toLowerCase();
  if (type === "canva-url") {
    return createCanvaJob(session, body, headerIdempotencyKey);
  }
  if (type === "freepik-icons") {
    return createFreepikIconsJob(session, body, headerIdempotencyKey);
  }

  return NextResponse.json({ error: "Unsupported import job type." }, { status: 400 });
}
