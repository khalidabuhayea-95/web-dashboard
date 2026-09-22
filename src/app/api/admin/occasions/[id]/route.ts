import { NextResponse } from "next/server";

import { handleApiError, handleBadRequest, handleForbidden, handleNotFound } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { deleteOccasion, getOccasion, updateOccasion } from "@/lib/occasions/occasions.server";
import { OccasionValidationError } from "@/lib/occasions/validate";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    const { id } = await params;
    const occasion = await getOccasion(id);
    if (!occasion) return handleNotFound("Occasion");
    return NextResponse.json({ ok: true, occasion }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "Failed to load occasion");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") return handleForbidden("Only admins can edit occasions");

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const row = await updateOccasion(id, body);
    if (!row) return handleNotFound("Occasion");
    const occasion = await getOccasion(id);
    return NextResponse.json({ ok: true, occasion });
  } catch (error) {
    if (error instanceof OccasionValidationError) return handleBadRequest(error.message);
    return handleApiError(error, "Failed to update occasion");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") return handleForbidden("Only admins can delete occasions");

    const { id } = await params;
    const removed = await deleteOccasion(id);
    if (!removed) return handleNotFound("Occasion");
    logger.info("Occasion deleted", { userId: session.userId, slug: removed.slug });
    return NextResponse.json({ ok: true, id, slug: removed.slug });
  } catch (error) {
    return handleApiError(error, "Failed to delete occasion");
  }
}
