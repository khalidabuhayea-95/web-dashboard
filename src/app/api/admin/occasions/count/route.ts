import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { countOccasionReminders } from "@/lib/occasions/occasions.server";
import { checkRateLimit, createRateLimitResponse, resolveRequestIp } from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";

// Tiny sibling of GET /api/admin/occasions for the sidebar badge, which polls it on an
// interval: `counts.needsContent` is the number of occasions inside their reminder window
// with nothing linked yet. Same generous limit as the contact-messages count.
export async function GET(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimit = checkRateLimit({
      scope: "api:admin:occasions:count",
      identifier: session.userId || resolveRequestIp(request),
      limit: 240,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse("Too many occasion count requests. Please retry shortly.", rateLimit);
    }

    const counts = await countOccasionReminders();
    return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "Failed to count occasions");
  }
}
