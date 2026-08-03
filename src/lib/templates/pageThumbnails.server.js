import { createLogger } from "@/lib/logging/logger";
import { resizeThumbnailBufferHalf } from "@/lib/media/thumbnailResize.server";
import {
  getTemplateThumbnailBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";

const logger = createLogger("templates.page-thumbnails");

const MAX_PAGE_THUMBNAIL_BYTES = 12 * 1024 * 1024;
// Same policy as the cover thumbnail: the object path is stable per page, so a re-save
// overwrites it and clients must be able to pick the new bytes up quickly.
const PAGE_THUMBNAIL_CACHE_CONTROL = "public, max-age=60, must-revalidate";

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extensionFor(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpg":
    case "image/jpeg":
    default:
      return "jpg";
  }
}

function parseImageDataUrl(value) {
  const match = String(value || "")
    .trim()
    .match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  try {
    return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
  } catch (_error) {
    return null;
  }
}

export function makeTemplatePageThumbnailKey(ownerId, templateId, pageId, mimeType) {
  const safeOwner = sanitizeSegment(ownerId) || "owner";
  const safeTemplate = sanitizeSegment(templateId) || "template";
  const safePage = sanitizeSegment(pageId) || "page";
  return `users/${safeOwner}/templates/thumbnails/${safeTemplate}/pages/${safePage}.${extensionFor(mimeType)}`;
}

/**
 * Uploads `{ [pageId]: dataUrlOrUrl }` page previews and returns `{ [pageId]: publicUrl }`.
 *
 * Already-hosted URLs pass through. A page whose upload fails is dropped rather than throwing —
 * a missing page preview only means the client renders that tile itself, and must never fail
 * the save/import that carried it.
 */
export async function uploadTemplatePageThumbnails({ pageThumbnails, ownerId, templateId }) {
  const source =
    pageThumbnails && typeof pageThumbnails === "object" && !Array.isArray(pageThumbnails)
      ? pageThumbnails
      : null;
  if (!source || !ownerId || !templateId) return null;

  const bucket = getTemplateThumbnailBucketName();
  const resolved = {};

  for (const [rawPageId, rawValue] of Object.entries(source)) {
    const pageId = String(rawPageId || "").trim();
    const value = String(rawValue || "").trim();
    if (!pageId || !value) continue;

    if (!value.startsWith("data:")) {
      if (/^https?:\/\//i.test(value)) resolved[pageId] = value;
      continue;
    }

    const parsed = parseImageDataUrl(value);
    if (!parsed || !parsed.buffer.length) continue;
    if (parsed.buffer.length > MAX_PAGE_THUMBNAIL_BYTES) continue;

    try {
      let bytes = parsed.buffer;
      let mimeType = parsed.mimeType;
      const resized = await resizeThumbnailBufferHalf({ bytes, mimeType });
      if (resized.resized) {
        bytes = resized.bytes;
        mimeType = resized.mimeType;
      }
      const key = makeTemplatePageThumbnailKey(ownerId, templateId, pageId, mimeType);
      const uploaded = await uploadObject({
        bucket,
        key,
        body: bytes,
        contentType: mimeType,
        cacheControl: PAGE_THUMBNAIL_CACHE_CONTROL,
        upsert: true,
      });
      const publicUrl = String(uploaded?.url || "").trim();
      if (publicUrl) resolved[pageId] = publicUrl;
    } catch (error) {
      logger.warn("Failed to upload template page thumbnail", {
        templateId,
        pageId,
        error: error instanceof Error ? error.message : String(error || ""),
      });
    }
  }

  return Object.keys(resolved).length > 0 ? resolved : null;
}
