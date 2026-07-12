import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import { handleApiError } from "@/lib/api/errors";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { logger } from "@/lib/logging/logger";
import { importAppchiefFontsBatch } from "@/lib/fonts/appchiefFontsImport.server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rateLimitState = checkRateLimit({
      scope: "api:admin:fonts:import-appchief",
      identifier: session.userId || resolveRequestIp(request),
      limit: 120,
      windowMs: 60_000,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse("Too many import requests. Please retry shortly.", rateLimitState);
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      body = {};
    }

    const offset = Number(body?.offset) || 0;
    const limit = Number(body?.limit) || 20;

    const result = await importAppchiefFontsBatch({ offset, limit });

    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("App fonts import batch failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to import fonts from the app catalog."
    );
  }
}
