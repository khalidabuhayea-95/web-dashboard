import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  getTemplateTaxonomySettings,
  saveTemplateTaxonomySettings,
} from "@/lib/templates/templateSettings.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { getTemplateCategoryCounts } from "@/lib/templates/templateCategoryCounts.server";
import { logger } from "@/lib/logging/logger";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Template taxonomy settings requested", {
      userId: session.userId,
    });

    const [settings, templateCounts] = await Promise.all([
      getTemplateTaxonomySettings(),
      // Counts are a display aid; a failure here must never cost the admin the taxonomy itself.
      getTemplateCategoryCounts().catch((error) => {
        logger.warn("Template category counts unavailable", {
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }),
    ]);
    return NextResponse.json({
      settings,
      templateCounts,
      // Taxonomy is content: every role that reaches this endpoint (admin and
      // designer, per getEditorSession) may edit it.
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve taxonomy settings");
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

    logger.info("Updating template taxonomy settings", {
      userId: session.userId,
    });

    const settings = await saveTemplateTaxonomySettings(body?.settings);
    return NextResponse.json({ settings, canEdit: true });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to save taxonomy settings",
      500
    );
  }
}
