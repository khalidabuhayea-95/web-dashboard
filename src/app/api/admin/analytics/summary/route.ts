import { NextRequest, NextResponse } from "next/server";

import { AnalyticsSetupError, fetchAnalyticsSummary } from "@/lib/analytics/gaData.server";
import { handleApiError } from "@/lib/api/errors";

import { requireAnalyticsAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAnalyticsAdmin(request, "summary:read", { limit: 60 });
  if ("error" in auth) return auth.error;

  const daysParam = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 28;

  try {
    const summary = await fetchAnalyticsSummary({ days });
    return NextResponse.json({ summary });
  } catch (error) {
    // Setup problems are the expected failure here (no key, no property access,
    // API not enabled). Return them as actionable copy rather than a 500 — the
    // client renders the message inline instead of an error boundary.
    if (error instanceof AnalyticsSetupError) {
      return NextResponse.json(
        { error: error.message, code: error.code, setupRequired: true },
        { status: 409 },
      );
    }
    return handleApiError(error, "Failed to load analytics summary.");
  }
}
