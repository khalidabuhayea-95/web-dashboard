import { NextResponse } from "next/server";
import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { MOBILE_PUBLIC_JSON_CACHE_CATALOG } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { localizeCategoryOptions, prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
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
  const categories = localizeCategoryOptions(taxonomy, locale);

  return NextResponse.json({
    locale,
    categories,
  }, {
    headers: {
      "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_CATALOG,
    },
  });
}
