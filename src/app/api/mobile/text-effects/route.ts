import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import prisma from "@/lib/prisma";
import { normalizeTextEffectSpec } from "@/lib/textEffects/spec";

export const runtime = "nodejs";

const logger = createLogger("api.mobile.text-effects");

// Material styles the app applies to a TEXT layer. Unlike the AI catalogues
// this carries no secret: `spec` IS the product and the client needs it to
// draw. Nothing here costs a credit or calls a provider.
//
// Public (no bearer token): effects are part of the editor's chrome, and the
// editor is usable before sign-in.
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    const rows = await prisma.textEffect.findMany({
      where: { published: true },
      orderBy: { sortOrder: "asc" },
      select: {
        slug: true,
        titleEn: true,
        titleAr: true,
        spec: true,
        previewUrl: true,
        isPremium: true,
      },
    });

    // Normalised on the way out too: a row written before a spec field existed
    // still reaches the app with every field filled, so old and new builds
    // never have to null-check.
    const effects = rows.map((row: any) => ({
      id: row.slug,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      isPremium: row.isPremium,
      previewUrl: row.previewUrl || null,
      spec: normalizeTextEffectSpec(row.spec),
    }));

    return attachRequestIdHeader(
      NextResponse.json(
        { effects },
        { status: 200, headers: { "Cache-Control": "public, max-age=300" } }
      ),
      requestId
    );
  } catch (error) {
    requestLogger.error("Text effects list failed", error);
    return attachRequestIdHeader(
      NextResponse.json(
        { error: "Failed to load the text effects." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      ),
      requestId
    );
  }
}
