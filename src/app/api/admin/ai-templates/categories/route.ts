import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  MAX_AI_TEMPLATE_TITLE_LENGTH,
  slugifyAiTemplateTitle,
} from "@/lib/aiTemplates/constants";

export const runtime = "nodejs";

// Creates a category. Like hand-added templates, a category added here is
// removed by the next `npm run seed:ai-templates` unless it is also added to
// scripts/ai-templates/presets.mjs (or the seed is run with --keep-extra).
export async function POST(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can create AI template categories");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const titleEn = String(body.titleEn || "").trim();
    const titleAr = String(body.titleAr || "").trim();
    if (!titleEn) return handleBadRequest("English title cannot be empty");
    if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
    if (titleEn.length > MAX_AI_TEMPLATE_TITLE_LENGTH) return handleBadRequest("English title is too long");
    if (titleAr.length > MAX_AI_TEMPLATE_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");

    const base = slugifyAiTemplateTitle(titleEn) || "category";
    let slug = base;
    for (let attempt = 2; await prisma.aiTemplateCategory.findUnique({ where: { slug } }); attempt += 1) {
      slug = `${base}-${attempt}`;
    }

    const last = await prisma.aiTemplateCategory.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const category = await prisma.aiTemplateCategory.create({
      data: {
        slug,
        titleEn,
        titleAr,
        isNew: Boolean(body.isNew),
        published: body.published === undefined ? true : Boolean(body.published),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    logger.info("AI template category created", { userId: session.userId, slug });
    return NextResponse.json({ ok: true, category: { ...category, templates: [] } }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to create AI template category");
  }
}
