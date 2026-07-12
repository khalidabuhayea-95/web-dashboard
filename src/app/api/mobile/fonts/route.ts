import { NextRequest, NextResponse } from "next/server";

import {
  buildMobileFontCatalog,
  normalizeMobileFontCategory,
} from "@/lib/mobile/fontsCatalog.server";
import { getFontCatalogVersion } from "@/lib/fonts/fontCatalogVersion.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { handleApiError } from "@/lib/api/errors";
import { MOBILE_PUBLIC_JSON_CACHE_CATALOG } from "@/lib/mobile/cacheControl";

export const runtime = "nodejs";
const logger = createLogger("api.mobile.fonts");

function parsePositiveInt(value: unknown, fallback = 1): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function normalizeLanguage(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ar" || normalized === "arabic") return "ARABIC";
  if (normalized === "en" || normalized === "english") return "ENGLISH";
  return "";
}

export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger;

  try {
    const { searchParams } = new URL(request.url);
    const search = String(searchParams.get("search") || searchParams.get("query") || "")
      .trim()
      .toLowerCase();
    const category = normalizeMobileFontCategory(searchParams.get("category"));
    const language = normalizeLanguage(
      searchParams.get("language") || searchParams.get("lang")
    );
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSizeParam =
      searchParams.get("pageSize") ||
      searchParams.get("page_size") ||
      searchParams.get("limit");

    const allFonts = await buildMobileFontCatalog(request);
    const fonts = allFonts.filter((font: any) => {
      if (category && !font.categories.includes(category)) {
        return false;
      }
      if (language && !font.categories.includes(language)) {
        return false;
      }
      if (!search) return true;

      const haystack = [
        font.fontName,
        font.displayName,
        font.previewText,
        font.source,
        ...(Array.isArray(font.categories) ? font.categories : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });

    const total = fonts.length;
    // Default: return the whole catalog in one shot (the mobile app caches it
    // locally, keyed by `version`, and only re-fetches when the version changes).
    // An explicit pageSize still enables backward-compatible pagination.
    const pageSize = pageSizeParam ? parsePositiveInt(pageSizeParam, total) : Math.max(total, 1);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const paginatedFonts = fonts.slice(start, start + pageSize);
    const version = await getFontCatalogVersion();

    requestLogger.info("Mobile fonts retrieved", {
      search,
      category,
      language,
      page: safePage,
      pageSize,
      total,
      version,
      count: paginatedFonts.length,
    });

    const response = NextResponse.json(
      {
        version,
        fonts: paginatedFonts,
        page: safePage,
        pageSize,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
      {
        headers: {
          "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_CATALOG,
        },
      }
    );
    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    requestLogger.error("Failed to fetch mobile fonts", error);
    return attachRequestIdHeader(
      handleApiError(error, "Failed to fetch fonts"),
      requestId
    );
  }
}
