import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { getUserCreditSummary } from "@/lib/media/credits/index.server";

export const runtime = "nodejs";

const logger = createLogger("api.mobile.media.credits");

/**
 * The caller's AI credit wallet for the current month. The app uses this to show
 * a remaining balance and to label each AI action with its credit cost, so a user
 * sees the price before spending rather than discovering it via a 429.
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

    const summary = await getUserCreditSummary(auth.mobileUser.id);

    return attachRequestIdHeader(
      NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } }),
      requestId
    );
  } catch (error) {
    requestLogger.error("Failed to read credit balance", error);
    return attachRequestIdHeader(
      NextResponse.json(
        { error: "Failed to read the credit balance." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      ),
      requestId
    );
  }
}
