import { NextRequest, NextResponse } from "next/server";

import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { upsertDeviceToken } from "@/lib/push/deviceTokens.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Register or refresh the current device's FCM push token for the signed-in
 * mobile user. The app calls this on startup and whenever FirebaseMessaging's
 * onNewToken fires (token rotation). The "specific user" is the bearer-
 * authenticated user; the device token is associated with them.
 *
 * Each device registers its own token, so a user signed in on multiple devices
 * accumulates multiple active tokens and receives pushes on all of them. Stale
 * tokens (after rotation / uninstall) are pruned automatically when a send
 * reports them as unregistered.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return noStore({ error: auth.error }, auth.status);
  }
  const mobileUser = auth.mobileUser;

  const rateLimit = checkRateLimit({
    scope: "api:mobile:devices:token",
    identifier: mobileUser.id,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      "Too many device token updates. Please retry shortly.",
      rateLimit,
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  const deviceToken = String(body.deviceToken || "").trim();
  if (!deviceToken) {
    return handleBadRequest("deviceToken is required.");
  }
  const devicePlatform = String(body.devicePlatform || "").trim().toLowerCase();
  const appVersion = String(body.appVersion || "").trim();

  try {
    const record = await upsertDeviceToken({
      mobileUserId: mobileUser.id,
      token: deviceToken,
      platform: devicePlatform === "ios" ? "ios" : "android",
      appVersion: appVersion || undefined,
    });

    logger.info("Mobile device token refreshed", { userId: mobileUser.id });
    return noStore({ ok: true, registered: Boolean(record) });
  } catch (error) {
    return handleApiError(error, "Failed to update device token.");
  }
}
