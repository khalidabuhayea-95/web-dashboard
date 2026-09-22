import { NextResponse } from "next/server";

import { requireMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { normalizeMobileUserRole } from "@/lib/mobile/mobileUserRoles";
import { deleteMobileUserAccount } from "@/lib/mobile/accountDeletion.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";
import { logger } from "@/lib/logging/logger";

import { authErrorResponse } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { mobileUser } = await requireMobileBearerUser(request);
    return NextResponse.json(
      {
        user: {
          id: mobileUser.id,
          name: mobileUser.name || null,
          email: mobileUser.email || null,
          emailVerified: Boolean(mobileUser.emailVerified),
          role: normalizeMobileUserRole(mobileUser.role),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return authErrorResponse(error, "Unauthorized.", 401);
  }
}

/**
 * Erase the signed-in account and its personal data. Required by Google Play's
 * account deletion policy and Apple's guideline 5.1.1(v); the app calls this
 * from Settings > Delete account.
 *
 * Deliberately rate limited hard: this is irreversible, so a leaked token
 * should not be able to hammer it.
 */
export async function DELETE(request: Request) {
  let userId: string;
  try {
    const { mobileUser } = await requireMobileBearerUser(request);
    userId = mobileUser.id;
  } catch (error) {
    return authErrorResponse(error, "Unauthorized.", 401);
  }

  const rateLimit = checkRateLimit({
    scope: "api:mobile:auth:delete",
    identifier: userId,
    limit: 3,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      "Too many deletion attempts. Please retry shortly.",
      rateLimit
    );
  }

  try {
    await deleteMobileUserAccount(userId);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logger.error("Failed to delete mobile account", error);
    return NextResponse.json(
      { error: "Could not delete the account. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
