import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  getFreepikImportSettings,
  saveFreepikImportSettings,
} from "@/lib/tools/freepikImport.server";
import { handleApiError, handleForbidden, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

function toPublicSettings(settings: any) {
  return {
    apiKeyConfigured: Boolean(settings?.apiKeyConfigured || settings?.apiKey),
    apiKeyMasked: String(settings?.apiKeyMasked || ""),
    defaults: settings?.defaults || {},
    updatedAt: String(settings?.updatedAt || ""),
  };
}

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    logger.info("Magnific import settings requested", {
      userId: session.userId,
    });

    const settings = await getFreepikImportSettings();
    return NextResponse.json({
      settings: toPublicSettings(settings),
      canEdit: session.role === "admin",
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve Magnific settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    if (session.role !== "admin") {
      return handleForbidden("Only admins can update Magnific settings");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    logger.info("Updating Magnific settings", {
      userId: session.userId,
    });

    const saved = await saveFreepikImportSettings({
      apiKey: body?.apiKey,
      defaults: body?.defaults,
    });

    return NextResponse.json({
      settings: toPublicSettings(saved),
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to save Magnific settings",
      500
    );
  }
}
