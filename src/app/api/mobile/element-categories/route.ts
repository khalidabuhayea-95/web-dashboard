import { NextRequest, NextResponse } from "next/server";

import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { handleApiError } from "@/lib/api/errors";
import { getElementCategoryOptions } from "@/lib/elements/categorySettings";
import { getElementCategorySettings } from "@/lib/elements/categorySettings.server";
import { countImportedElementAssetsByCategory } from "@/lib/editor/importedElements.server";
import { logger } from "@/lib/logging/logger";
import { MOBILE_PUBLIC_JSON_CACHE_CATALOG } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { getActiveOccasionBoost } from "@/lib/occasions/boost.server";
import { hoistToFront } from "@/lib/occasions/hoist";
import { createMobilePublicMediaUrlResolver } from "@/lib/mobile/templateAssets";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:element-categories",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const locale = resolveMobileLocale(request, searchParams);
    const source = searchParams.get("source") || "all";

    logger.info("Mobile element categories requested", {
      locale,
      source,
    });

    const [settings, counts] = (await Promise.all([
      getElementCategorySettings(),
      countImportedElementAssetsByCategory({ source }),
    ])) as [any, Record<string, number>];
    const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
    const categories = getElementCategoryOptions(settings, locale)
      .filter((item) => item.published !== false)
      .map((item) => ({
        id: item.id,
        value: item.value,
        label: item.label,
        thumbnailUrl: mediaUrlResolver(item.thumbnailUrl),
        published: item.published !== false,
        elementCount: Number(counts[item.value] || 0),
      }));
    // Seasonal boost: categories linked to an active occasion lead the strip.
    const boost = await getActiveOccasionBoost();
    const orderedCategories = hoistToFront(categories, boost.hoistedElementCategoryKeys, (item) => item.value);

    return NextResponse.json(
      {
        locale,
        categories: orderedCategories,
      },
      {
        headers: {
          "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_CATALOG,
        },
      }
    );
  } catch (error) {
    return handleApiError(error, "Failed to fetch mobile element categories");
  }
}
