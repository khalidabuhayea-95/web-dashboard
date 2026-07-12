import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { logger } from "@/lib/logging/logger";
import { listFontFamilies, toEditorFontRecord, deleteFontFamily } from "@/lib/editor/fontStorage.server";
import { upsertEditorCustomFont } from "@/lib/editor/customFonts.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ADMIN_FONTS_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

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
    scope: `api:admin:fonts:${scope}`,
    identifier: userId || resolveRequestIp(request),
    limit: ADMIN_FONTS_RATE_LIMIT.limit,
    windowMs: ADMIN_FONTS_RATE_LIMIT.windowMs,
  });
  if (!state.allowed) {
    return createRateLimitResponse("Too many font requests. Please retry shortly.", state);
  }
  return null;
}

function slimFont(record: any) {
  const categories = Array.isArray(record?.categories) ? record.categories : [];
  return {
    id: record.id,
    family: record.family,
    displayName: record.displayName,
    source: record.source,
    categories,
    languages: {
      english: categories.includes("ENGLISH"),
      arabic: categories.includes("ARABIC"),
    },
    mobileCompatible: Boolean(record.mobileCompatible),
    fileUrl: record.fileUrl,
    previewImageUrl: record.previewImageUrl || null,
    previewImageDarkUrl: record.previewImageDarkUrl || null,
    previewImageUpdatedAt: record.previewImageUpdatedAt || null,
    removable: record.removable !== false,
    updatedAt: record.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const limited = rateLimit(request, guard.session.userId, "list");
    if (limited) return limited;

    const url = new URL(request.url);
    const search = String(url.searchParams.get("search") || "").trim();
    const language = String(url.searchParams.get("language") || "all").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get("perPage") || 50) || 50));

    const families = await listFontFamilies({ search, take: 5000 });
    const all = families.map(toEditorFontRecord).filter(Boolean).map(slimFont);

    const counts = {
      total: all.length,
      english: all.filter((f) => f.languages.english).length,
      arabic: all.filter((f) => f.languages.arabic).length,
      google: all.filter((f) => f.source === "google").length,
      custom: all.filter((f) => f.source === "custom").length,
    };

    const filtered =
      language === "english"
        ? all.filter((f) => f.languages.english)
        : language === "arabic"
          ? all.filter((f) => f.languages.arabic)
          : all;

    const total = filtered.length;
    const startIndex = (page - 1) * perPage;
    const fonts = filtered.slice(startIndex, startIndex + perPage);

    return NextResponse.json({ fonts, counts, total, page, perPage });
  } catch (error) {
    return handleApiError(error, "Failed to list fonts");
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const limited = rateLimit(request, guard.session.userId, "upload");
    if (limited) return limited;

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const result = await upsertEditorCustomFont({
      family: body?.family,
      fileName: body?.fileName,
      dataUrl: body?.dataUrl,
      fileUrl: body?.fileUrl,
      mimeType: body?.mimeType,
      categories: body?.categories,
      source: "custom",
      includeFontList: false,
    });

    const skipped = Boolean(result?.skippedDuplicate);
    logger.info(skipped ? "Admin font upload skipped (duplicate)" : "Admin uploaded font", {
      userId: guard.session.userId,
      family: body?.family,
    });
    return NextResponse.json(
      { ok: true, skipped, font: result.font, conversionStatus: result.conversionStatus },
      { status: skipped ? 200 : 201 }
    );
  } catch (error) {
    return handleApiError(error, error instanceof Error ? error.message : "Failed to upload font", 422);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const limited = rateLimit(request, guard.session.userId, "delete");
    if (limited) return limited;

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const id = String(body?.id || "").trim();
    const family = String(body?.family || "").trim();
    const source = String(body?.source || "").trim() || "custom";
    if (!id && !family) return handleBadRequest("Missing font id or family.");

    // deleteFontFamily filters by source, so pass the font's actual source.
    const result = await deleteFontFamily({ id, family, source });
    logger.info("Admin deleted font", { userId: guard.session.userId, id, source, deleted: result.deleted });
    return NextResponse.json({ ok: true, deleted: result.deleted });
  } catch (error) {
    return handleApiError(error, error instanceof Error ? error.message : "Failed to delete font", 422);
  }
}
