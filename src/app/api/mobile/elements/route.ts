import { NextRequest, NextResponse } from "next/server";

import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { handleApiError } from "@/lib/api/errors";
import { listImportedElementAssets } from "@/lib/editor/importedElements.server";
import { logger } from "@/lib/logging/logger";
import { MOBILE_PUBLIC_JSON_CACHE_SHORT } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { createMobilePublicMediaUrlResolver } from "@/lib/mobile/templateAssets";

export const runtime = "nodejs";

function parsePositiveInt(value: unknown, fallback: number, max = 100): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:elements",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

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

    logger.info("Mobile elements requested", {
      locale,
      page,
      pageSize,
      query,
    });

    const result = await listImportedElementAssets({
      source: searchParams.get("source") || "all",
      kind: searchParams.get("kind") || "all",
      query,
      page,
      pageSize,
      locale,
    });

    const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
    const elements = result.items.map((item: any) => ({
      id: item.id,
      source: item.source,
      sourceAssetId: item.sourceAssetId,
      kind: item.kind,
      category: item.categoryValue,
      name: item.title,
      nameEn: item.titleEn,
      nameAr: item.titleAr,
      tags: item.tags,
      tagsEn: item.tagsEn,
      tagsAr: item.tagsAr,
      labels: item.labels,
      labelsEn: item.labelsEn,
      labelsAr: item.labelsAr,
      slug: item.slug,
      assetUrl: mediaUrlResolver(item.assetUrl),
      thumbnailUrl: mediaUrlResolver(item.thumbnailUrl),
      width: item.width,
      height: item.height,
      freeSvg: item.freeSvg,
      // Pro-only element. The catalog stays public and complete — the app badges
      // this and walls when the element is added to a design.
      isPremium: item.isPremium,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return NextResponse.json(
      {
        locale,
        elements,
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
    return handleApiError(error, "Failed to fetch mobile elements");
  }
}
