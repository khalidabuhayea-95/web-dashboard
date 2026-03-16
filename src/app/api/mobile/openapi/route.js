import { NextResponse } from "next/server";

import { buildMobileOpenApiSpec } from "@/lib/mobile/openapi";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const serverOrigin = request?.nextUrl?.origin || new URL(request.url).origin;
  const spec = buildMobileOpenApiSpec(serverOrigin);

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
