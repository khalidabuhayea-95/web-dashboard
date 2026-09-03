import { NextRequest, NextResponse } from "next/server";

import { getSubscriptionStatus } from "@/lib/billing/subscriptionState.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";

export const runtime = "nodejs";

const logger = createLogger("api.mobile.subscriptions.status");

/**
 * The caller's Nayroz Pro entitlement as the server sees it. The app treats
 * this as the truth for gating (its local store state is only a hint), so the
 * response is deliberately small and never cached.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      return attachRequestIdHeader(
        NextResponse.json(
          { error: auth.error },
          { status: auth.status, headers: { "Cache-Control": "no-store" } }
        ),
        requestId
      );
    }

    const status = await getSubscriptionStatus(auth.mobileUser.id);

    return attachRequestIdHeader(
      NextResponse.json(status, { headers: { "Cache-Control": "no-store" } }),
      requestId
    );
  } catch (error) {
    requestLogger.error("Failed to read subscription status", error);
    return attachRequestIdHeader(
      NextResponse.json(
        { error: "Failed to read the subscription status." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      ),
      requestId
    );
  }
}
