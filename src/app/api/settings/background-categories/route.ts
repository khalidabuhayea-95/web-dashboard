import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { getEditorSession } from "@/lib/templates/server";
import {
  getBackgroundCategorySettings,
  saveBackgroundCategorySettings,
} from "@/lib/backgrounds/categorySettings.server";
import { countImportedBackgroundAssetsByCategory } from "@/lib/editor/importedBackgrounds.server";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Background category settings requested", {
      userId: session.userId,
    });

    const settings = await getBackgroundCategorySettings();
    // Per-category asset counts: removing a category deletes its backgrounds, so the page has
    // to be able to say how many before asking the user to confirm.
    const counts = await countImportedBackgroundAssetsByCategory().catch(() => ({}));
    return NextResponse.json({
      settings,
      counts,
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

    const result = await saveBackgroundCategorySettings(body?.settings);
    const counts = await countImportedBackgroundAssetsByCategory().catch(() => ({}));
    return NextResponse.json({
      settings: result.settings,
      counts,
      removedCategories: result.removedCategories,
      deletedAssets: result.deletedAssets,
      deletedObjects: result.deletedObjects,
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to save background category settings",
      500
    );
  }
}
