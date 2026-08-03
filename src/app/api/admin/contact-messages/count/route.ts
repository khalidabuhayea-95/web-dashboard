import { NextRequest, NextResponse } from "next/server";

import { countContactMessagesByStatus } from "@/lib/support/contactMessages.server";
import { handleApiError } from "@/lib/api/errors";

import { requireContactMessagesAdmin } from "../_shared";

export const runtime = "nodejs";

// Tiny sibling of GET /api/admin/contact-messages. The sidebar unread badge
// polls this on an interval and only needs the status tallies — hitting the
// list endpoint for that would run a paginated query and burn its 60/min budget.
export async function GET(request: NextRequest) {
  try {
    // Generous limit: an admin with several dashboard tabs open polls this a few
    // times a minute each, and a throttled badge is worse than a cheap query.
    const auth = await requireContactMessagesAdmin(request, "count", { limit: 240 });
    if ("error" in auth) return auth.error;

    const counts = await countContactMessagesByStatus();

    return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "Failed to count contact messages");
  }
}
