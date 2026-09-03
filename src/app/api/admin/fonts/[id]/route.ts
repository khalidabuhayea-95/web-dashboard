import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import {
  handleApiError,
  handleBadRequest,
  handleForbidden,
  handleNotFound,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { bumpFontCatalogVersion } from "@/lib/fonts/fontCatalogVersion.server";

export const runtime = "nodejs";

/**
 * Per-font admin edits. Today that means one thing: marking a font Pro-only.
 *
 * Sparse PATCH in the house style (see admin/text-effects/[id]) — only the keys
 * present in the body are written.
 *
 * ★The catalog-version bump is not optional. The app caches the ENTIRE font
 * catalog locally and only refetches when `fontsVersion` from /api/mobile/app-settings
 * changes, so a font flagged Pro without a bump stays free on every device that
 * already synced.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit fonts");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const data: Record<string, unknown> = {};
    if (body.isPremium !== undefined) data.isPremium = Boolean(body.isPremium);

    if (!Object.keys(data).length) return handleBadRequest("No editable fields in request");

    const existing = await prisma.fontFamily.findUnique({ where: { id } });
    if (!existing) return handleNotFound("Font");

    const font = await prisma.fontFamily.update({ where: { id }, data });
    await bumpFontCatalogVersion();

    logger.info("Font premium flag updated", {
      userId: session.userId,
      fontId: id,
      family: font.family,
      isPremium: font.isPremium,
    });
    return NextResponse.json({ ok: true, font: { id: font.id, isPremium: font.isPremium } });
  } catch (error) {
    return handleApiError(error, "Failed to update the font");
  }
}
