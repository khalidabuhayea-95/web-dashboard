import type { NextRequest } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getDashboardSession, Roles } from "@/lib/auth/roles";
import { handleForbidden, handleUnauthorized } from "@/lib/api/errors";

// Shared admin gate for /api/admin/analytics/* — mirrors the api/admin/push
// pattern (session → rate limit → ADMIN role). Returns { error } to
// short-circuit or { session } on success.
export async function requireAnalyticsAdmin(
  request: NextRequest,
  scope: string,
  options: { limit?: number; windowMs?: number } = {},
) {
  const { limit = 30, windowMs = 60_000 } = options;

  const session = await getDashboardSession();
  if (!session?.userId) {
    return { error: handleUnauthorized() };
  }

  const rateLimit = checkRateLimit({
    scope: `api:admin:analytics:${scope}`,
    identifier: session.userId || resolveRequestIp(request),
    limit,
    windowMs,
  });
  if (!rateLimit.allowed) {
    return {
      error: createRateLimitResponse("Too many analytics requests. Please retry shortly.", rateLimit),
    };
  }

  if (session.role !== Roles.ADMIN) {
    return { error: handleForbidden("Not an admin user") };
  }

  return { session };
}
