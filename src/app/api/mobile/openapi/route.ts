import { NextRequest, NextResponse } from "next/server";

import { buildMobileOpenApiSpec, toVersionedOpenApiSpec } from "@/lib/mobile/openapi";
import { logger } from "@/lib/logging/logger";
import { API_VERSION_HEADER, readSurfaceConfig } from "@/lib/surfaces";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // The Host the client used (api.nayroz.com, api.localhost:3000…); nextUrl.origin can be the
    // server's own bind address in development.
    const host = request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(/:$/, "");
    const serverOrigin = host ? `${proto}://${host}` : request.nextUrl.origin;
    // Set by src/proxy.js when the request came in as /v1/mobile/openapi.
    const apiVersion = request.headers.get(API_VERSION_HEADER) || "";

    logger.info("Mobile OpenAPI spec requested", {
      origin: serverOrigin,
      apiVersion: apiVersion || "unversioned",
    });

    const base = buildMobileOpenApiSpec(serverOrigin);
    const spec = apiVersion
      ? toVersionedOpenApiSpec(base, apiVersion, serverOrigin, readSurfaceConfig().origins.api)
      : base;

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
