import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { describeToday, listUpcomingOccasions, UPCOMING_HORIZON_DAYS } from "@/lib/occasions/occasions.server";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";

// The Overview widget: what is coming in the next two months and whether it has content.
export async function GET(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const { searchParams } = new URL(request.url);
    const parsed = Number.parseInt(String(searchParams.get("days") || ""), 10);
    const horizonDays = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : UPCOMING_HORIZON_DAYS;

    const items = await listUpcomingOccasions({ horizonDays });
    return NextResponse.json(
      { ok: true, today: describeToday(), horizonDays, items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, "Failed to load upcoming occasions");
  }
}
