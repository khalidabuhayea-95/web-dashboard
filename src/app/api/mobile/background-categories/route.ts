import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { getBackgroundCategoryOptions } from "@/lib/backgrounds/categorySettings";
import { getBackgroundCategorySettings } from "@/lib/backgrounds/categorySettings.server";
import { countImportedBackgroundAssetsByCategory } from "@/lib/editor/importedBackgrounds.server";
import { logger } from "@/lib/logging/logger";
import { resolveMobileLocale } from "@/lib/mobile/locale";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const locale = resolveMobileLocale(request, searchParams);
    const source = searchParams.get("source") || "all";

    logger.info("Mobile background categories requested", {
      locale,
      source,
    });

    const [settings, counts] = await Promise.all([
      getBackgroundCategorySettings(),
      countImportedBackgroundAssetsByCategory({ source }),
    ]);
    const categories = getBackgroundCategoryOptions(settings, locale)
      .filter((item) => item.published !== false)
      .map((item) => ({
        id: item.id,
        value: item.value,
        label: item.label,
        thumbnailUrl: String(item.thumbnailUrl || "").trim(),
        published: item.published !== false,
        backgroundCount: Number(counts[item.value] || 0),
      }));

    return NextResponse.json(
      {
        locale,
        categories,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
        },
      }
    );
  } catch (error) {
    return handleApiError(error, "Failed to fetch mobile background categories");
  }
}
