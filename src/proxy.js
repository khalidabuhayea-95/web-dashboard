import fs from "node:fs";
import path from "node:path";

import {
  attachRequestIdHeader,
  ensureRequestIdHeaders,
} from "@/lib/logging/request";
import { logger } from "@/lib/logging/logger";
import {
  checkMobileRequestSignature,
  invalidRequestSignatureResponse,
} from "@/lib/mobile/requestSigning.server";
import { API_VERSION_HEADER, WEBSITE_PUBLIC_DIR, routeRequest } from "@/lib/surfaces";
import { NextResponse } from "next/server";

const STATIC_ASSET = /\.(?:svg|png|jpe?g|gif|webp|ico|css|js|woff2?|txt|xml|json)$/i;

let websiteFilesCache = null;

/** Top-level entries of public/website, read once per process (the site is static). */
function websiteFiles() {
  if (websiteFilesCache) return websiteFilesCache;
  try {
    websiteFilesCache = new Set(fs.readdirSync(path.join(process.cwd(), "public", WEBSITE_PUBLIC_DIR)));
  } catch (error) {
    logger.error("Could not list public/website; website paths will 404", error);
    websiteFilesCache = new Set();
  }
  return websiteFilesCache;
}

function securityHeaders(response, requestId) {
  response.headers.set("X-Request-ID", requestId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return attachRequestIdHeader(response, requestId);
}

/**
 * Global proxy: request tracing, security headers, mobile request signatures, and the
 * website / dashboard / api split by hostname (decided in src/lib/surfaces.js).
 */
export async function proxy(request) {
  const { requestId, requestHeaders } = ensureRequestIdHeaders(request.headers);
  const { pathname } = request.nextUrl;

  if (!STATIC_ASSET.test(pathname)) {
    logger.info("API Request", {
      requestId,
      method: request.method,
      host: request.headers.get("host") || "",
      path: pathname,
      ip: request.ip || "unknown",
    });
  }

  try {
    const route = routeRequest({
      url: request.url,
      host: request.headers.get("host") || request.nextUrl.host,
      websiteFiles: websiteFiles(),
    });

    if (route.type === "redirect") {
      return securityHeaders(NextResponse.redirect(route.location, route.status), requestId);
    }
    if (route.type === "text") {
      return securityHeaders(
        new NextResponse(route.body, { status: 200, headers: { "Content-Type": `${route.contentType}; charset=utf-8` } }),
        requestId,
      );
    }
    if (route.type === "not-found") {
      const response = route.json
        ? NextResponse.json({ error: "not_found", requestId }, { status: 404 })
        : new NextResponse("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return securityHeaders(response, requestId);
    }

    // Mobile request signatures (production audit L-26): verified and counted on every mobile API
    // call, REPORT-ONLY unless MOBILE_REQUEST_SIGNING_MODE=enforce — see requestSigning.server.js.
    // Isolated so a fault here can never turn mobile traffic into the 500 below.
    // Checked against the path the client called (/v1/mobile/... or /api/mobile/...), which is
    // the path it signed — not the rewritten one.
    if (pathname.startsWith("/api/mobile/") || /^\/v\d+\/mobile\//.test(pathname)) {
      try {
        const signing = checkMobileRequestSignature(request);
        if (signing.reject) {
          return attachRequestIdHeader(invalidRequestSignatureResponse(), requestId);
        }
      } catch (error) {
        logger.error("Mobile request signature check failed; request let through", error, { requestId });
      }
    }

    // A client-sent version header is never trusted; only a versioned rewrite sets it.
    requestHeaders.delete(API_VERSION_HEADER);
    if (route.apiVersion) requestHeaders.set(API_VERSION_HEADER, route.apiVersion);
    const init = { request: { headers: requestHeaders } };
    const response =
      route.type === "rewrite"
        ? NextResponse.rewrite(new URL(route.pathname + request.nextUrl.search, request.url), init)
        : NextResponse.next(init);

    return securityHeaders(response, requestId);
  } catch (error) {
    logger.error(
      "Proxy error",
      error,
      {
        requestId,
        path: pathname,
      }
    );

    // Return error response
    const errorResponse = new Response(
      JSON.stringify({
        error: "Internal Server Error",
        requestId,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
        },
      }
    );

    return attachRequestIdHeader(errorResponse, requestId);
  }
}

export const config = {
  // Images and other public files go through the proxy too: on nayroz.com they are rewritten
  // into public/website. Only Next's own build output is skipped.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
