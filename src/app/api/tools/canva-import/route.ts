import { NextRequest, NextResponse } from "next/server";

import { runCanvaImportForOwner } from "@/lib/tools/canvaImport.server";
import { getEditorSession } from "@/lib/templates/server";
import { handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

// The Canva import logic lives in a framework-free module so the standalone
// import worker (scripts/worker.ts) can run it without importing `next/*`.
// This route is the synchronous web entrypoint kept for manual/legacy use.

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Starting Canva import", {
      userId: session.userId,
      hasUrl: !!body?.url,
    });

    const result = await runCanvaImportForOwner({
      ownerId: session.userId,
      url: body?.url,
      name: body?.name,
      slug: body?.slug,
      maxDimension: body?.maxDimension,
      timeoutMs: body?.timeoutMs,
      interactiveBrowser: body?.interactiveBrowser === true,
    });
    return NextResponse.json(result.payload || {}, { status: result.status || 200 });
  } catch (error: any) {
    logger.error("Canva import failed", {
      error: error?.message,
    });
    const status = Number(error?.status || 422);
    const payload =
      error?.payload && typeof error.payload === "object"
        ? error.payload
        : { error: error?.message || "Failed to import Canva template." };
    return NextResponse.json(payload, { status });
  }
}
