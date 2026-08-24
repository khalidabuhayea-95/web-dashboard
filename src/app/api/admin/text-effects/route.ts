import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  MAX_TEXT_EFFECT_TITLE_LENGTH,
  normalizeTextEffectSpec,
} from "@/lib/textEffects/spec";

export const runtime = "nodejs";

function slugify(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can view text effects");
    }
    const effects = await prisma.textEffect.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ ok: true, effects });
  } catch (error) {
    return handleApiError(error, "Failed to load text effects");
  }
}

export async function POST(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can create text effects");
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
    if (titleEn.length > MAX_TEXT_EFFECT_TITLE_LENGTH) return handleBadRequest("English title is too long");
    if (titleAr.length > MAX_TEXT_EFFECT_TITLE_LENGTH) return handleBadRequest("Arabic title is too long");

    // Normalising on the way in means the database only ever holds specs both
    // platforms can render — a malformed one can't reach the app.
    const spec = normalizeTextEffectSpec(body.spec);

    const base = slugify(titleEn) || "effect";
    let slug = base;
    for (let attempt = 2; await prisma.textEffect.findUnique({ where: { slug } }); attempt += 1) {
      slug = `${base}-${attempt}`;
    }

    const last = await prisma.textEffect.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const effect = await prisma.textEffect.create({
      data: {
        slug,
        titleEn,
        titleAr,
        spec,
        isPremium: Boolean(body.isPremium),
        published: body.published === undefined ? true : Boolean(body.published),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    logger.info("Text effect created", { userId: session.userId, slug });
    return NextResponse.json({ ok: true, effect }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to create text effect");
  }
}
