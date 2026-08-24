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
import {
  MAX_TEXT_EFFECT_TITLE_LENGTH,
  normalizeTextEffectSpec,
} from "@/lib/textEffects/spec";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit text effects");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const data: Record<string, unknown> = {};
    if (body.titleEn !== undefined) {
      const titleEn = String(body.titleEn).trim();
      if (!titleEn) return handleBadRequest("English title cannot be empty");
      if (titleEn.length > MAX_TEXT_EFFECT_TITLE_LENGTH) return handleBadRequest("English title is too long");
      data.titleEn = titleEn;
    }
    if (body.titleAr !== undefined) {
      const titleAr = String(body.titleAr).trim();
      if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
      if (titleAr.length > MAX_TEXT_EFFECT_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");
      data.titleAr = titleAr;
    }
    if (body.spec !== undefined) data.spec = normalizeTextEffectSpec(body.spec);
    if (body.previewUrl !== undefined) {
      const previewUrl = String(body.previewUrl || "").trim();
      data.previewUrl = previewUrl || null;
    }
    if (body.isPremium !== undefined) data.isPremium = Boolean(body.isPremium);
    if (body.published !== undefined) data.published = Boolean(body.published);

    if (!Object.keys(data).length) return handleBadRequest("No editable fields in request");

    const existing = await prisma.textEffect.findUnique({ where: { id } });
    if (!existing) return handleNotFound("Text effect");

    const effect = await prisma.textEffect.update({ where: { id }, data });
    return NextResponse.json({ ok: true, effect });
  } catch (error) {
    return handleApiError(error, "Failed to update text effect");
  }
}

// Reorders the strip. Accepts a neighbour swap ({direction}) or a full ordering
// ({order:[id,…]}) for drag and drop; the full form must name exactly the
// existing ids so a stale client cannot drop rows from the list.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can reorder text effects");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    if (Array.isArray(body.order)) {
      const order = body.order.map((value: unknown) => String(value));
      const all = await prisma.textEffect.findMany({ select: { id: true } });
      const known = new Set(all.map((row: { id: string }) => row.id));
      if (order.length !== known.size || new Set(order).size !== order.length) {
        return handleBadRequest("The new order must list every effect exactly once");
      }
      for (const rowId of order) {
        if (!known.has(rowId)) return handleBadRequest("Unknown effect in the new order");
      }
      await prisma.$transaction(
        order.map((rowId: string, index: number) =>
          prisma.textEffect.update({ where: { id: rowId }, data: { sortOrder: index } })
        )
      );
      return NextResponse.json({ ok: true, reordered: order.length });
    }

    const direction = String(body.direction || "").trim();
    if (direction !== "up" && direction !== "down") {
      return handleBadRequest('Field "direction" must be "up" or "down"');
    }

    const current = await prisma.textEffect.findUnique({ where: { id } });
    if (!current) return handleNotFound("Text effect");

    const neighbour = await prisma.textEffect.findFirst({
      where: { sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder } },
      orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbour) return NextResponse.json({ ok: true, moved: false });

    await prisma.$transaction([
      prisma.textEffect.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
      prisma.textEffect.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
    ]);
    return NextResponse.json({ ok: true, moved: true });
  } catch (error) {
    return handleApiError(error, "Failed to reorder the effect");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can delete text effects");
    }

    const { id } = await params;
    const existing = await prisma.textEffect.findUnique({ where: { id } });
    if (!existing) return handleNotFound("Text effect");

    await prisma.textEffect.delete({ where: { id } });
    logger.info("Text effect deleted", { userId: session.userId, slug: existing.slug });
    return NextResponse.json({ ok: true, id, slug: existing.slug });
  } catch (error) {
    return handleApiError(error, "Failed to delete text effect");
  }
}
