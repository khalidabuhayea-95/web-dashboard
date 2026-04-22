import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  getMobileAppSettings,
  MobileAppSettingsValidationError,
  saveMobileAppSettings,
} from "@/lib/settings/mobileAppSettings.server";
import { getEditorSession } from "@/lib/templates/server";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Mobile app settings requested", {
      userId: session.userId,
    });

    const settings = await getMobileAppSettings();
    return NextResponse.json({
      settings,
      canEdit: session.role === "admin",
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve mobile app settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    if (session.role !== "admin") {
      return handleForbidden("Only admins can update mobile app settings");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Updating mobile app settings", {
      userId: session.userId,
    });

    const saved = await saveMobileAppSettings(body);

    return NextResponse.json({
      settings: saved,
      canEdit: true,
    });
  } catch (error) {
    if (error instanceof MobileAppSettingsValidationError) {
      return handleBadRequest(error.message);
    }

    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to save mobile app settings",
      500
    );
  }
}
