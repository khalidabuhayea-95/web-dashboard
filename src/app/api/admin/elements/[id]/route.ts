import { NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  handleApiError,
  handleBadRequest,
  handleForbidden,
  handleNotFound,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { setImportedElementPremium } from "@/lib/editor/importedElements.server";

export const runtime = "nodejs";

/**
 * Per-element admin edits — currently just the Nayroz Pro flag.
 *
 * Elements live in the raw-SQL `editor_element_assets` table (they are bulk
 * imported, not authored), so this writes through a dedicated setter rather than
 * Prisma. Sparse PATCH in the house style (see admin/text-effects/[id]).
 *
 * Unlike fonts there is no catalog-version bump to do: /api/mobile/elements is
 * fetched fresh (the app keeps no persistent element cache).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit elements");
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

    const result = await setImportedElementPremium({ id, isPremium: Boolean(body.isPremium) });
    if (!result.updated) return handleNotFound("Element");

    logger.info("Element premium flag updated", {
      userId: session.userId,
      elementId: result.id,
      isPremium: result.isPremium,
    });
    return NextResponse.json({ ok: true, element: { id: result.id, isPremium: result.isPremium } });
  } catch (error) {
    return handleApiError(error, "Failed to update the element");
  }
}
