import { NextRequest, NextResponse } from "next/server";

import { buildMobileTemplatesListResponse } from "@/lib/mobile/templateList";
import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:templates:search",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  return buildMobileTemplatesListResponse(request, {
    routeName: "Searched mobile templates",
    searchMode: "queryOnly",
  });
}
