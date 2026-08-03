import { NextRequest, NextResponse } from "next/server";

import { createContactMessage } from "@/lib/support/contactMessages.server";
import {
  ContactMessageSources,
  isHoneypotTripped,
  parseContactMessageSubmission,
} from "@/lib/support/contactMessageFields";
import { resolveOptionalMobileBearer } from "@/lib/mobile/userAuth.server";
import { enforceIpRateLimit, resolveRequestIp } from "@/lib/security/rateLimit.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

// Contact-us submissions from the mobile app. Accepts the same field set as the
// website form (POST /api/contact) so both land in one dashboard inbox.
//
// Auth is optional: signing in is not required to reach support, but when a
// bearer token is present we attach the account so the team can see who wrote.

function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:support:contact",
    limit: 5,
    windowMs: 300_000,
    message: "Too many messages sent. Please wait a few minutes and try again.",
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  if (isHoneypotTripped(body)) {
    logger.warn("Mobile contact honeypot tripped", { ip: resolveRequestIp(request) });
    return noStore({ ok: true }, 201);
  }

  const parsed = parseContactMessageSubmission(body);
  if (!parsed.ok) {
    return handleBadRequest(parsed.message);
  }

  try {
    // Anonymous callers, invalid tokens and disabled accounts all resolve to
    // null, and their message is still accepted — just without an account link.
    const viewer = await resolveOptionalMobileBearer(request);

    const created = await createContactMessage({
      ...parsed.value,
      source: ContactMessageSources.MOBILE,
      mobileUserId: viewer?.id || null,
      userAgent: request.headers.get("user-agent"),
      ipAddress: resolveRequestIp(request),
    });

    logger.info("Contact message received", {
      id: created.id,
      source: ContactMessageSources.MOBILE,
      topic: parsed.value.topic,
      mobileUserId: viewer?.id || null,
    });

    return noStore({ ok: true, id: created.id }, 201);
  } catch (error) {
    return handleApiError(error, "Failed to send your message. Please try again.");
  }
}
