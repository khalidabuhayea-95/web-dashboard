import { NextRequest, NextResponse } from "next/server";

import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import {
  addFavorite,
  findFavoritableTemplate,
  getFavorite,
  isValidTemplateId,
  removeFavorite,
} from "@/lib/mobile/favorites.server";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/security/rateLimit.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ templateId: string }> };

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

async function resolveTemplateId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return String(params?.templateId || "").trim();
}

function enforceWriteRateLimit(userId: string) {
  const rateLimit = checkRateLimit({
    scope: "api:mobile:favorites:write",
    identifier: userId,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      "Too many favorite updates. Please retry shortly.",
      rateLimit,
    );
  }
  return null;
}

/**
 * Check whether a specific template is in the signed-in user's favorites.
 * Always 200: the answer is `isFavorite`, with the favorite payload when set.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return noStore({ error: auth.error }, auth.status);
  }

  const templateId = await resolveTemplateId(context);
  if (!isValidTemplateId(templateId)) {
    return handleBadRequest("templateId must be a valid template UUID.");
  }

  try {
    const favorite = await getFavorite({
      mobileUserId: auth.mobileUser.id,
      templateId,
      origin: requestOrigin(request),
    });
    return noStore({ isFavorite: Boolean(favorite), favorite });
  } catch (error) {
    return handleApiError(error, "Failed to load favorite.");
  }
}

/**
 * Ensure a template is favorited (idempotent upsert by URL). Validates that the
 * template exists and is published. `created` reports whether this call added
 * the favorite or it was already present.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return noStore({ error: auth.error }, auth.status);
  }
  const mobileUser = auth.mobileUser;

  const limited = enforceWriteRateLimit(mobileUser.id);
  if (limited) return limited;

  const templateId = await resolveTemplateId(context);
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

    logger.info("Mobile favorite upserted", {
      userId: mobileUser.id,
      templateId,
      created,
    });
    return noStore({ favorite, created }, created ? 201 : 200);
  } catch (error) {
    return handleApiError(error, "Failed to save favorite.");
  }
}

/**
 * Remove a template from the signed-in user's favorites. Idempotent: `removed`
 * is false when the template was not favorited.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await resolveMobileBearerUser(request);
  if (!auth.ok) {
    return noStore({ error: auth.error }, auth.status);
  }
  const mobileUser = auth.mobileUser;

  const limited = enforceWriteRateLimit(mobileUser.id);
  if (limited) return limited;

  const templateId = await resolveTemplateId(context);
  if (!isValidTemplateId(templateId)) {
    return handleBadRequest("templateId must be a valid template UUID.");
  }

  try {
    const { removed } = await removeFavorite({
      mobileUserId: mobileUser.id,
      templateId,
    });

    logger.info("Mobile favorite removed", {
      userId: mobileUser.id,
      templateId,
      removed,
    });
    return noStore({ ok: true, removed });
  } catch (error) {
    return handleApiError(error, "Failed to remove favorite.");
  }
}
