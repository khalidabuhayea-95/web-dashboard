import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  DEFAULT_MAGIC_TOOL_CREDIT_COST,
  MAX_MAGIC_TOOL_PROMPT_LENGTH,
  MAX_MAGIC_TOOL_SUBTITLE_LENGTH,
  MAX_MAGIC_TOOL_TITLE_LENGTH,
  slugifyMagicToolTitle,
} from "@/lib/magicTools/constants";
import {
  DEFAULT_MAGIC_TOOL_MODEL_ID,
  magicToolModelIncompatibility,
  normalizeMagicToolModelId,
} from "@/lib/magicTools/models";

export const runtime = "nodejs";

// Full catalog for the dashboard, prompts included. Prompts are the product
// asset: this route is admin-only and must never be mirrored into /api/mobile.
export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can view magic tools");
    }

    const tools = await prisma.magicTool.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ ok: true, tools });
  } catch (error) {
    return handleApiError(error, "Failed to load magic tools");
  }
}

// Creates a tool by hand, alongside the ones the seed library bootstraps. Note
// the seed prunes anything it does not define, so a tool added here is removed
// by the next `npm run seed:magic-tools` unless it is also added to
// scripts/magic-tools/presets.mjs (or the seed is run with --keep-extra).
export async function POST(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can create magic tools");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const titleEn = String(body.titleEn || "").trim();
    const titleAr = String(body.titleAr || "").trim();
    const subtitleAr = String(body.subtitleAr || "").trim();
    const prompt = String(body.prompt || "").trim();
    if (!titleEn) return handleBadRequest("English title cannot be empty");
    if (!titleAr) return handleBadRequest("Arabic title cannot be empty");
    if (titleEn.length > MAX_MAGIC_TOOL_TITLE_LENGTH) return handleBadRequest("English title is too long");
    if (titleAr.length > MAX_MAGIC_TOOL_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");
    if (subtitleAr.length > MAX_MAGIC_TOOL_SUBTITLE_LENGTH) {
      return handleBadRequest("Arabic subtitle is too long");
    }
    if (prompt.length > MAX_MAGIC_TOOL_PROMPT_LENGTH) {
      return handleBadRequest(`Prompt must be at most ${MAX_MAGIC_TOOL_PROMPT_LENGTH} characters`);
    }

    const model = normalizeMagicToolModelId(body.model) || DEFAULT_MAGIC_TOOL_MODEL_ID;
    const incompatibility = magicToolModelIncompatibility(model, prompt);
    if (incompatibility) return handleBadRequest(incompatibility);

    let creditCost = DEFAULT_MAGIC_TOOL_CREDIT_COST;
    if (body.creditCost !== undefined) {
      creditCost = Number(body.creditCost);
      if (!Number.isInteger(creditCost) || creditCost < 0 || creditCost > 10000) {
        return handleBadRequest("Credit cost must be an integer between 0 and 10000");
      }
    }

    const base = slugifyMagicToolTitle(titleEn) || "magic-tool";
    let slug = base;
    for (let attempt = 2; await prisma.magicTool.findUnique({ where: { slug } }); attempt += 1) {
      slug = `${base}-${attempt}`;
    }

    const last = await prisma.magicTool.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const tool = await prisma.magicTool.create({
      data: {
        slug,
        titleEn,
        titleAr,
        subtitleAr,
        prompt,
        model,
        modelOptions: body.modelOptions ?? undefined,
        creditCost,
        isPremium: Boolean(body.isPremium),
        published: body.published === undefined ? true : Boolean(body.published),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    logger.info("Magic tool created", { userId: session.userId, slug });
    return NextResponse.json({ ok: true, tool }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to create magic tool");
  }
}
