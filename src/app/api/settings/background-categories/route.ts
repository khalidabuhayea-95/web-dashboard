import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
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
      // Taxonomy is content: every role that reaches this endpoint (admin and
      // designer, per getEditorSession) may edit it.
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve background category settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

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
