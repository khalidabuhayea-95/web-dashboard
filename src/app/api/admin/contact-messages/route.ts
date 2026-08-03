import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  countContactMessagesByStatus,
  deleteContactMessage,
  listContactMessages,
  updateContactMessageStatus,
} from "@/lib/support/contactMessages.server";
import {
  CONTACT_MESSAGE_SOURCE_VALUES,
  CONTACT_MESSAGE_STATUS_VALUES,
  CONTACT_MESSAGE_TOPIC_VALUES,
} from "@/lib/support/contactMessageFields";
import { handleApiError, handleValidationError } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requireContactMessagesAdmin } from "./_shared";

export const runtime = "nodejs";

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional().default(""),
  // "unhandled" is the default inbox view: new + read.
  status: z
    .enum(["all", "unhandled", ...CONTACT_MESSAGE_STATUS_VALUES] as [string, ...string[]])
    .optional()
    .default("all"),
  source: z
    .enum(["all", ...CONTACT_MESSAGE_SOURCE_VALUES] as [string, ...string[]])
    .optional()
    .default("all"),
  topic: z
    .enum(["all", ...CONTACT_MESSAGE_TOPIC_VALUES] as [string, ...string[]])
    .optional()
    .default("all"),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(CONTACT_MESSAGE_STATUS_VALUES as [string, ...string[]]),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireContactMessagesAdmin(request, "list", { limit: 60 });
    if ("error" in auth) return auth.error;

    const parsed = listSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { page, perPage, search, status, source, topic } = parsed.data;
    const [{ total, messages }, counts] = await Promise.all([
      listContactMessages({ page, perPage, search, status, source, topic }),
      countContactMessagesByStatus(),
    ]);

    return NextResponse.json({ messages, page, perPage, total, counts });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve contact messages");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireContactMessagesAdmin(request, "update");
    if ("error" in auth) return auth.error;

    const body = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const message = await updateContactMessageStatus({
      id: parsed.data.id,
      status: parsed.data.status,
      handledByUserId: auth.session.userId,
    });

    logger.info("Contact message status changed", {
      contactMessageId: parsed.data.id,
      status: parsed.data.status,
      updatedBy: auth.session.userId,
    });

    return NextResponse.json({ message });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to update contact message"
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireContactMessagesAdmin(request, "delete");
    if ("error" in auth) return auth.error;

    const id = String(request.nextUrl.searchParams.get("id") || "").trim();
    if (!id) {
      return handleValidationError([
        { path: ["id"], message: "Contact message id is required", code: "custom" },
      ]);
    }

    await deleteContactMessage({ id });

    logger.info("Contact message deleted", {
      contactMessageId: id,
      deletedBy: auth.session.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to delete contact message"
    );
  }
}
