import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  deleteImportedElementAsset,
  listImportedElementAssets,
} from "@/lib/editor/importedElements.server";
import { handleApiError, handleBadRequest, handleNotFound } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

const IMPORTED_ELEMENTS_RATE_LIMIT = {
  limit: 120,
  windowMs: 60_000,
};

export const runtime = "nodejs";

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:elements:imported",
      identifier: session.userId || resolveRequestIp(request),
      limit: IMPORTED_ELEMENTS_RATE_LIMIT.limit,
      windowMs: IMPORTED_ELEMENTS_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many imported elements requests. Please retry shortly.",
        rateLimitState
      );
    }

    const { searchParams } = new URL(request.url);

    const source = searchParams.get("source") || "freepik";
    const kind = searchParams.get("kind") || "all";
    const query = searchParams.get("query") || "";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 40);
    const locale = searchParams.get("lang") || "en";

    logger.info("Imported elements list requested", {
      userId: session.userId,
      source,
      kind,
      page,
      pageSize,
    });

    const result = await listImportedElementAssets({
      source,
      kind,
      query,
      page,
      pageSize,
      locale,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, "Failed to fetch imported elements");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:elements:imported",
      identifier: session.userId || resolveRequestIp(request),
      limit: IMPORTED_ELEMENTS_RATE_LIMIT.limit,
      windowMs: IMPORTED_ELEMENTS_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many imported elements requests. Please retry shortly.",
        rateLimitState
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const id = String(body?.id || "").trim();
    if (!id) {
      return handleBadRequest("Imported element id is required");
    }

    logger.info("Deleting imported element", {
      userId: session.userId,
      elementId: id,
    });

    const result = await deleteImportedElementAsset({
      id,
      ownerId: session.userId,
      isAdmin: session.role === "admin",
    });

    if (!result.deleted) {
      return handleNotFound("Imported element");
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to delete imported element",
      422
    );
  }
}
