/**
 * Where a template's preview video and poster live in object storage, and how they get there.
 *
 * Both assets sit under one fixed key per template (`.../previews/<templateId>/preview.mp4`,
 * `.../poster.webp`) and are overwritten in place, so the encode route can store what it just
 * produced without a second trip through the browser, and the generic media upload route can
 * store a preview a client hands it. Either way the previous objects of that variant are swept
 * in the background once the new one is up.
 */
import { logger } from "@/lib/logging/logger";
import { resizeThumbnailBufferHalf } from "@/lib/media/thumbnailResize.server";
import prisma from "@/lib/prisma";
import {
  deleteObjects,
  getPublicStorageBucketName,
  listObjectKeys,
  parsePublicObjectKeyFromUrl,
  rewritePublicObjectUrlForClient,
  uploadObject,
} from "@/lib/storage/objectStorage.server";

export type TemplatePreviewVariant = "template-preview-video" | "template-preview-poster";

export const TEMPLATE_PREVIEW_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv", "avi"];
export const TEMPLATE_PREVIEW_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];
/** A preview is overwritten under the same key every time it is recorded, so nothing may cache it. */
export const OVERWRITABLE_MEDIA_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0";

export interface TemplatePreviewTarget {
  templateId: string;
  ownerId: string;
  previousVideoUrl: string | null;
  previousPosterUrl: string | null;
}

export interface StoredTemplatePreviewAsset {
  /** The storage key. */
  path: string;
  /** The object's own URL, as stored on the template. */
  publicUrl: string;
  /** The URL a browser can load (the public proxy; the bucket has no CORS). */
  url: string;
  mimeType: string;
  size: number;
}

export function sanitizeTemplatePreviewVariant(value: unknown): TemplatePreviewVariant | "" {
  const variant = String(value || "").trim().toLowerCase();
  if (variant === "template-preview-video") return "template-preview-video";
  if (variant === "template-preview-poster") return "template-preview-poster";
  return "";
}

export function sanitizeTemplateId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .slice(0, 80);
}

export function makeTemplatePreviewObjectPath({
  ownerId,
  templateId,
  variant,
  extension,
}: {
  ownerId: string;
  templateId: string;
  variant: TemplatePreviewVariant;
  extension: string;
}): string {
  const safeTemplateId = sanitizeTemplateId(templateId) || "template";
  const safeExtension = String(extension || "").trim().toLowerCase() || "bin";
  const baseName = variant === "template-preview-video" ? "preview" : "poster";
  return `users/${ownerId}/templates/previews/${safeTemplateId}/${baseName}.${safeExtension}`;
}

export function makeTemplatePreviewObjectPrefix({
  ownerId,
  templateId,
}: {
  ownerId: string;
  templateId: string;
}): string {
  const safeTemplateId = sanitizeTemplateId(templateId) || "template";
  return `users/${ownerId}/templates/previews/${safeTemplateId}/`;
}

export function isTemplatePreviewVariantKey(key: string, variant: TemplatePreviewVariant): boolean {
  const fileName = String(key || "").split("/").pop()?.trim().toLowerCase() || "";
  if (!fileName) return false;
  if (variant === "template-preview-video") {
    return fileName.startsWith("preview.") || fileName.startsWith("preview-");
  }
  return fileName.startsWith("poster.") || fileName.startsWith("poster-");
}

export function collectTemplatePreviewCleanupKeys({
  ownerId,
  templateId,
  variant,
  keepKey,
  previousUrl,
  siblingKeys,
}: {
  ownerId: string;
  templateId: string;
  variant: TemplatePreviewVariant;
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
    keys.add(makeTemplatePreviewObjectPath({ ownerId, templateId, variant, extension }));
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

/**
 * The template a preview is being stored for: who owns it (its objects live under the owner,
 * whoever records) and what it currently points at (swept once the new asset is up). Null when
 * there is no such template.
 *
 * Shared library: any dashboard user may replace another user's preview — see canAccessTemplate
 * in lib/templates/server.js.
 */
export async function resolveTemplatePreviewTarget(
  templateId: string,
  fallbackOwnerId: string
): Promise<TemplatePreviewTarget | null> {
  const safeTemplateId = sanitizeTemplateId(templateId);
  if (!safeTemplateId) return null;
  const template = await prisma.template.findUnique({
    where: { id: safeTemplateId },
    select: { id: true, ownerId: true, previewVideoUrl: true, previewPosterUrl: true },
  });
  if (!template) return null;
  return {
    templateId: safeTemplateId,
    ownerId: String(template.ownerId || "").trim() || fallbackOwnerId,
    previousVideoUrl: String(template.previewVideoUrl || "").trim() || null,
    previousPosterUrl: String(template.previewPosterUrl || "").trim() || null,
  };
}

function extensionForPreviewMimeType(mimeType: string, variant: TemplatePreviewVariant): string {
  const value = String(mimeType || "").trim().toLowerCase();
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  if (value.includes("avif")) return "avif";
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  if (value.includes("x-matroska")) return "mkv";
  return variant === "template-preview-video" ? "mp4" : "png";
}

/**
 * Stores one preview asset under its template and sweeps that variant's previous objects. A
 * poster is first brought down to the thumbnail size and WebP (resizeThumbnailBufferHalf); a
 * video is stored as given.
 */
export async function storeTemplatePreviewAsset({
  target,
  variant,
  bytes,
  mimeType,
  actorUserId,
}: {
  target: TemplatePreviewTarget;
  variant: TemplatePreviewVariant;
  bytes: Buffer;
  mimeType: string;
  /** Who is recording, for the logs. */
  actorUserId: string;
}): Promise<StoredTemplatePreviewAsset> {
  const bucket = getPublicStorageBucketName();
  let body = bytes;
  let storedMimeType = String(mimeType || "").trim().toLowerCase() || "application/octet-stream";

  if (variant === "template-preview-poster") {
    const resized = await resizeThumbnailBufferHalf({ bytes, mimeType: storedMimeType });
    body = resized.bytes;
    storedMimeType = resized.mimeType || storedMimeType;
  }

  const path = makeTemplatePreviewObjectPath({
    ownerId: target.ownerId,
    templateId: target.templateId,
    variant,
    extension: extensionForPreviewMimeType(storedMimeType, variant),
  });
  const uploaded = await uploadObject({
    bucket,
    key: path,
    body,
    cacheControl: OVERWRITABLE_MEDIA_CACHE_CONTROL,
    contentType: storedMimeType,
    upsert: true,
  });
  const publicUrl = String(uploaded.url || "").trim();
  if (!publicUrl) {
    throw new Error("Upload succeeded but media URL is unavailable");
  }

  logger.info("Template preview asset stored", {
    userId: actorUserId,
    templateId: target.templateId,
    variant,
    size: body.length,
    mimeType: storedMimeType,
  });

  // Sweep in the background: the response must not wait on a listing, and a failed sweep only
  // leaves a stale object behind.
  listObjectKeys(bucket, {
    prefix: makeTemplatePreviewObjectPrefix({ ownerId: target.ownerId, templateId: target.templateId }),
  })
    .then((siblingKeys: string[]) =>
      collectTemplatePreviewCleanupKeys({
        ownerId: target.ownerId,
        templateId: target.templateId,
        variant,
        keepKey: path,
        previousUrl:
          variant === "template-preview-video" ? target.previousVideoUrl : target.previousPosterUrl,
        siblingKeys,
      })
    )
    .then((cleanupKeys: string[]) => {
      if (cleanupKeys.length === 0) return undefined;
      return deleteObjects(bucket, cleanupKeys);
    })
    .catch((error: unknown) => {
      logger.warn("Failed to clean up previous template preview media", {
        userId: actorUserId,
        templateId: target.templateId,
        variant,
        error: error instanceof Error ? error.message : String(error || ""),
      });
    });

  return {
    path,
    publicUrl,
    url: rewritePublicObjectUrlForClient(publicUrl),
    mimeType: storedMimeType,
    size: body.length,
  };
}
