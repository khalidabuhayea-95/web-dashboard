import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  deleteImportedBackgroundAsset,
  listImportedBackgroundAssets,
  upsertImportedBackgroundAsset,
} from "@/lib/editor/importedBackgrounds.server";
import {
  createBackgroundPreview,
  downloadRemoteAsset,
  uploadBackgroundPreviewToStorage,
} from "@/lib/editor/backgroundPreview.server";
import { handleApiError, handleBadRequest, handleNotFound } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  restorePublicObjectUrlFromClient,
  rewritePublicObjectUrlsForClient,
} from "@/lib/storage/objectStorage.server";

const IMPORTED_BACKGROUNDS_RATE_LIMIT = {
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
      scope: "api:editor:backgrounds:imported",
      identifier: session.userId || resolveRequestIp(request),
      limit: IMPORTED_BACKGROUNDS_RATE_LIMIT.limit,
      windowMs: IMPORTED_BACKGROUNDS_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many imported background requests. Please retry shortly.",
        rateLimitState
      );
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || "all";
    const categoryValue = searchParams.get("category") || searchParams.get("categoryValue") || "";
    const premiumOnly = searchParams.get("premiumOnly") === "1";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 40);
    const locale = searchParams.get("lang") || "en";

    logger.info("Imported backgrounds list requested", {
      userId: session.userId,
      source,
      page,
      pageSize,
    });

    const result = await listImportedBackgroundAssets({
      source,
      categoryValue,
      premiumOnly,
      page,
      pageSize,
      locale,
    });

    return NextResponse.json(rewritePublicObjectUrlsForClient(result), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, "Failed to fetch imported backgrounds");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:backgrounds:imported",
      identifier: session.userId || resolveRequestIp(request),
      limit: IMPORTED_BACKGROUNDS_RATE_LIMIT.limit,
      windowMs: IMPORTED_BACKGROUNDS_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many imported background requests. Please retry shortly.",
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
      return handleBadRequest("Imported background id is required");
    }

    logger.info("Deleting imported background", {
      userId: session.userId,
      backgroundId: id,
    });

    const result = await deleteImportedBackgroundAsset({
      id,
      ownerId: session.userId,
      isAdmin: session.role === "admin",
    });

    if (!result.deleted) {
      return handleNotFound("Imported background");
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to delete imported background",
      422
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:backgrounds:imported",
      identifier: session.userId || resolveRequestIp(request),
      limit: IMPORTED_BACKGROUNDS_RATE_LIMIT.limit,
      windowMs: IMPORTED_BACKGROUNDS_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many imported background requests. Please retry shortly.",
        rateLimitState
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const source = String(body?.source || "").trim().toLowerCase() || "background-upload";
    const sourceAssetId = String(body?.sourceAssetId || body?.source_asset_id || "").trim();
    const assetUrl = restorePublicObjectUrlFromClient(body?.assetUrl || body?.asset_url || "");
    let thumbnailUrl = restorePublicObjectUrlFromClient(body?.thumbnailUrl || body?.thumbnail_url || assetUrl);
    const title = String(body?.title || body?.titleEn || body?.title_en || "").trim();

    if (!sourceAssetId) {
      return handleBadRequest("Imported background sourceAssetId is required");
    }
    if (!assetUrl) {
      return handleBadRequest("Imported background assetUrl is required");
    }

    logger.info("Upserting imported background", {
      userId: session.userId,
      source,
      sourceAssetId,
    });

    if (!thumbnailUrl || thumbnailUrl === assetUrl) {
      try {
        const downloaded = await downloadRemoteAsset(assetUrl);
        const preview = await createBackgroundPreview({
          bytes: downloaded.bytes,
          mimeType: downloaded.mimeType,
        });
        if (preview.generated) {
          thumbnailUrl = await uploadBackgroundPreviewToStorage({
            ownerId: session.userId,
            sourceAssetId,
            bytes: preview.bytes,
            mimeType: preview.mimeType,
          });
        } else {
          thumbnailUrl = assetUrl;
        }
      } catch (previewError) {
        logger.warn("Background preview generation failed", {
          userId: session.userId,
          source,
          sourceAssetId,
          error: previewError instanceof Error ? previewError.message : "unknown error",
        });
        thumbnailUrl = assetUrl;
      }
    }

    const result = await upsertImportedBackgroundAsset({
      source,
      sourceAssetId,
      ownerId: session.userId,
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
      sourcePayload:
        body?.sourcePayload && typeof body.sourcePayload === "object" && !Array.isArray(body.sourcePayload)
          ? body.sourcePayload
          : {},
      translationStatus: String(body?.translationStatus || "fallback").trim().toLowerCase(),
      createdSourceAt: body?.createdSourceAt || body?.created_source_at || null,
      authorId: body?.authorId,
      authorName: body?.authorName,
    });

    return NextResponse.json(rewritePublicObjectUrlsForClient(result), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to create imported background",
      422
    );
  }
}
