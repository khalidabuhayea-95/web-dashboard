import { NextRequest, NextResponse } from "next/server";

import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import {
  getMobileAppSettings,
  MobileAppSettingsValidationError,
  resolveMobileAppSettingsDecision,
} from "@/lib/settings/mobileAppSettings.server";
import { getReplicateDefaultObjectRemovalModelId } from "@/lib/media/objectRemoval/providers/replicate.server";
import { getFontCatalogVersion } from "@/lib/fonts/fontCatalogVersion.server";
import { optionalCreditSummary } from "@/lib/media/credits/index.server";

const logger = createLogger("api.mobile.app-settings");

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:app-settings",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    const { searchParams } = new URL(request.url);
    const deviceType = searchParams.get("deviceType");
    const appVersion = searchParams.get("appVersion");

    if (!deviceType) {
      return attachRequestIdHeader(
        handleBadRequest("Missing required query parameter: deviceType"),
        requestId
      );
    }

    if (!appVersion) {
      return attachRequestIdHeader(
        handleBadRequest("Missing required query parameter: appVersion"),
        requestId
      );
    }

    const settings = await getMobileAppSettings();
    const responsePayload = resolveMobileAppSettingsDecision(settings, {
      deviceType,
      appVersion,
      defaultObjectRemovalModel: getReplicateDefaultObjectRemovalModelId(),
    });
    const {
      objectRemovalModel: _objectRemovalModel,
      aiExpandModel: _aiExpandModel,
      upscaleModel: _upscaleModel,
      ...publicResponsePayload
    } = responsePayload;

    // Font catalog version — mobile app caches the full font list keyed by this
    // and only re-fetches /api/mobile/fonts when it changes.
    const fontsVersion = await getFontCatalogVersion();
    // ★The wallet rides along here (2026-09-08 direction): app-settings is the call every
    // launch already makes, so the editor's AI sheets have a balance and a price list before
    // anything asks for one. Null for a signed-out caller — the field is simply absent.
    const credits = await optionalCreditSummary(request);
    const publicResponseWithFonts = {
      ...publicResponsePayload,
      fontsVersion,
      ...(credits ? { credits } : {}),
    };

    requestLogger.info("Resolved mobile app settings", publicResponseWithFonts);

    const response = NextResponse.json(publicResponseWithFonts, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    if (error instanceof MobileAppSettingsValidationError) {
      return attachRequestIdHeader(handleBadRequest(error.message), requestId);
    }

    requestLogger.error("Failed to resolve mobile app settings", error, {});
    return attachRequestIdHeader(
      handleApiError(error, "Failed to fetch mobile app settings"),
      requestId
    );
  }
}
