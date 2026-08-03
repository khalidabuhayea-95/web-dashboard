import { NextRequest, NextResponse } from "next/server";

import { getSupportEmailSettings } from "@/lib/support/supportEmailSettings.server";
import { verifySmtp } from "@/lib/email/mailer.server";
import { handleApiError } from "@/lib/api/errors";

import { requireContactMessagesAdmin } from "../../_shared";

export const runtime = "nodejs";

// Connect + authenticate against the saved SMTP settings without sending
// anything. Lets an admin confirm the credentials before a customer is on the
// receiving end of a broken config.
export async function POST(request: NextRequest) {
  try {
    // Each attempt opens a real socket to a third-party host, so this is
    // rate-limited harder than the read paths.
    const auth = await requireContactMessagesAdmin(request, "settings-test", { limit: 10 });
    if ("error" in auth) return auth.error;

    const settings = await getSupportEmailSettings();
    if (!settings.smtp.host) {
      return NextResponse.json(
        { ok: false, error: "Save an SMTP host before testing the connection." },
        { status: 400 }
      );
    }

    const result = await verifySmtp(settings.smtp);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "Failed to test the mail server connection");
  }
}
