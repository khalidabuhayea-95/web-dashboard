import { NextRequest, NextResponse } from "next/server";

import { AnalyticsSetupError, fetchRealtimeSnapshot } from "@/lib/analytics/gaData.server";
import { handleApiError } from "@/lib/api/errors";

import { requireAnalyticsAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // The client polls this every 30s; the underlying snapshot is cached for 15s,
  // so the rate limit only needs to catch genuinely runaway callers.
  const auth = await requireAnalyticsAdmin(request, "realtime:read", { limit: 120 });
  if ("error" in auth) return auth.error;

  try {
    const realtime = await fetchRealtimeSnapshot();
    return NextResponse.json({ realtime });
  } catch (error) {
    if (error instanceof AnalyticsSetupError) {
      return NextResponse.json(
        { error: error.message, code: error.code, setupRequired: true },
        { status: 409 },
      );
    }
    return handleApiError(error, "Failed to load realtime analytics.");
  }
}
