import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getImportJobStatusSummary } from "@/lib/tools/importJobsStore.server";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauthenticated liveness/readiness probe (also the container healthcheck).
// The probe passes on DB connectivity; the import-job backlog is best-effort
// extra signal and never fails the check on its own.
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error: any) {
    logger.error("Health check failed: database unreachable", {
      error: error?.message,
    });
    return NextResponse.json(
      { status: "error", db: "down", error: error?.message || "database unreachable" },
      { status: 503 }
    );
  }

  let imports = null;
  try {
    imports = await getImportJobStatusSummary({ lookbackHours: 24 });
  } catch (error: any) {
    // DB is up but the import-jobs summary failed (e.g. restricted DDL role).
    // Non-fatal — surface it without failing the probe.
    logger.warn("Health check: import job summary unavailable", {
      error: error?.message,
    });
  }

  return NextResponse.json({
    status: "ok",
    db: "up",
    imports,
    uptimeSeconds: Math.round(process.uptime()),
    durationMs: Date.now() - startedAt,
  });
}
