import { NextResponse } from "next/server";
import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { MOBILE_PUBLIC_JSON_CACHE_CATALOG } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { localizeCategoryOptions, prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import { getActiveOccasionBoost } from "@/lib/occasions/boost.server";
import { applyOccasionCategoryOrder } from "@/lib/occasions/hoist";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

export async function GET(request) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:taxonomy",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const locale = resolveMobileLocale(request, searchParams);
  const settings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(settings);
  // Seasonal boost: categories linked to an active occasion lead the list (the app opens
  // on the first one). Applied to the localized output only — never to the taxonomy
  // object, whose index 0 is a fallback shared with the dashboard.
  const categories = applyOccasionCategoryOrder(
    localizeCategoryOptions(taxonomy, locale),
    await getActiveOccasionBoost()
  );

  return NextResponse.json({
    locale,
    categories,
  }, {
    headers: {
      "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_CATALOG,
    },
  });
}
