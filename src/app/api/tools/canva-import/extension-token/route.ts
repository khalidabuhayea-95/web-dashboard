import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, createRateLimitResponse, resolveRequestIp } from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import { createCanvaImportToken } from "@/lib/tools/canvaImportAuth";
import { handleApiError } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
const EXTENSION_TOKEN_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:tools:canva-extension-token:create",
      identifier: session.userId || resolveRequestIp(request),
      limit: EXTENSION_TOKEN_LIMIT.limit,
      windowMs: EXTENSION_TOKEN_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse("Too many token requests. Please retry shortly.", rateLimitState);
    }

    logger.info("Creating Canva extension token", {
      userId: session.userId,
    });

    const { token, expiresAt } = createCanvaImportToken(session.userId);
    return NextResponse.json({
      token,
      expiresAt,
    });
  } catch (error) {
    return handleApiError(error, "Failed to create import token");
  }
}
