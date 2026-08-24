import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  DEFAULT_AI_TEMPLATE_CREDIT_COST,
  DEFAULT_AI_TEMPLATE_REFERENCE_KIND,
  MAX_AI_TEMPLATE_PROMPT_LENGTH,
  MAX_AI_TEMPLATE_TITLE_LENGTH,
  normalizeAiTemplateReferenceKind,
  slugifyAiTemplateTitle,
} from "@/lib/aiTemplates/constants";
import {
  DEFAULT_AI_TEMPLATE_MODEL_ID,
  aiTemplateModelIncompatibility,
  normalizeAiTemplateModelId,
} from "@/lib/aiTemplates/models";

export const runtime = "nodejs";

// Full catalog for the dashboard, prompts included. Prompts are the product
// asset: this route is admin-only and must never be mirrored into /api/mobile.
export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can view AI templates");
    }

    const categories = await prisma.aiTemplateCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        templates: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    return handleApiError(error, "Failed to load AI templates");
  }
}

// Creates a template by hand, alongside the ones the seed library bootstraps.
// Note the seed prunes anything it does not define, so a template added here is
// removed by the next `npm run seed:ai-templates` unless it is also added to
// scripts/ai-templates/presets.mjs (or the seed is run with --keep-extra).
export async function POST(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can create AI templates");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return handleBadRequest("Pick a category");
    const category = await prisma.aiTemplateCategory.findUnique({ where: { id: categoryId } });
    if (!category) return handleBadRequest("That category no longer exists");

    const titleEn = String(body.titleEn || "").trim();
    const titleAr = String(body.titleAr || "").trim();
    const prompt = String(body.prompt || "").trim();
    if (!titleEn) return handleBadRequest("English title cannot be empty");
    if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
    if (!prompt) return handleBadRequest("Prompt cannot be empty");
    if (titleEn.length > MAX_AI_TEMPLATE_TITLE_LENGTH) return handleBadRequest("English title is too long");
    if (titleAr.length > MAX_AI_TEMPLATE_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");
    if (prompt.length > MAX_AI_TEMPLATE_PROMPT_LENGTH) {
      return handleBadRequest(`Prompt must be at most ${MAX_AI_TEMPLATE_PROMPT_LENGTH} characters`);
    }

    const referenceKind =
      normalizeAiTemplateReferenceKind(body.referenceKind) || DEFAULT_AI_TEMPLATE_REFERENCE_KIND;
    const model = normalizeAiTemplateModelId(body.model) || DEFAULT_AI_TEMPLATE_MODEL_ID;
    const incompatibility = aiTemplateModelIncompatibility(model, referenceKind);
    if (incompatibility) return handleBadRequest(incompatibility);

    let creditCost = DEFAULT_AI_TEMPLATE_CREDIT_COST;
    if (body.creditCost !== undefined) {
      creditCost = Number(body.creditCost);
      if (!Number.isInteger(creditCost) || creditCost < 0 || creditCost > 10000) {
        return handleBadRequest("Credit cost must be an integer between 0 and 10000");
      }
    }

    // Slugs follow the seed library's "<category>-<title>" shape; a numeric
    // suffix keeps a repeated title from colliding.
    const base =
      `${category.slug}-${slugifyAiTemplateTitle(titleEn)}`.replace(/-+$/, "") || `${category.slug}-template`;
    let slug = base;
    for (let attempt = 2; await prisma.aiTemplate.findUnique({ where: { slug } }); attempt += 1) {
      slug = `${base}-${attempt}`;
    }

    const last = await prisma.aiTemplate.findFirst({
      where: { categoryId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const template = await prisma.aiTemplate.create({
      data: {
        slug,
        categoryId,
        titleEn,
        titleAr,
        prompt,
        model,
        referenceKind,
        creditCost,
        isPremium: Boolean(body.isPremium),
        published: body.published === undefined ? true : Boolean(body.published),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    logger.info("AI template created", { userId: session.userId, slug });
    return NextResponse.json({ ok: true, template }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to create AI template");
  }
}
