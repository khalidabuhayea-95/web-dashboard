import { NextResponse } from "next/server";

import { resolveMobileLocale } from "@/lib/mobile/locale";
import { listImportedElementAssets } from "@/lib/editor/importedElements.server";

export const runtime = "nodejs";

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request) {
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

  try {
    const result = await listImportedElementAssets({
      source: searchParams.get("source") || "all",
      kind: searchParams.get("kind") || "all",
      query,
      page,
      pageSize,
      locale,
    });

    const elements = result.items.map((item) => ({
      id: item.id,
      source: item.source,
      sourceAssetId: item.sourceAssetId,
      kind: item.kind,
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
      assetUrl: item.assetUrl,
      thumbnailUrl: item.thumbnailUrl,
      width: item.width,
      height: item.height,
      freeSvg: item.freeSvg,
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
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error?.message || "Failed to fetch mobile elements.",
      },
      { status: 500 }
    );
  }
}
