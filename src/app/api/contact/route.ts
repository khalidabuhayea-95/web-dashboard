import { NextRequest, NextResponse } from "next/server";

import { createContactMessage } from "@/lib/support/contactMessages.server";
import {
  ContactMessageSources,
  isHoneypotTripped,
  parseContactMessageSubmission,
} from "@/lib/support/contactMessageFields";
import { enforceIpRateLimit, resolveRequestIp } from "@/lib/security/rateLimit.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

// Public endpoint for the marketing site's contact form (public/contact.html).
// Anonymous by design — anyone who can reach the site can write here, so the
// IP rate limit and the honeypot are the only things standing between this
// table and a spam run.

function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:contact:submit",
    limit: 5,
    windowMs: 300_000,
    message: "Too many messages sent. Please wait a few minutes and try again.",
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  // Answer exactly as we would on success so a bot learns nothing.
  if (isHoneypotTripped(body)) {
    logger.warn("Contact form honeypot tripped", { ip: resolveRequestIp(request) });
    return noStore({ ok: true }, 201);
  }

  const parsed = parseContactMessageSubmission(body);
  if (!parsed.ok) {
    return handleBadRequest(parsed.message);
  }

  try {
    const created = await createContactMessage({
      ...parsed.value,
      source: ContactMessageSources.WEB,
      userAgent: request.headers.get("user-agent"),
      ipAddress: resolveRequestIp(request),
    });

    logger.info("Contact message received", {
      id: created.id,
      source: ContactMessageSources.WEB,
      topic: parsed.value.topic,
    });

    return noStore({ ok: true, id: created.id }, 201);
  } catch (error) {
    return handleApiError(error, "Failed to send your message. Please try again.");
  }
}
