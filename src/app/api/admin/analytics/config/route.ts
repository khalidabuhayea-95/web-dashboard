import { NextRequest, NextResponse } from "next/server";

import {
  getAnalyticsSettings,
  saveAnalyticsSettings,
  toPublicAnalyticsSettings,
} from "@/lib/settings/analyticsSettings.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requireAnalyticsAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsAdmin(request, "config:read", { limit: 60 });
  if ("error" in auth) return auth.error;

  try {
    const settings = await getAnalyticsSettings();
    return NextResponse.json({
      config: toPublicAnalyticsSettings(settings),
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(error, "Failed to load analytics configuration.");
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAnalyticsAdmin(request, "config:write", { limit: 20 });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  try {
    const saved = await saveAnalyticsSettings({
      reportUrl: body.reportUrl,
      measurementId: body.measurementId,
    });
    logger.info("Analytics configuration updated", {
      userId: auth.session.userId,
      configured: Boolean(saved.reportUrl),
    });
    return NextResponse.json({ config: toPublicAnalyticsSettings(saved) });
  } catch (error) {
    // normalizeLookerEmbedUrl / normalizeMeasurementId throw user-facing
    // validation messages.
    return handleBadRequest(
      error instanceof Error ? error.message : "Invalid analytics configuration.",
    );
  }
}
