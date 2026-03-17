import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { drainImportJobs } from "@/lib/tools/importJobsRunner.server";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

const WORKER_RATE_LIMIT = {
  limit: 120,
  windowMs: 60_000,
};

function parseClampedInt(value: any, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.floor(numeric);
  return Math.min(max, Math.max(min, normalized));
}

function safeCompareSecret(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

async function parseJsonBody(request: NextRequest): Promise<any> {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return {};
  return request.json().catch(() => ({}));
}

function resolveWorkerSecret(request: NextRequest, body: any): string {
  const auth = String(request.headers.get("authorization") || "").trim();
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const headerSecret = String(request.headers.get("x-import-jobs-worker-secret") || "").trim();
  if (headerSecret) return headerSecret;
  return String(body?.secret || "").trim();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitState = checkRateLimit({
    scope: "api:tools:import-jobs:worker",
    identifier: resolveRequestIp(request),
    limit: WORKER_RATE_LIMIT.limit,
    windowMs: WORKER_RATE_LIMIT.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse("Too many worker requests. Please retry shortly.", rateLimitState);
  }

  const configuredSecret = String(process.env.IMPORT_JOBS_WORKER_SECRET || "").trim();
  if (!configuredSecret) {
    return NextResponse.json(
      {
        error: "Import jobs worker is not configured.",
      },
      { status: 503 }
    );
  }

  const body = await parseJsonBody(request);
  const providedSecret = resolveWorkerSecret(request, body);
  if (!safeCompareSecret(providedSecret, configuredSecret)) {
    logger.warn("Unauthorized import jobs worker request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const limit = parseClampedInt(body?.limit ?? searchParams.get("limit"), 5, 1, 20);
  const staleAfterSeconds = parseClampedInt(
    body?.staleAfterSeconds ?? searchParams.get("staleAfterSeconds"),
    300,
    30,
    3600
  );

  logger.info("Running import jobs worker", {
    limit,
    staleAfterSeconds,
  });

  const result = await drainImportJobs({
    limit,
    staleAfterSeconds,
  });

  return NextResponse.json({
    ...result,
    limit,
    staleAfterSeconds,
    executedAt: new Date().toISOString(),
  });
}
