import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  getFreepikImportSettings,
  normalizeFreepikBackgroundQueryInput,
  previewFreepikBackgrounds,
} from "@/lib/tools/freepikImport.server";

const FREEPIK_BACKGROUND_PREVIEW_RATE_LIMIT = {
  limit: 40,
  windowMs: 60_000,
};

function sanitizeApiKey(value: any): string {
  return String(value || "").trim();
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:settings:freepik:backgrounds:preview",
      identifier: session.userId || resolveRequestIp(request),
      limit: FREEPIK_BACKGROUND_PREVIEW_RATE_LIMIT.limit,
      windowMs: FREEPIK_BACKGROUND_PREVIEW_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many Freepik background preview requests. Please retry shortly.",
        rateLimitState
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Previewing Freepik backgrounds", {
      userId: session.userId,
      queryKeys: Object.keys(body?.query || body || {}),
    });

    const settings = await getFreepikImportSettings();
    const overrideApiKey = sanitizeApiKey(body?.apiKeyOverride || body?.apiKey);
    const query = normalizeFreepikBackgroundQueryInput({
      acceptLanguage: settings?.defaults?.acceptLanguage || "",
      ...(body?.query && typeof body.query === "object" ? body.query : body),
    });

    const preview = await previewFreepikBackgrounds({
      query,
      apiKey: overrideApiKey || settings?.apiKey,
    });

    return NextResponse.json(preview);
  } catch (error) {
    logger.error("Freepik background preview failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to preview Freepik backgrounds"
    );
  }
}
