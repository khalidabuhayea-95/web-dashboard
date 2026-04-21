import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  getMobileAuthSettings,
  saveMobileAuthSettings,
  toPublicMobileAuthSettings,
} from "@/lib/settings/mobileAuthSettings.server";
import {
  handleApiError,
  handleBadRequest,
  handleForbidden,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Mobile auth settings requested", {
      userId: session.userId,
    });

    const settings = await getMobileAuthSettings();
    return NextResponse.json({
      settings: toPublicMobileAuthSettings(settings),
      canEdit: session.role === "admin",
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve mobile auth settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    if (session.role !== "admin") {
      return handleForbidden("Only admins can update mobile auth settings");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Updating mobile auth settings", {
      userId: session.userId,
    });

    const saved = await saveMobileAuthSettings(body);

    return NextResponse.json({
      settings: toPublicMobileAuthSettings(saved),
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to save mobile auth settings",
      500
    );
  }
}
