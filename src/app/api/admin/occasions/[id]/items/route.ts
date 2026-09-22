import { NextResponse } from "next/server";

import { handleApiError, handleBadRequest, handleNotFound } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { linkOccasionItem, listHydratedOccasionItems, unlinkOccasionItem } from "@/lib/occasions/items.server";
import { countOccasionReminders } from "@/lib/occasions/occasions.server";
import { normalizeOccasionItemInput, OccasionValidationError } from "@/lib/occasions/validate";
import prisma from "@/lib/prisma";
import { rewritePublicObjectUrlsForClient } from "@/lib/storage/objectStorage.server";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";

// Linked content of one occasion. Open to designers as well as admins: linking the
// templates they made to the occasion they made them for is part of producing them.
async function loadPayload(occasionId: string) {
  const items = await listHydratedOccasionItems(occasionId);
  const counts = await countOccasionReminders();
  return rewritePublicObjectUrlsForClient({ ok: true, items, counts });
}

async function occasionExists(id: string) {
  return Boolean(await prisma.occasion.findUnique({ where: { id }, select: { id: true } }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    const { id } = await params;
    if (!(await occasionExists(id))) return handleNotFound("Occasion");
    return NextResponse.json(await loadPayload(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "Failed to load linked content");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    const { id } = await params;
    if (!(await occasionExists(id))) return handleNotFound("Occasion");

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    // Accepts one link or a batch ({ items: [{ kind, itemId }, …] }) so a multi-select in
    // the picker is a single round trip.
    const inputs = Array.isArray(body.items) ? body.items : [body];
    if (inputs.length === 0 || inputs.length > 200) return handleBadRequest("Link between 1 and 200 items per request");
    const links = inputs.map((input: unknown) => normalizeOccasionItemInput(input));
    for (const link of links) {
      await linkOccasionItem(id, link.kind, link.itemId);
    }
    logger.info("Occasion content linked", { userId: session.userId, occasionId: id, count: links.length });
    return NextResponse.json(await loadPayload(id), { status: 201 });
  } catch (error) {
    if (error instanceof OccasionValidationError) return handleBadRequest(error.message);
    return handleApiError(error, "Failed to link content");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    const { id } = await params;
    if (!(await occasionExists(id))) return handleNotFound("Occasion");

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }
    const linkIds: string[] = (Array.isArray(body.ids) ? body.ids : [body.id]).map((value: unknown) => String(value || "").trim()).filter(Boolean);
    if (linkIds.length === 0) return handleBadRequest('Field "id" (or "ids") is required');

    let removed = 0;
    for (const linkId of linkIds) {
      if (await unlinkOccasionItem(id, linkId)) removed += 1;
    }
    logger.info("Occasion content unlinked", { userId: session.userId, occasionId: id, removed });
    return NextResponse.json({ ...(await loadPayload(id)), removed });
  } catch (error) {
    return handleApiError(error, "Failed to unlink content");
  }
}
