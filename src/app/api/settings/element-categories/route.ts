import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { getEditorSession } from "@/lib/templates/server";
import {
  getElementCategorySettings,
  saveElementCategorySettings,
} from "@/lib/elements/categorySettings.server";
import { countImportedElementAssetsByCategory } from "@/lib/editor/importedElements.server";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Element category settings requested", {
      userId: session.userId,
    });

    const settings = await getElementCategorySettings();
    // Per-category asset counts: removing a category deletes its elements, so the page has to be
    // able to say how many before asking the user to confirm.
    const counts = await countImportedElementAssetsByCategory().catch(() => ({}));
    return NextResponse.json({
      settings,
      counts,
      // Taxonomy is content: every role that reaches this endpoint (admin and
      // designer, per getEditorSession) may edit it.
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve element category settings");
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

    logger.info("Updating element category settings", {
      userId: session.userId,
    });

    const result = await saveElementCategorySettings(body?.settings);
    const counts = await countImportedElementAssetsByCategory().catch(() => ({}));
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
      error instanceof Error ? error.message : "Failed to save element category settings",
      500
    );
  }
}
