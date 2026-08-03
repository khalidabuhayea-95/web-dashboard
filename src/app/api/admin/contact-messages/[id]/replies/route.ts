import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  listContactMessageReplies,
  sendContactMessageReply,
} from "@/lib/support/contactMessageReplies.server";
import { handleApiError, handleValidationError } from "@/lib/api/errors";

import { requireContactMessagesAdmin } from "../../_shared";

export const runtime = "nodejs";

const replySchema = z.object({
  body: z.string().trim().min(1, "Reply body is required.").max(10_000),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireContactMessagesAdmin(request, "replies-list", { limit: 120 });
    if ("error" in auth) return auth.error;

    const { id } = await params;
    const replies = await listContactMessageReplies({ contactMessageId: id });

    return NextResponse.json({ replies }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "Failed to load the reply thread");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sending mail is the expensive, externally-visible action on this resource.
    const auth = await requireContactMessagesAdmin(request, "reply-send", { limit: 20 });
    if ("error" in auth) return auth.error;

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = replySchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const session = auth.session as {
      userId?: string;
      user?: { name?: string | null; email?: string | null };
    };
    const authorName =
      String(session.user?.name || session.user?.email || "Support").trim() || "Support";

    const result = await sendContactMessageReply({
      id,
      body: parsed.data.body,
      authorUserId: session.userId,
      authorName,
    });

    if (!result.ok) {
      // 502: we accepted and stored the draft, the upstream mail server refused
      // it. The stored `failed` reply comes back so the UI can show the reason.
      return NextResponse.json({ ok: false, reply: result.reply, error: result.error }, { status: 502 });
    }

    return NextResponse.json({ ok: true, reply: result.reply }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to send the reply");
  }
}
