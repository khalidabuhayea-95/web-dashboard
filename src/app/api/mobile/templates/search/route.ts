import { NextRequest, NextResponse } from "next/server";

import { buildMobileTemplatesListResponse } from "@/lib/mobile/templateList";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return buildMobileTemplatesListResponse(request, {
    routeName: "Searched mobile templates",
    searchMode: "queryOnly",
  });
}
