import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { getEditorSession } from "@/lib/templates/server";
import {
  MANUAL_GRANT_TIERS,
  SubscriptionAdminError,
  getSubscriptionSummary,
  listSubscribers,
  setManualSubscription,
} from "@/lib/billing/subscriptionAdmin.server";
import { resolvePeriodKey } from "@/lib/media/credits/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can view subscriptions");
    }

    const [subscribers, summary] = await Promise.all([
      listSubscribers(),
      getSubscriptionSummary(resolvePeriodKey()),
    ]);

    return NextResponse.json({ subscribers, summary });
  } catch (error) {
    return handleApiError(error, "Failed to load subscriptions");
  }
}

/** Manual grant / revoke. Store-backed rows are never touched — see the module. */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can change subscriptions");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const mobileUserId = String(body?.mobileUserId || "").trim();
    const tier = String(body?.tier || "").trim();
    if (!mobileUserId) return handleBadRequest("mobileUserId is required");
    if (tier !== "free" && !MANUAL_GRANT_TIERS.includes(tier as any)) {
      return handleBadRequest(`tier must be free, ${MANUAL_GRANT_TIERS.join(" or ")}`);
    }

    let expiresAt: Date | null = null;
    if (tier !== "free" && body?.expiresAt) {
      const parsed = new Date(String(body.expiresAt));
      if (Number.isNaN(parsed.getTime())) return handleBadRequest("expiresAt is not a date");
      expiresAt = parsed;
    }

    const { hasStoreRow } = await setManualSubscription({
      mobileUserId,
      tier: tier as any,
      expiresAt,
    });

    logger.info("Manual subscription change", {
      userId: session.userId,
      mobileUserId,
      tier,
      hasStoreRow,
    });

    return NextResponse.json({
      ok: true,
      // Surfaced so the UI can warn: a store row will re-derive this on its
      // next webhook and overwrite the manual value.
      overriddenByStore: hasStoreRow,
    });
  } catch (error) {
    if (error instanceof SubscriptionAdminError) return handleBadRequest(error.message);
    return handleApiError(error, "Failed to update the subscription");
  }
}
