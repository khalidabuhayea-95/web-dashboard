import { NextResponse } from "next/server";
import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import { handleApiError } from "@/lib/api/errors";
import { attachRequestIdHeader, resolveRequestId } from "@/lib/logging/request";
import { MOBILE_PUBLIC_JSON_CACHE_SHORT } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { localizeCategoryOptions, prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import { getTemplateCountsByPlacement, withTemplateCounts } from "@/lib/mobile/taxonomyCounts.server";
import { resolveTemplateAudience } from "@/lib/mobile/templateAudience.server";
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

  const requestId = resolveRequestId(request);
  try {
    const { searchParams } = new URL(request.url);
    const locale = resolveMobileLocale(request, searchParams);
    // Counts follow the caller's audience (a tester also sees drafts), exactly like the lists.
    const audience = await resolveTemplateAudience(request);
    const settings = await getTemplateTaxonomySettings();
    const taxonomy = prepareMobileTaxonomy(settings);
    const counts = await getTemplateCountsByPlacement(taxonomy, audience.statuses);
    // Seasonal boost: categories linked to an active occasion lead the list (the app opens
    // on the first one). Applied to the localized output only — never to the taxonomy
    // object, whose index 0 is a fallback shared with the dashboard.
    const categories = applyOccasionCategoryOrder(
      withTemplateCounts(localizeCategoryOptions(taxonomy, locale), counts),
      await getActiveOccasionBoost()
    );

    return attachRequestIdHeader(
      NextResponse.json(
        {
          locale,
          categories,
        },
        {
          // The same 5-minute horizon as the template lists: `templateCount` moves whenever a
          // template is published, so the old 10-minute + 30-minute stale window would keep a
          // newly filled category looking empty for up to 40 minutes. Private + uncached for a
          // tester, whose counts include drafts (audience.headers adds Vary: Authorization).
          headers: audience.headers(MOBILE_PUBLIC_JSON_CACHE_SHORT),
        }
      ),
      requestId
    );
  } catch (error) {
    // ★Never a fabricated taxonomy (production audit H-24): an outage is 503 + no-store, so no
    // client or shared cache can keep a placeholder taxonomy after the database comes back.
    return attachRequestIdHeader(
      handleApiError(error, "Failed to load the template taxonomy"),
      requestId
    );
  }
}
