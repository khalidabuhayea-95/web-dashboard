import { NextResponse } from "next/server";
import {
  isInfrastructureError,
  isPrismaError,
  serviceUnavailableResponse,
} from "@/lib/api/infrastructureErrors";
import { logger } from "@/lib/logging/logger";

/**
 * Standardized API error response
 */
export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Handle API errors consistently with proper logging
 *
 * An outage (database unreachable, pool exhausted, …) answers 503 + `no-store` with a generic body
 * whatever `statusCode` the caller passed — the auth routes pass 401, and a 401 during an outage
 * tells the app to discard a perfectly good session (production audit H-24).
 */
export function handleApiError(
  error: unknown,
  defaultMessage: string = "An unexpected error occurred",
  statusCode: number = 500
) {
  if (isInfrastructureError(error)) {
    logger.error(`${defaultMessage} (service unavailable)`, error);
    return serviceUnavailableResponse();
  }

  logger.error(defaultMessage, error);
  const errorStatusCode = Number(
    (error as { statusCode?: unknown; status?: unknown } | null)?.statusCode ??
      (error as { statusCode?: unknown; status?: unknown } | null)?.status
  );
  const responseStatusCode =
    Number.isFinite(errorStatusCode) && errorStatusCode >= 400 && errorStatusCode <= 599
      ? errorStatusCode
      : statusCode;

  // Don't expose sensitive error details in production. Prisma's text (SQL, schema, connection
  // details) is never exposed, not even in development, where QA devices talk to this server.
  const message =
    process.env.NODE_ENV === "production" || isPrismaError(error) ? defaultMessage : String(error);

  // An error is never a cacheable answer.
  return NextResponse.json(
    { error: message },
    { status: responseStatusCode, headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Handle validation errors
 */
export function handleValidationError(issues: unknown[]) {
  logger.warn("Validation error", { issues });
  return NextResponse.json(
    {
      error: "Validation failed",
      details: issues,
    },
    { status: 400 }
  );
}

/**
 * Handle forbidden access
 */
export function handleForbidden(reason?: string) {
  logger.warn("Forbidden access", { reason });
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Handle unauthorized access
 */
export function handleUnauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Handle not found
 */
export function handleNotFound(resource: string) {
  logger.warn("Resource not found", { resource });
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

/**
 * Handle bad request
 */
export function handleBadRequest(message: string) {
  logger.warn("Bad request", { message });
  return NextResponse.json({ error: message }, { status: 400 });
}
