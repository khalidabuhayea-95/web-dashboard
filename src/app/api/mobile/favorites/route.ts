import { NextRequest, NextResponse } from "next/server";

import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import {
  addFavorite,
  findFavoritableTemplate,
  isValidTemplateId,
  listFavorites,
} from "@/lib/mobile/favorites.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestOrigin(request: NextRequest): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/**
 * List the signed-in mobile user's favorite templates, newest first. Each entry
 * inlines a lightweight template summary so the app can render the list without
 * a follow-up request per template.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return noStore({ error: auth.error }, auth.status);
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await listFavorites({
      mobileUserId: auth.mobileUser.id,
      page: searchParams.get("page"),
      pageSize:
        searchParams.get("pageSize") ??
        searchParams.get("page_size") ??
        searchParams.get("per_page") ??
        searchParams.get("limit"),
      origin: requestOrigin(request),
    });
    return noStore(result);
  } catch (error) {
    return handleApiError(error, "Failed to load favorites.");
  }
}

/**
 * Add a template to the signed-in user's favorites. The template id is sent in
 * the body. Idempotent: re-favoriting returns the existing favorite with
 * `created: false`. Only published templates can be favorited.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return noStore({ error: auth.error }, auth.status);
  }
  const mobileUser = auth.mobileUser;

  const rateLimit = checkRateLimit({
    scope: "api:mobile:favorites:write",
    identifier: mobileUser.id,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      "Too many favorite updates. Please retry shortly.",
      rateLimit,
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  const templateId = String((body as { templateId?: unknown }).templateId || "").trim();
  if (!templateId) {
    return handleBadRequest("templateId is required.");
  }
  if (!isValidTemplateId(templateId)) {
    return handleBadRequest("templateId must be a valid template UUID.");
  }

  try {
    const template = await findFavoritableTemplate(templateId);
    if (!template) {
      return noStore({ error: "Template not found." }, 404);
    }

    const { favorite, created } = await addFavorite({
      mobileUserId: mobileUser.id,
      templateId,
      origin: requestOrigin(request),
    });

    logger.info("Mobile favorite added", {
      userId: mobileUser.id,
      templateId,
      created,
    });
    return noStore({ favorite, created }, created ? 201 : 200);
  } catch (error) {
    return handleApiError(error, "Failed to add favorite.");
  }
}
