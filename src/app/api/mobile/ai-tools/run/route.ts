import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { resolveUserTier, SUBSCRIPTION_TIERS } from "@/lib/billing/subscriptionTier.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { resolveMobileBearerUser } from "@/lib/mobile/userAuth.server";
import prisma from "@/lib/prisma";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security/rateLimit.server";
import { MEDIA_CREDIT_FEATURES } from "@/lib/media/credits/config.js";
import { enforceMediaCredits, recordMediaUsage } from "@/lib/media/credits/index.server";
import { resolveAiTool, runAiTool } from "@/lib/mobile/aiTools.server";

export const runtime = "nodejs";
// The model itself can take minutes on a cold start; match the media routes.
export const maxDuration = 300;

const logger = createLogger("api.mobile.ai-tools.run");
const RUN_LIMIT = { limit: 6, windowMs: 5 * 60_000 };
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;

function jsonResponse(
  requestId: string,
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
) {
  return attachRequestIdHeader(
    NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store", ...headers } }),
    requestId
  );
}

// Runs one catalogue tool over the user's photo. `toolId` is the id from
// GET /api/mobile/ai-tools ("magic:enhance-photo", "template:skin-oud-smoke") —
// the prompt and model behind it never leave the server.
//
// Returns the finished image as raw bytes, matching /media/edit-image, so the
// app's existing download path handles it unchanged.
export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const startedAt = Date.now();

  try {
    const auth = await resolveMobileBearerUser(request);
    if (!auth.ok) {
      return jsonResponse(requestId, { error: auth.error }, auth.status);
    }
    const mobileUser = auth.mobileUser;

    const rateLimitState = checkRateLimit({
      scope: "api:mobile:ai-tools:run",
      identifier: mobileUser.id,
      limit: RUN_LIMIT.limit,
      windowMs: RUN_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return attachRequestIdHeader(
        createRateLimitResponse("Too many AI tool requests. Please retry shortly.", rateLimitState),
        requestId
      );
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return jsonResponse(requestId, { error: "Invalid multipart form data." }, 400);
    }

    const toolId = String(formData.get("toolId") || "").trim();
    if (!toolId) {
      return jsonResponse(requestId, { error: "Missing toolId." }, 400);
    }

    // Resolve BEFORE charging: the tool's own creditCost is the price, and an
    // unknown or unpublished tool must cost nothing.
    const tool = await resolveAiTool(toolId);
    if (!tool) {
      return jsonResponse(
        requestId,
        { error: "That tool is not available.", code: "tool_not_found" },
        404
      );
    }

    // ★EVERY tool requires a paid subscription (2026-09-01 direction — the gate
    // used to apply only to isPremium tools). The catalogue stays public so the
    // shop window works signed-out; the app walls at tool-open client-side, and
    // this is the enforcement behind it. isPremium remains on the wire purely
    // as catalogue metadata.
    //
    // ★Gate on "not free", NOT on equality with a single tier. This read
    // `tier !== "pro"` while "pro" meant the ENTRY tier, so a top-tier
    // subscriber — whose tier string was "pro_max" — was rejected from the very
    // tools they paid the most for. Any future tier is entitled by default,
    // which is the safe direction for a paying customer.
    {
      const tierUser = await prisma.mobileUser.findUnique({
        where: { id: mobileUser.id },
        select: { subscriptionTier: true, subscriptionExpiresAt: true },
      });
      const tier = resolveUserTier(tierUser);
      if (tier === SUBSCRIPTION_TIERS.FREE) {
        requestLogger.info("AI tool run rejected: subscription required", {
          mobileUserId: mobileUser.id,
          toolSlug: tool.slug,
        });
        return jsonResponse(
          requestId,
          {
            error: "This tool is part of Nayroz Pro.",
            code: "subscription_required",
            subscription: { tier, required: "plus" },
          },
          403
        );
      }
    }

    const imageEntry = formData.get("image");
    let imageBuffer: Buffer | null = null;

    if (imageEntry instanceof File) {
      const size = Number(imageEntry.size || 0);
      if (size <= 0) {
        return jsonResponse(requestId, { error: "Image upload must not be empty." }, 400);
      }
      if (size > MAX_IMAGE_UPLOAD_BYTES) {
        return jsonResponse(requestId, { error: "Image upload is too large." }, 413);
      }
      const mimeType = String(imageEntry.type || "").toLowerCase();
      if (mimeType && !mimeType.startsWith("image/")) {
        return jsonResponse(requestId, { error: "Only image uploads are allowed." }, 400);
      }
      imageBuffer = Buffer.from(await imageEntry.arrayBuffer());
    } else if (tool.requiresImage) {
      return jsonResponse(
        requestId,
        { error: "This tool needs a photo.", code: "image_required" },
        400
      );
    }

    const insufficientCredits = await enforceMediaCredits({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.AI_TOOLS,
      costOverride: tool.creditCost,
    });
    if (insufficientCredits) {
      requestLogger.info("AI tool run rejected: insufficient credits", {
        mobileUserId: mobileUser.id,
        toolId,
      });
      return attachRequestIdHeader(insufficientCredits, requestId);
    }

    // Normalise like the batch renderer and the admin generate route, so a
    // phone upload produces the same result the card advertises.
    let normalizedInput: Buffer | null = null;
    if (imageBuffer) {
      try {
        normalizedInput = await sharp(imageBuffer)
          .rotate()
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
      } catch (_error) {
        return jsonResponse(requestId, { error: "That file could not be read as an image." }, 400);
      }
    }

    const result = await runAiTool(tool, normalizedInput, "image/jpeg");

    // Charged only after the provider returned something: a failed prediction
    // must not spend the user's credits.
    await recordMediaUsage({
      mobileUserId: mobileUser.id,
      feature: MEDIA_CREDIT_FEATURES.AI_TOOLS,
      provider: tool.kind === "magic" && !result.predictionId ? "local" : "replicate",
      model: result.model,
      credits: tool.creditCost,
    });

    requestLogger.info("AI tool run completed", {
      mobileUserId: mobileUser.id,
      toolId,
      kind: tool.kind,
      model: result.model,
      credits: tool.creditCost,
      outputBytes: result.buffer.length,
      durationMs: Date.now() - startedAt,
    });

    return attachRequestIdHeader(
      new NextResponse(new Uint8Array(result.buffer), {
        status: 200,
        headers: {
          "Content-Type": result.mimeType || "image/png",
          "Content-Disposition": `inline; filename="${tool.slug}.png"`,
          "Cache-Control": "no-store",
          "X-Ai-Tool-Id": toolId,
          "X-Ai-Tool-Kind": tool.kind,
          "X-Credits-Charged": String(tool.creditCost),
        },
      }),
      requestId
    );
  } catch (error) {
    requestLogger.error("AI tool run failed", error, { durationMs: Date.now() - startedAt });
    return jsonResponse(requestId, { error: "Failed to run the AI tool." }, 500);
  }
}
