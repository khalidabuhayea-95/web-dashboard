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
import { MAX_AI_TEMPLATE_TITLE_LENGTH } from "@/lib/aiTemplates/constants";

export const runtime = "nodejs";

// Renames a category or flips its published / "New" flags. The slug is left
// alone on purpose: template slugs are built from it, and the seed matches on
// it, so changing it here would orphan rows on the next seed.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can edit AI template categories");
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
      if (titleEn.length > MAX_AI_TEMPLATE_TITLE_LENGTH) return handleBadRequest("English title is too long");
      data.titleEn = titleEn;
    }
    if (body.titleAr !== undefined) {
      const titleAr = String(body.titleAr).trim();
      if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
      if (titleAr.length > MAX_AI_TEMPLATE_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");
      data.titleAr = titleAr;
    }
    if (body.isNew !== undefined) data.isNew = Boolean(body.isNew);
    if (body.published !== undefined) data.published = Boolean(body.published);

    if (!Object.keys(data).length) return handleBadRequest("No editable fields in request");

    const existing = await prisma.aiTemplateCategory.findUnique({ where: { id } });
    if (!existing) return handleNotFound("AI template category");

    const category = await prisma.aiTemplateCategory.update({ where: { id }, data });
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    return handleApiError(error, "Failed to update AI template category");
  }
}

// Persists a whole category's template order in one request (drag-and-drop
// produces an arbitrary move, not a neighbour swap). The submitted ids must be
// exactly this category's templates — no missing or foreign ids — so a stale
// client can never renumber a partial list and corrupt the order.
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

    const templateIds: string[] = Array.isArray(body.templateIds)
      ? body.templateIds.map((value: unknown) => String(value))
      : [];
    if (!templateIds.length) return handleBadRequest("templateIds must be a non-empty array");
    if (new Set(templateIds).size !== templateIds.length) {
      return handleBadRequest("templateIds contains duplicates");
    }

    const category = await prisma.aiTemplateCategory.findUnique({
      where: { id },
      include: { templates: { select: { id: true } } },
    });
    if (!category) return handleNotFound("AI template category");

    const existing = new Set(category.templates.map((template: { id: string }) => template.id));
    if (
      templateIds.length !== existing.size ||
      !templateIds.every((templateId) => existing.has(templateId))
    ) {
      return handleBadRequest(
        "templateIds must list exactly the templates in this category — reload and try again"
      );
    }

    await prisma.$transaction(
      templateIds.map((templateId, index) =>
        prisma.aiTemplate.update({ where: { id: templateId }, data: { sortOrder: index } })
      )
    );

    logger.info("AI templates reordered", {
      userId: session.userId,
      category: category.slug,
      count: templateIds.length,
    });
    return NextResponse.json({ ok: true, count: templateIds.length });
  } catch (error) {
    return handleApiError(error, "Failed to save the new order");
  }
}

// Deletes a category and, through the schema's cascade, every template inside
// it. The response reports how many went with it so the dashboard can say so
// rather than silently dropping work.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can delete AI template categories");
    }

    const { id } = await params;
    const existing = await prisma.aiTemplateCategory.findUnique({
      where: { id },
      include: { _count: { select: { templates: true } } },
    });
    if (!existing) return handleNotFound("AI template category");

    await prisma.aiTemplateCategory.delete({ where: { id } });
    logger.info("AI template category deleted", {
      userId: session.userId,
      slug: existing.slug,
      templates: existing._count.templates,
    });

    return NextResponse.json({
      ok: true,
      id,
      slug: existing.slug,
      deletedTemplates: existing._count.templates,
    });
  } catch (error) {
    return handleApiError(error, "Failed to delete AI template category");
  }
}
