import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  getFreepikImportSettings,
  normalizeFreepikQueryInput,
  previewFreepikIcons,
} from "@/lib/tools/freepikImport.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

const FREEPIK_PREVIEW_RATE_LIMIT = {
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
      scope: "api:settings:freepik:preview",
      identifier: session.userId || resolveRequestIp(request),
      limit: FREEPIK_PREVIEW_RATE_LIMIT.limit,
      windowMs: FREEPIK_PREVIEW_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many Freepik preview requests. Please retry shortly.",
        rateLimitState
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Previewing Freepik icons", {
      userId: session.userId,
      queryKeys: Object.keys(body?.query || body || {}),
    });

    const settings = await getFreepikImportSettings();
    const overrideApiKey = sanitizeApiKey(body?.apiKeyOverride || body?.apiKey);
    const query = normalizeFreepikQueryInput({
      ...(settings?.defaults || {}),
      ...(body?.query && typeof body.query === "object" ? body.query : body),
    });

    const preview = await previewFreepikIcons({
      query,
      apiKey: overrideApiKey || settings?.apiKey,
    });

    return NextResponse.json(preview);
  } catch (error) {
    logger.error("Freepik preview failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to preview Freepik icons"
    );
  }
}
