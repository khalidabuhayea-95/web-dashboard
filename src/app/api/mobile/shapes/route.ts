import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { BUILTIN_SHAPE_ASSETS } from "@/lib/editor/builtinShapes";
import { logger } from "@/lib/logging/logger";
import { MOBILE_PUBLIC_JSON_CACHE_SHORT } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { listMobileBuiltInShapes } from "@/lib/mobile/shapesCatalog.server";

export const runtime = "nodejs";

function parsePositiveInt(value: unknown, fallback: number, max = 100): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const locale = resolveMobileLocale(request, searchParams);
    const page = parsePositiveInt(searchParams.get("page"), 1, 10_000);
    const pageSize = parsePositiveInt(
      searchParams.get("pageSize") ||
        searchParams.get("page_size") ||
        searchParams.get("per_page") ||
        searchParams.get("limit"),
      100,
      100
    );
    const query =
      searchParams.get("query") ||
      searchParams.get("search") ||
      searchParams.get("q") ||
      "";

    logger.info("Mobile shapes requested", {
      locale,
      page,
      pageSize,
      query,
      totalCatalogSize: BUILTIN_SHAPE_ASSETS.length,
    });

    const result = await listMobileBuiltInShapes({
      request,
      locale,
      query,
      page,
      pageSize,
    });

    return NextResponse.json(
      {
        locale: result.locale,
        shapes: result.items,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
      {
        headers: {
          "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_SHORT,
        },
      }
    );
  } catch (error) {
    return handleApiError(error, "Failed to fetch mobile shapes");
  }
}
