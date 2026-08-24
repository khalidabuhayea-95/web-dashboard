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
  MAX_AI_TEMPLATE_PROMPT_LENGTH as MAX_PROMPT_LENGTH,
  MAX_AI_TEMPLATE_TITLE_LENGTH as MAX_TITLE_LENGTH,
  normalizeAiTemplateReferenceKind,
} from "@/lib/aiTemplates/constants";
import {
  aiTemplateModelIncompatibility,
  normalizeAiTemplateModelId,
} from "@/lib/aiTemplates/models";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit AI templates");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const data: Record<string, unknown> = {};

    if (body.prompt !== undefined) {
      const prompt = String(body.prompt).trim();
      if (!prompt) return handleBadRequest("Prompt cannot be empty");
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return handleBadRequest(`Prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
      }
      data.prompt = prompt;
    }
    if (body.titleEn !== undefined) {
      const titleEn = String(body.titleEn).trim();
      if (!titleEn) return handleBadRequest("English title cannot be empty");
      if (titleEn.length > MAX_TITLE_LENGTH) return handleBadRequest("English title is too long");
      data.titleEn = titleEn;
    }
    if (body.titleAr !== undefined) {
      const titleAr = String(body.titleAr).trim();
      if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
      if (titleAr.length > MAX_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");
      data.titleAr = titleAr;
    }
    if (body.categoryId !== undefined) {
      const categoryId = String(body.categoryId).trim();
      if (!categoryId) return handleBadRequest("Pick a category");
      const category = await prisma.aiTemplateCategory.findUnique({ where: { id: categoryId } });
      if (!category) return handleBadRequest("That category no longer exists");
      data.categoryId = categoryId;
    }
    if (body.referenceKind !== undefined) {
      const referenceKind = normalizeAiTemplateReferenceKind(body.referenceKind);
      if (!referenceKind) return handleBadRequest("Unknown input kind");
      data.referenceKind = referenceKind;
    }
    if (body.model !== undefined) {
      const model = normalizeAiTemplateModelId(body.model);
      if (!model) return handleBadRequest("Unsupported model");
      data.model = model;
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

    const existing = await prisma.aiTemplate.findUnique({ where: { id } });
    if (!existing) return handleNotFound("AI template");

    // Validate the pair the row will END UP with, mixing patched and kept
    // fields — changing only the input kind can invalidate the kept model.
    const effectiveModel = (data.model as string) ?? existing.model;
    const effectiveReference = (data.referenceKind as string) ?? existing.referenceKind;
    const incompatibility = aiTemplateModelIncompatibility(effectiveModel, effectiveReference);
    if (incompatibility) return handleBadRequest(incompatibility);

    const template = await prisma.aiTemplate.update({ where: { id }, data });
    return NextResponse.json({ ok: true, template });
  } catch (error) {
    return handleApiError(error, "Failed to update AI template");
  }
}

// Moves a template one place earlier or later within its category by swapping
// sortOrder with its neighbour. Swapping (rather than renumbering everything)
// keeps the write to two rows and cannot corrupt the rest of the order.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can reorder AI templates");
    }

    const { id } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const direction = String(body.direction || "").trim();
    if (direction !== "up" && direction !== "down") {
      return handleBadRequest('Field "direction" must be "up" or "down"');
    }

    const current = await prisma.aiTemplate.findUnique({ where: { id } });
    if (!current) return handleNotFound("AI template");

    const neighbour = await prisma.aiTemplate.findFirst({
      where: {
        categoryId: current.categoryId,
        sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    });
    // Already at the end of its category — nothing to swap with.
    if (!neighbour) return NextResponse.json({ ok: true, moved: false });

    await prisma.$transaction([
      prisma.aiTemplate.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
      prisma.aiTemplate.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
    ]);

    return NextResponse.json({ ok: true, moved: true });
  } catch (error) {
    return handleApiError(error, "Failed to reorder the template");
  }
}

// Deletes one template. Its card art is left in the bucket: objects are keyed
// per upload, so nothing else references them, and keeping them means a delete
// can never race an in-flight render.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can delete AI templates");
    }

    const { id } = await params;
    const existing = await prisma.aiTemplate.findUnique({ where: { id } });
    if (!existing) return handleNotFound("AI template");

    await prisma.aiTemplate.delete({ where: { id } });
    logger.info("AI template deleted", { userId: session.userId, slug: existing.slug });
    return NextResponse.json({ ok: true, id, slug: existing.slug });
  } catch (error) {
    return handleApiError(error, "Failed to delete AI template");
  }
}
