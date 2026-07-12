import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { logger } from "@/lib/logging/logger";
import { generateFontFamilyPreviews } from "@/lib/fonts/fontPreview.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IDS_PER_REQUEST = 20;
const RATE_LIMIT = { limit: 400, windowMs: 60_000 };

async function requireAdmin() {
  const session = await getEditorSession();
  if (session.error) return { error: session.error };
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

function rateLimit(request: NextRequest, userId: string, scope: string) {
  const state = checkRateLimit({
    scope: `api:admin:fonts:preview:${scope}`,
    identifier: userId || resolveRequestIp(request),
    limit: RATE_LIMIT.limit,
    windowMs: RATE_LIMIT.windowMs,
  });
  if (!state.allowed) {
    return createRateLimitResponse("Too many preview requests. Please retry shortly.", state);
  }
  return null;
}

// GET: return the font ids that need previews (missingOnly=1, default) or all ids.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const limited = rateLimit(request, guard.session.userId, "list");
    if (limited) return limited;

    const url = new URL(request.url);
    const missingOnly = url.searchParams.get("missingOnly") !== "0";

    const rows = await prisma.fontFamily.findMany({
      where: {
        files: { some: {} },
        ...(missingOnly
          ? { OR: [{ previewImageUrl: null }, { previewImageDarkUrl: null }] }
          : {}),
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });

    const ids = rows.map((r) => r.id);
    return NextResponse.json({ ids, total: ids.length, missingOnly });
  } catch (error) {
    return handleApiError(error, "Failed to list fonts for preview generation");
  }
}

// POST: generate previews for a batch of font ids. Body: { ids: string[], force?: boolean }
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const limited = rateLimit(request, guard.session.userId, "generate");
    if (limited) return limited;

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const rawIds = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : [];
    const ids = Array.from(
      new Set(rawIds.map((v: unknown) => String(v || "").trim()).filter(Boolean))
    );
    if (ids.length === 0) return handleBadRequest("Provide one or more font ids.");
    if (ids.length > MAX_IDS_PER_REQUEST) {
      return handleBadRequest(`Too many ids; max ${MAX_IDS_PER_REQUEST} per request.`);
    }

    const force = Boolean(body?.force);
    const results = await generateFontFamilyPreviews(ids, { force });
    const generated = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    logger.info("Admin generated font previews", {
      userId: guard.session.userId,
      requested: ids.length,
      generated,
      failed: failed.length,
      force,
    });

    return NextResponse.json({
      ok: true,
      generated,
      failedCount: failed.length,
      results,
    });
  } catch (error) {
    return handleApiError(error, error instanceof Error ? error.message : "Failed to generate previews", 500);
  }
}
