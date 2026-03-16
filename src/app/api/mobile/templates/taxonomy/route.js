import { NextResponse } from "next/server";

import { resolveMobileLocale } from "@/lib/mobile/locale";
import { localizeCategoryOptions, prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

export async function GET(request) {
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
      "Cache-Control": "public, max-age=300",
    },
  });
}
