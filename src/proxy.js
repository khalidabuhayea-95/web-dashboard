import {
  attachRequestIdHeader,
  ensureRequestIdHeaders,
} from "@/lib/logging/request";
import { logger } from "@/lib/logging/logger";
import { NextResponse } from "next/server";

/**
 * Global proxy handler for Next.js
 * Handles request tracing and security headers
 */
export async function proxy(request) {
  const { requestId, requestHeaders } = ensureRequestIdHeaders(request.headers);

  logger.info("API Request", {
    requestId,
    method: request.method,
    path: request.nextUrl.pathname,
    ip: request.ip || "unknown",
  });

  try {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    // Add security headers
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    logger.error(
      "Proxy error",
      error,
      {
        requestId,
        path: request.nextUrl.pathname,
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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
