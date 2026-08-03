import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getSupportEmailSettings,
  saveSupportEmailSettings,
  toPublicSupportEmailSettings,
} from "@/lib/support/supportEmailSettings.server";
import { handleApiError, handleValidationError } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requireContactMessagesAdmin } from "../_shared";

export const runtime = "nodejs";

// The mailbox replies are sent from. Lives next to the inbox it serves rather
// than on the global /settings page so an admin configures it where they hit
// the need. Validation detail is in supportEmailSettings.server.js.
const saveSchema = z.object({
  enabled: z.boolean().optional().default(false),
  fromName: z.string().max(120).optional().default(""),
  fromEmail: z.string().max(200).optional().default(""),
  replyToEmail: z.string().max(200).optional().default(""),
  signature: z.string().max(2000).optional().default(""),
  smtp: z
    .object({
      host: z.string().max(255).optional().default(""),
      // The form posts a string; coerce so "587" is accepted.
      port: z.coerce.number().int().min(1).max(65535).optional().default(587),
      secure: z.boolean().optional().default(false),
      username: z.string().max(255).optional().default(""),
      // Blank means "keep the stored password".
      password: z.string().max(512).optional().default(""),
    })
    // Left optional rather than defaulted: saveSupportEmailSettings already
    // treats a missing smtp block as empty, and a zod default here would have
    // to restate every inner default.
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireContactMessagesAdmin(request, "settings-read", { limit: 120 });
    if ("error" in auth) return auth.error;

    const settings = await getSupportEmailSettings();
    return NextResponse.json(
      { settings: toPublicSupportEmailSettings(settings) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, "Failed to load reply email settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireContactMessagesAdmin(request, "settings-write", { limit: 30 });
    if ("error" in auth) return auth.error;

    const body = await request.json().catch(() => null);
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    let saved;
    try {
      saved = await saveSupportEmailSettings(parsed.data);
    } catch (error) {
      // Field-level validation (bad address, bad port) is a 400, not a 500.
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid settings." },
        { status: 400 }
      );
    }

    logger.info("Support reply email settings updated", {
      updatedBy: auth.session.userId,
      enabled: saved.enabled,
      fromEmail: saved.fromEmail,
    });

    return NextResponse.json({ settings: toPublicSupportEmailSettings(saved) });
  } catch (error) {
    return handleApiError(error, "Failed to save reply email settings");
  }
}
