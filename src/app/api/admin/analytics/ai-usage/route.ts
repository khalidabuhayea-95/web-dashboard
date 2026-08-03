import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { getMediaUsageStats } from "@/lib/media/credits/index.server";

import { requireAnalyticsAdmin } from "../_shared";

export const runtime = "nodejs";

/**
 * First-party AI usage for the analytics screen: which features and models ran
 * this month and what they cost.
 *
 * Deliberately separate from the GA4 summary endpoint — this is our own database,
 * so it must keep working when Google Analytics is not configured.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAnalyticsAdmin(request, "ai-usage");
    if ("error" in auth) return auth.error;

    const requestedDays = Number(request.nextUrl.searchParams.get("days"));
    const trendDays = Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 30;

    const usage = await getMediaUsageStats({ trendDays });

    return NextResponse.json(usage, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve AI usage");
  }
}
