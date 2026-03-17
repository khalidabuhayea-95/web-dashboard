import { NextResponse } from "next/server";
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
 */
export function handleApiError(
  error: unknown,
  defaultMessage: string = "An unexpected error occurred",
  statusCode: number = 500
) {
  logger.error(defaultMessage, error);

  // Don't expose sensitive error details in production
  const message =
    process.env.NODE_ENV === "production" ? defaultMessage : String(error);

  return NextResponse.json({ error: message }, { status: statusCode });
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
