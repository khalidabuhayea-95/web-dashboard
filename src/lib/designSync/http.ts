import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security/rateLimit.server";

import { DesignSyncError } from "./errors";
import type { SyncUser } from "./quota.server";

/** Sync answers are per-user and change with every write: never cacheable. */
export function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * A refusal the app acts on keeps its `code` and its extras (the current header on a conflict,
 * the missing hashes, the storage summary); anything else goes through the shared handler, which
 * turns an outage into 503 rather than a made-up answer.
 */
export function syncErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof DesignSyncError) {
    return noStore({ error: error.message, code: error.code, ...error.extra }, error.status);
  }
  return handleApiError(error, fallbackMessage);
}

type AuthOutcome = { user: SyncUser; response: null } | { user: null; response: NextResponse };

/** The signed-in mobile user, or the response to send instead. Optionally rate-limited per user. */
export async function authenticateSyncRequest(
  request: NextRequest,
  rateLimit?: { scope: string; limit: number },
): Promise<AuthOutcome> {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return {
      user: null,
      response: noStore({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) }, auth.status),
    };
  }
  if (rateLimit) {
    const outcome = checkRateLimit({
      scope: rateLimit.scope,
      identifier: auth.mobileUser.id,
      limit: rateLimit.limit,
      windowMs: 60_000,
    });
    if (!outcome.allowed) {
      return {
        user: null,
        response: createRateLimitResponse("Too many sync requests. Please retry shortly.", outcome) as NextResponse,
      };
    }
  }
  return { user: auth.mobileUser as SyncUser, response: null };
}
