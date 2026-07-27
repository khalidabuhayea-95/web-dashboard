import { NextRequest, NextResponse } from "next/server";

import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { handleApiError } from "@/lib/api/errors";
import { getBackgroundCategoryOptions } from "@/lib/backgrounds/categorySettings";
import { getBackgroundCategorySettings } from "@/lib/backgrounds/categorySettings.server";
import { countImportedBackgroundAssetsByCategory } from "@/lib/editor/importedBackgrounds.server";
import { logger } from "@/lib/logging/logger";
import { MOBILE_PUBLIC_JSON_CACHE_CATALOG } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { createMobilePublicMediaUrlResolver } from "@/lib/mobile/templateAssets";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:background-categories",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

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
    const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
    const categories = getBackgroundCategoryOptions(settings, locale)
      .filter((item) => item.published !== false)
      .map((item) => ({
        id: item.id,
        value: item.value,
        label: item.label,
        thumbnailUrl: mediaUrlResolver(item.thumbnailUrl),
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
          "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_CATALOG,
        },
      }
    );
  } catch (error) {
    return handleApiError(error, "Failed to fetch mobile background categories");
  }
}
