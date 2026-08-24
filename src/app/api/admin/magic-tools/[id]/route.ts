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
  MAX_MAGIC_TOOL_PROMPT_LENGTH,
  MAX_MAGIC_TOOL_SUBTITLE_LENGTH,
  MAX_MAGIC_TOOL_TITLE_LENGTH,
} from "@/lib/magicTools/constants";
import {
  magicToolModelIncompatibility,
  normalizeMagicToolModelId,
} from "@/lib/magicTools/models";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit magic tools");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const data: Record<string, unknown> = {};

    // Unlike an AI template, an empty prompt is legitimate here: the specialist
    // models take an image and numbers, nothing else.
    if (body.prompt !== undefined) {
      const prompt = String(body.prompt).trim();
      if (prompt.length > MAX_MAGIC_TOOL_PROMPT_LENGTH) {
        return handleBadRequest(`Prompt must be at most ${MAX_MAGIC_TOOL_PROMPT_LENGTH} characters`);
      }
      data.prompt = prompt;
    }
    if (body.titleEn !== undefined) {
      const titleEn = String(body.titleEn).trim();
      if (!titleEn) return handleBadRequest("English title cannot be empty");
      if (titleEn.length > MAX_MAGIC_TOOL_TITLE_LENGTH) return handleBadRequest("English title is too long");
      data.titleEn = titleEn;
    }
    if (body.titleAr !== undefined) {
      const titleAr = String(body.titleAr).trim();
      if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
      if (titleAr.length > MAX_MAGIC_TOOL_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");
      data.titleAr = titleAr;
    }
    if (body.subtitleAr !== undefined) {
      const subtitleAr = String(body.subtitleAr).trim();
      if (subtitleAr.length > MAX_MAGIC_TOOL_SUBTITLE_LENGTH) {
        return handleBadRequest("Arabic subtitle is too long");
      }
      data.subtitleAr = subtitleAr;
    }
    if (body.model !== undefined) {
      const model = normalizeMagicToolModelId(body.model);
      if (!model) return handleBadRequest("Unsupported model");
      data.model = model;
    }
    if (body.modelOptions !== undefined) {
      const options = body.modelOptions;
      if (options !== null && (typeof options !== "object" || Array.isArray(options))) {
        return handleBadRequest("Model options must be an object");
      }
      data.modelOptions = options;
    }
    if (body.creditCost !== undefined) {
      const creditCost = Number(body.creditCost);
      if (!Number.isInteger(creditCost) || creditCost < 0 || creditCost > 10000) {
        return handleBadRequest("Credit cost must be an integer between 0 and 10000");
      }
      data.creditCost = creditCost;
    }
    if (body.isPremium !== undefined) data.isPremium = Boolean(body.isPremium);
    if (body.published !== undefined) data.published = Boolean(body.published);

    if (!Object.keys(data).length) {
      return handleBadRequest("No editable fields in request");
    }

    const existing = await prisma.magicTool.findUnique({ where: { id } });
    if (!existing) return handleNotFound("Magic tool");

    // Validate the pair the row will END UP with, mixing patched and kept
    // fields: switching to a prompt-less model leaves the old prompt silently
    // ignored, and switching to nano-banana with no prompt does nothing at all.
    const effectiveModel = (data.model as string) ?? existing.model;
    const effectivePrompt = (data.prompt as string) ?? existing.prompt;
    const incompatibility = magicToolModelIncompatibility(effectiveModel, effectivePrompt);
    if (incompatibility) return handleBadRequest(incompatibility);

    const tool = await prisma.magicTool.update({ where: { id }, data });
    return NextResponse.json({ ok: true, tool });
  } catch (error) {
    return handleApiError(error, "Failed to update magic tool");
  }
}

// Reorders the flat tool list. Accepts either a neighbour swap ({direction}) or
// a full ordering ({order: [id, …]}) for drag and drop; the full form must name
// exactly the existing ids, so a stale client cannot drop rows from the list.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can reorder magic tools");
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
      const all = await prisma.magicTool.findMany({ select: { id: true } });
      const known = new Set(all.map((row: { id: string }) => row.id));
      if (order.length !== known.size || new Set(order).size !== order.length) {
        return handleBadRequest("The new order must list every tool exactly once");
      }
      for (const rowId of order) {
        if (!known.has(rowId)) return handleBadRequest("Unknown tool in the new order");
      }
      await prisma.$transaction(
        order.map((rowId: string, index: number) =>
          prisma.magicTool.update({ where: { id: rowId }, data: { sortOrder: index } })
        )
      );
      return NextResponse.json({ ok: true, reordered: order.length });
    }

    const direction = String(body.direction || "").trim();
    if (direction !== "up" && direction !== "down") {
      return handleBadRequest('Field "direction" must be "up" or "down"');
    }

    const current = await prisma.magicTool.findUnique({ where: { id } });
    if (!current) return handleNotFound("Magic tool");

    const neighbour = await prisma.magicTool.findFirst({
      where: { sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder } },
      orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbour) return NextResponse.json({ ok: true, moved: false });

    await prisma.$transaction([
      prisma.magicTool.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
      prisma.magicTool.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
    ]);

    return NextResponse.json({ ok: true, moved: true });
  } catch (error) {
    return handleApiError(error, "Failed to reorder the tool");
  }
}

// Deletes one tool. Its card art is left in the bucket: objects are keyed per
// upload, so nothing else references them, and keeping them means a delete can
// never race an in-flight render.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can delete magic tools");
    }

    const { id } = await params;
    const existing = await prisma.magicTool.findUnique({ where: { id } });
    if (!existing) return handleNotFound("Magic tool");

    await prisma.magicTool.delete({ where: { id } });
    logger.info("Magic tool deleted", { userId: session.userId, slug: existing.slug });
    return NextResponse.json({ ok: true, id, slug: existing.slug });
  } catch (error) {
    return handleApiError(error, "Failed to delete magic tool");
  }
}
