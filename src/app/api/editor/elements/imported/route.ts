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
  upsertImportedElementAsset,
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
    const categoryValue = searchParams.get("category") || searchParams.get("categoryValue") || "";
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
      categoryValue,
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

export async function POST(request: NextRequest) {
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

    const source = String(body?.source || "").trim().toLowerCase() || "upload";
    const sourceAssetId = String(body?.sourceAssetId || body?.source_asset_id || "").trim();
    const assetUrl = String(body?.assetUrl || body?.asset_url || "").trim();
    const thumbnailUrl = String(body?.thumbnailUrl || body?.thumbnail_url || assetUrl).trim();
    const title = String(body?.title || body?.titleEn || body?.title_en || "").trim();
    const kind = String(body?.kind || "vector").trim().toLowerCase() || "vector";

    if (!sourceAssetId) {
      return handleBadRequest("Imported element sourceAssetId is required");
    }
    if (!assetUrl) {
      return handleBadRequest("Imported element assetUrl is required");
    }

    logger.info("Upserting imported element", {
      userId: session.userId,
      source,
      sourceAssetId,
      kind,
    });

    const result = await upsertImportedElementAsset({
      source,
      sourceAssetId,
      ownerId: session.userId,
      kind,
      titleEn: title || sourceAssetId,
      titleAr: String(body?.titleAr || body?.title_ar || title || sourceAssetId).trim(),
      tagsEn: Array.isArray(body?.tagsEn || body?.tags_en) ? (body?.tagsEn || body?.tags_en) : [],
      tagsAr: Array.isArray(body?.tagsAr || body?.tags_ar) ? (body?.tagsAr || body?.tags_ar) : [],
      labelsEn: Array.isArray(body?.labelsEn || body?.labels_en) ? (body?.labelsEn || body?.labels_en) : [],
      labelsAr: Array.isArray(body?.labelsAr || body?.labels_ar) ? (body?.labelsAr || body?.labels_ar) : [],
      slug: String(body?.slug || "").trim(),
      categoryValue: String(body?.categoryValue || body?.category || "").trim(),
      assetUrl,
      thumbnailUrl,
      width: body?.width,
      height: body?.height,
      freeSvg: Boolean(body?.freeSvg ?? true),
      sourcePayload:
        body?.sourcePayload && typeof body.sourcePayload === "object" && !Array.isArray(body.sourcePayload)
          ? body.sourcePayload
          : {},
      translationStatus: String(body?.translationStatus || "fallback").trim().toLowerCase(),
      createdSourceAt: body?.createdSourceAt || body?.created_source_at || null,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to create imported element",
      422
    );
  }
}
