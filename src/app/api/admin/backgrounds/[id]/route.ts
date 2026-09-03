import { NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  handleApiError,
  handleBadRequest,
  handleForbidden,
  handleNotFound,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { setImportedBackgroundPremium } from "@/lib/editor/importedBackgrounds.server";

export const runtime = "nodejs";

/**
 * Per-background admin edits — currently just the Nayroz Pro flag.
 *
 * Backgrounds live in the raw-SQL `editor_background_assets` table (bulk imported,
 * not authored), so this writes through a dedicated setter rather than Prisma.
 * Sparse PATCH in the house style (see admin/text-effects/[id]).
 *
 * Unlike fonts there is no catalog-version bump to do: the app holds background
 * images in a per-process memory cache only, so the next launch sees the change.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit backgrounds");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    if (body.isPremium === undefined) {
      return handleBadRequest("No editable fields in request");
    }

    const result = await setImportedBackgroundPremium({ id, isPremium: Boolean(body.isPremium) });
    if (!result.updated) return handleNotFound("Background");

    logger.info("Background premium flag updated", {
      userId: session.userId,
      backgroundId: result.id,
      isPremium: result.isPremium,
    });
    return NextResponse.json({
      ok: true,
      background: { id: result.id, isPremium: result.isPremium },
    });
  } catch (error) {
    return handleApiError(error, "Failed to update the background");
  }
}
