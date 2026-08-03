import { NextRequest, NextResponse } from "next/server";

import { getContactMessage } from "@/lib/support/contactMessages.server";
import { listContactMessageReplies } from "@/lib/support/contactMessageReplies.server";
import { getSupportEmailSettings, isSupportEmailConfigured } from "@/lib/support/supportEmailSettings.server";
import { handleApiError } from "@/lib/api/errors";

import { requireContactMessagesAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireContactMessagesAdmin(request, "detail", { limit: 120 });
    if ("error" in auth) return auth.error;

    const { id } = await params;
    // One round trip for the whole drawer: the message, its thread, and whether
    // the composer should be enabled at all.
    const [message, replies, settings] = await Promise.all([
      getContactMessage({ id }),
      listContactMessageReplies({ contactMessageId: id }),
      getSupportEmailSettings(),
    ]);

    return NextResponse.json({
      message,
      replies,
      replyEnabled: isSupportEmailConfigured(settings),
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve contact message");
  }
}
