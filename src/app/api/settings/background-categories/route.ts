import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { getEditorSession } from "@/lib/templates/server";
import {
  getBackgroundCategorySettings,
  saveBackgroundCategorySettings,
} from "@/lib/backgrounds/categorySettings.server";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Background category settings requested", {
      userId: session.userId,
    });

    const settings = await getBackgroundCategorySettings();
    return NextResponse.json({
      settings,
      canEdit: session.role === "admin",
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve background category settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    if (session.role !== "admin") {
      return handleForbidden("Only admins can update background category settings");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Updating background category settings", {
      userId: session.userId,
    });

    const settings = await saveBackgroundCategorySettings(body?.settings);
    return NextResponse.json({ settings, canEdit: true });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to save background category settings",
      500
    );
  }
}
