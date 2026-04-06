import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleNotFound } from "@/lib/api/errors";
import { getBackgroundCategoryOptions } from "@/lib/backgrounds/categorySettings";
import { getBackgroundCategorySettings } from "@/lib/backgrounds/categorySettings.server";
import { listAllImportedBackgroundAssets } from "@/lib/editor/importedBackgrounds.server";
import { logger } from "@/lib/logging/logger";
import { resolveMobileLocale } from "@/lib/mobile/locale";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { searchParams } = new URL(request.url);
    const locale = resolveMobileLocale(request, searchParams);
    const source = searchParams.get("source") || "all";
    const params = await context.params;
    const rawId = String(params?.id || "").trim().toLowerCase();

    const settings = await getBackgroundCategorySettings();
    const categories = getBackgroundCategoryOptions(settings, locale).filter(
      (item) => item.published !== false
    );
    const category = categories.find((item) => String(item.id || "").trim().toLowerCase() === rawId) || null;

    if (!category) {
      return handleNotFound("Background category");
    }

    logger.info("Mobile background images requested", {
      locale,
      source,
      categoryId: category.id,
      categoryValue: category.value,
    });

    const result = await listAllImportedBackgroundAssets({
      source,
      categoryValue: category.value,
      locale,
    });

    const images = result.items
      .map((item) => ({
        previewUrl: String(item.thumbnailUrl || item.assetUrl || "").trim(),
        url: String(item.assetUrl || item.thumbnailUrl || "").trim(),
      }))
      .filter((item) => item.url && item.previewUrl);

    return NextResponse.json(
      images,
      {
        headers: {
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  } catch (error) {
    return handleApiError(error, "Failed to fetch mobile background images");
  }
}
