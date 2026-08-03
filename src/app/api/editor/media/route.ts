import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { resizeThumbnailBufferHalf } from "@/lib/media/thumbnailResize.server";
import { resizeVideoPreviewBuffer } from "@/lib/media/videoPreviewResize.server";
import {
  getPublicStorageBucketName,
  parsePublicObjectKeyFromUrl,
  rewritePublicObjectUrlForClient,
  deleteObjects,
  listObjectKeys,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET_NAME = getPublicStorageBucketName();
const MEDIA_UPLOAD_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_FONT_BYTES = 10 * 1024 * 1024;
const OVERWRITABLE_MEDIA_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0";
const ALLOWED_FONT_MIME_TYPES = new Set([
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/vnd.ms-fontobject",
]);
const ALLOWED_FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2", "eot"]);
const TEMPLATE_PREVIEW_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv", "avi"];
const TEMPLATE_PREVIEW_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
];

function sanitizeKind(value: unknown): "image" | "video" | "font" | "" {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "image" || kind === "video" || kind === "font") return kind;
  return "";
}

function sanitizeVariant(
  value: unknown
): "template-preview-video" | "template-preview-poster" | "" {
  const variant = String(value || "").trim().toLowerCase();
  if (variant === "template-preview-video") return "template-preview-video";
  if (variant === "template-preview-poster") return "template-preview-poster";
  return "";
}

function sanitizeTemplateId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .slice(0, 80);
}

function sanitizeFileName(value: unknown): string {
  const source = String(value || "").trim();
  const withoutPath = source.replace(/^.*[\\/]/, "");
  return withoutPath.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function normalizeMimeType(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function extensionFromMimeType(mimeType: string): string {
  const value = normalizeMimeType(mimeType);
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  if (value.includes("x-matroska")) return "mkv";
  if (value.includes("woff2")) return "woff2";
  if (value.includes("woff")) return "woff";
  if (value.includes("otf")) return "otf";
  if (value.includes("ttf")) return "ttf";
  if (value.includes("ms-fontobject")) return "eot";
  return "";
}

function extensionFromFileName(fileName: unknown): string {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1] || "";
}

function mimeTypeFromExtension(extension: unknown): string {
  const value = String(extension || "").trim().toLowerCase();
  if (value === "ttf") return "font/ttf";
  if (value === "otf") return "font/otf";
  if (value === "woff") return "font/woff";
  if (value === "woff2") return "font/woff2";
  if (value === "eot") return "application/vnd.ms-fontobject";
  return "";
}

function ensureValidUpload({
  kind,
  mimeType,
  size,
  extension,
}: {
  kind: string;
  mimeType: string;
  size: number;
  extension: string;
}): void {
  if (kind === "image") {
    if (!mimeType.startsWith("image/")) {
      throw new Error("Only image files are allowed for image uploads.");
    }
    // Reject SVG: it is an active document (can carry <script>) and is stored
    // and served raw, which would allow stored XSS on the app origin. The
    // editor works with raster media; vectors have their own import pipeline.
    if (
      mimeType.includes("svg") ||
      String(extension || "").trim().toLowerCase() === "svg"
    ) {
      throw new Error("SVG image uploads are not allowed.");
    }
    if (size > MAX_IMAGE_BYTES) {
      throw new Error("Image file is too large.");
    }
    return;
  }

  if (kind === "video") {
    if (!mimeType.startsWith("video/")) {
      throw new Error("Only video files are allowed for video uploads.");
    }
    if (size > MAX_VIDEO_BYTES) {
      throw new Error("Video file is too large.");
    }
    return;
  }

  if (kind === "font") {
    const safeExtension = String(extension || "").trim().toLowerCase();
    if (!ALLOWED_FONT_MIME_TYPES.has(mimeType) && !ALLOWED_FONT_EXTENSIONS.has(safeExtension)) {
      throw new Error("Unsupported font file type.");
    }
    if (size > MAX_FONT_BYTES) {
      throw new Error("Font file is too large.");
    }
    return;
  }

  throw new Error("Invalid upload kind.");
}

function makeObjectPath({
  ownerId,
  kind,
  fileName,
  extension,
}: {
  ownerId: string;
  kind: string;
  fileName: string;
  extension: string;
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeBase = sanitizeFileName(fileName).replace(/\.[^.]+$/, "") || kind;
  const ext = extension || "bin";
  const uniqueId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `users/${ownerId}/${kind}/${yyyy}/${mm}/${dd}/${safeBase}-${uniqueId}.${ext}`;
}

function makeTemplatePreviewObjectPath({
  ownerId,
  templateId,
  variant,
  extension,
}: {
  ownerId: string;
  templateId: string;
  variant: "template-preview-video" | "template-preview-poster";
  extension: string;
}): string {
  const safeTemplateId = sanitizeTemplateId(templateId) || "template";
  const safeExtension = String(extension || "").trim().toLowerCase() || "bin";
  const baseName = variant === "template-preview-video" ? "preview" : "poster";
  return `users/${ownerId}/templates/previews/${safeTemplateId}/${baseName}.${safeExtension}`;
}

function makeTemplatePreviewObjectPrefix({
  ownerId,
  templateId,
}: {
  ownerId: string;
  templateId: string;
}): string {
  const safeTemplateId = sanitizeTemplateId(templateId) || "template";
  return `users/${ownerId}/templates/previews/${safeTemplateId}/`;
}

function isTemplatePreviewVariantKey(
  key: string,
  variant: "template-preview-video" | "template-preview-poster"
): boolean {
  const fileName = String(key || "").split("/").pop()?.trim().toLowerCase() || "";
  if (!fileName) return false;
  if (variant === "template-preview-video") {
    return fileName.startsWith("preview.") || fileName.startsWith("preview-");
  }
  return fileName.startsWith("poster.") || fileName.startsWith("poster-");
}

function collectTemplatePreviewCleanupKeys({
  ownerId,
  templateId,
  variant,
  keepKey,
  previousUrl,
  siblingKeys,
}: {
  ownerId: string;
  templateId: string;
  variant: "template-preview-video" | "template-preview-poster";
  keepKey: string;
  previousUrl?: string | null;
  siblingKeys?: string[];
}): string[] {
  const extensions =
    variant === "template-preview-video"
      ? TEMPLATE_PREVIEW_VIDEO_EXTENSIONS
      : TEMPLATE_PREVIEW_IMAGE_EXTENSIONS;
  const keys = new Set<string>();

  for (const extension of extensions) {
    keys.add(
      makeTemplatePreviewObjectPath({
        ownerId,
        templateId,
        variant,
        extension,
      })
    );
  }

  const previousKey = parsePublicObjectKeyFromUrl(previousUrl);
  if (previousKey) {
    keys.add(previousKey);
  }

  for (const siblingKey of Array.isArray(siblingKeys) ? siblingKeys : []) {
    if (isTemplatePreviewVariantKey(siblingKey, variant)) {
      keys.add(String(siblingKey || "").trim());
    }
  }

  keys.delete(keepKey);
  return Array.from(keys);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:media:upload",
      identifier: session.userId || resolveRequestIp(request),
      limit: MEDIA_UPLOAD_LIMIT.limit,
      windowMs: MEDIA_UPLOAD_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many media uploads. Please retry shortly.",
        rateLimitState
      );
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return handleBadRequest("Invalid multipart form data");
    }

    const kind = sanitizeKind(formData.get("kind"));
    const variant = sanitizeVariant(formData.get("variant"));
    const templateId = sanitizeTemplateId(formData.get("templateId"));
    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return handleBadRequest("Missing file upload");
    }

    const mimeType = normalizeMimeType(fileEntry.type);
    const fileSize = Number(fileEntry.size || 0);
    if (!kind || fileSize <= 0) {
      return handleBadRequest("Invalid upload payload");
    }

    const fileName = sanitizeFileName(fileEntry.name) || `${kind}.bin`;
    const sourceExtension = extensionFromMimeType(mimeType) || extensionFromFileName(fileName);
    const resolvedMimeType = mimeType || mimeTypeFromExtension(sourceExtension);

    try {
      ensureValidUpload({
        kind,
        mimeType: resolvedMimeType,
        size: fileSize,
        extension: sourceExtension,
      });
    } catch (error) {
      return handleBadRequest(
        error instanceof Error ? error.message : "Invalid upload"
      );
    }

    // Buffer the upload up front. Passing a web File/Blob straight to the S3
    // PutObject Body makes the AWS SDK treat it as a flowing ReadableStream it
    // can't hash ("Unable to calculate hash for flowing readable stream"), which
    // broke default image uploads (e.g. merging layers). A Buffer has a known
    // length, so the checksum/signature can be computed.
    let uploadBody: Buffer = Buffer.from(await fileEntry.arrayBuffer());
    let uploadMimeType = resolvedMimeType || "application/octet-stream";
    let uploadSize = fileSize;
    let templatePreviewContext:
      | null
      | {
          ownerId: string;
          previousUrl: string | null;
        } = null;

    if (variant === "template-preview-video" || variant === "template-preview-poster") {
      if (!templateId) {
        return handleBadRequest("Missing templateId for preview upload");
      }

      const template = await prisma.template.findUnique({
        where: { id: templateId },
        select: {
          id: true,
          ownerId: true,
          previewVideoUrl: true,
          previewPosterUrl: true,
        },
      });
      if (!template) {
        return handleBadRequest("Template not found for preview upload");
      }
      // Shared library: any dashboard user may replace another user's preview.
      // See canAccessTemplate in lib/templates/server.js.
      templatePreviewContext = {
        ownerId: String(template.ownerId || "").trim() || session.userId,
        previousUrl:
          variant === "template-preview-video"
            ? String(template.previewVideoUrl || "").trim() || null
            : String(template.previewPosterUrl || "").trim() || null,
      };

      const sourceBytes = uploadBody;
      if (variant === "template-preview-video" && kind === "video") {
        const optimized = await resizeVideoPreviewBuffer({
          bytes: sourceBytes,
          mimeType: uploadMimeType,
        });
        uploadBody = optimized.bytes;
        uploadMimeType = optimized.mimeType || uploadMimeType;
        uploadSize = Buffer.byteLength(optimized.bytes);
      } else if (variant === "template-preview-poster" && kind === "image") {
        const resized = await resizeThumbnailBufferHalf({
          bytes: sourceBytes,
          mimeType: uploadMimeType,
        });
        uploadBody = resized.bytes;
        uploadMimeType = resized.mimeType || uploadMimeType;
        uploadSize = Buffer.byteLength(resized.bytes);
      }
    }

    const extension =
      extensionFromMimeType(uploadMimeType) || sourceExtension || extensionFromFileName(fileName);

    const path = templatePreviewContext
      ? makeTemplatePreviewObjectPath({
          ownerId: templatePreviewContext.ownerId,
          templateId,
          variant,
          extension,
        })
      : makeObjectPath({
          ownerId: session.userId,
          kind,
          fileName,
          extension,
        });

    const uploaded = await uploadObject({
      bucket: BUCKET_NAME,
      key: path,
      body: uploadBody,
      cacheControl: templatePreviewContext
        ? OVERWRITABLE_MEDIA_CACHE_CONTROL
        : "public, max-age=31536000, immutable",
      contentType: uploadMimeType || "application/octet-stream",
      upsert: Boolean(templatePreviewContext),
      skipExistenceCheck: !templatePreviewContext,
    });
    const url = String(uploaded.url || "").trim();
    if (!url) {
      return handleApiError(
        new Error("Media URL unavailable"),
        "Upload succeeded but media URL is unavailable",
        500
      );
    }

    logger.info("Media uploaded", {
      userId: session.userId,
      kind,
      size: uploadSize,
      variant: variant || null,
    });

    if (templatePreviewContext && variant) {
      const previewPrefix = makeTemplatePreviewObjectPrefix({
        ownerId: templatePreviewContext.ownerId,
        templateId,
      });
      listObjectKeys(BUCKET_NAME, { prefix: previewPrefix })
        .then((siblingKeys) =>
          collectTemplatePreviewCleanupKeys({
            ownerId: templatePreviewContext.ownerId,
            templateId,
            variant,
            keepKey: path,
            previousUrl: templatePreviewContext.previousUrl,
            siblingKeys,
          })
        )
        .then((cleanupKeys) => {
          if (cleanupKeys.length === 0) return;
          return deleteObjects(BUCKET_NAME, cleanupKeys);
        })
        .catch((error) => {
          logger.warn("Failed to clean up previous template preview media", {
            userId: session.userId,
            templateId,
            variant,
            error: error instanceof Error ? error.message : String(error || ""),
          });
        });
    }

    return NextResponse.json({
      kind,
      bucket: BUCKET_NAME,
      path,
      publicUrl: url,
      url: rewritePublicObjectUrlForClient(url),
      mimeType: uploadMimeType,
      size: uploadSize,
      fileName,
    });
  } catch (error) {
    return handleApiError(error, "Failed to upload media");
  }
}
