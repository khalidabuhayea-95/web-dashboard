import { NextRequest, NextResponse } from "next/server";

import { buildMobileOpenApiSpec } from "@/lib/mobile/openapi";
import { logger } from "@/lib/logging/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const serverOrigin = request?.nextUrl?.origin || new URL(request.url).origin;

    logger.info("Mobile OpenAPI spec requested", {
      origin: serverOrigin,
    });

    const spec = buildMobileOpenApiSpec(serverOrigin);

    return NextResponse.json(spec, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Failed to generate OpenAPI spec", error);
    return NextResponse.json(
      { error: "Failed to generate OpenAPI specification" },
      { status: 500 }
    );
  }
}
