import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { normalizePaletteForPublish, getPublishableSkipReason, inferPublishSource, tokenizeElementName } from "@/lib/editor/publishableElements";
import { upsertImportedElementAsset } from "@/lib/editor/importedElements.server";
import { logger } from "@/lib/logging/logger";
import {
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { getEditorSession } from "@/lib/templates/server";
import { translateBatchToArabic } from "@/lib/tools/arabicTranslate.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET_NAME = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface PublishElement {
  id: string;
  type?: string;
  name?: string;
  src?: string;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  rasterOriginalSrc?: string;
  rasterPalette?: string[];
  rasterPaletteVersion?: number;
  rasterColorMap?: Record<string, string>;
  isBackgroundLayer?: boolean;
  importNodeId?: string;
  importParentId?: string | null;
  importKind?: string;
  importZIndex?: number;
  sourceAssetId?: string;
  titleEn?: string;
  titleAr?: string;
  tagsEn?: string[];
  tagsAr?: string[];
  labelsEn?: string[];
  labelsAr?: string[];
  fallback?: boolean;
  fallbackReason?: string;
}

interface PublishPage {
  id: string;
  width?: number;
  height?: number;
  elements?: PublishElement[];
}

function sanitizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeUrl(value: unknown): string {
  const source = sanitizeText(value);
  if (!source) return "";
  if (source.startsWith("data:")) return source;
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const raw = sanitizeText(dataUrl);
  if (!raw.startsWith("data:")) return null;
  const commaIndex = raw.indexOf(",");
  if (commaIndex <= 5) return null;
  const meta = raw.slice(5, commaIndex);
  if (!/;base64/i.test(meta)) return null;
  const mimeType = sanitizeText(meta.split(";")[0] || "image/png").toLowerCase();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw.slice(commaIndex + 1), "base64");
  } catch {
    return null;
  }
  return { mimeType, buffer };
}

function extensionFromMimeType(mimeType: string): string {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  return "png";
}

function makeObjectPath(ownerId: string, baseName: string, mimeType: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeBase = sanitizeText(baseName)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "element";
  const ext = extensionFromMimeType(mimeType);
  const unique =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `users/${ownerId}/elements/editor/${yyyy}/${mm}/${dd}/${safeBase}-${unique}.${ext}`;
}

async function uploadDataUrlToStorage(dataUrl: string, ownerId: string, baseName: string): Promise<string> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("Invalid image data URL.");
  }
  if (!parsed.mimeType.startsWith("image/")) {
    throw new Error("Only image data URLs can be published.");
  }
  if (!parsed.buffer || parsed.buffer.length === 0) {
    throw new Error("Image data is empty.");
  }
  if (parsed.buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large to publish.");
  }

  const path = makeObjectPath(ownerId, baseName, parsed.mimeType);
  const uploaded = await uploadObject({
    bucket: BUCKET_NAME,
    key: path,
    body: parsed.buffer,
    contentType: parsed.mimeType,
    cacheControl: "public, max-age=31536000, immutable",
    upsert: false,
    skipExistenceCheck: true,
  });
  const publicUrl = sanitizeText(uploaded.url);
  if (!publicUrl) {
    throw new Error("Published element URL is unavailable.");
  }
  return publicUrl;
}

function resolveElementAssetSource(element: PublishElement): string {
  return sanitizeUrl(element.rasterOriginalSrc) || sanitizeUrl(element.src);
}

function buildSourceAssetId(element: PublishElement, templateId: string, assetUrl: string): string {
  const explicitSourceAssetId = sanitizeText(element.sourceAssetId);
  if (explicitSourceAssetId) {
    return explicitSourceAssetId;
  }
  const explicit = sanitizeText(element.importNodeId || element.importParentId);
  if (explicit) {
    return `editor-node:${sanitizeText(templateId || "unsaved")}:${explicit}`;
  }
  const seed = [
    sanitizeText(templateId || "unsaved"),
    sanitizeText(element.name || "Image"),
    sanitizeText(assetUrl),
    String(Math.round(Number(element.width || 0))),
    String(Math.round(Number(element.height || 0))),
  ].join("::");
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `editor-${digest}`;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => sanitizeText(value))
        .filter(Boolean)
    )
  );
}

function buildElementMetadata(element: PublishElement) {
  const titleEn = sanitizeText(element.titleEn || element.name) || "Image";
  const explicitTagsEn = uniqueStrings(Array.isArray(element.tagsEn) ? element.tagsEn : []);
  const tagsEn =
    explicitTagsEn.length > 0 ? explicitTagsEn : uniqueStrings(tokenizeElementName(titleEn));
  const explicitLabelsEn = uniqueStrings(Array.isArray(element.labelsEn) ? element.labelsEn : []);
  const labelsEn =
    explicitLabelsEn.length > 0 ? explicitLabelsEn : uniqueStrings([titleEn, ...tagsEn]);
  const explicitTitleAr = sanitizeText(element.titleAr);
  const explicitTagsAr = uniqueStrings(Array.isArray(element.tagsAr) ? element.tagsAr : []);
  const explicitLabelsAr = uniqueStrings(Array.isArray(element.labelsAr) ? element.labelsAr : []);
  return { titleEn, tagsEn, labelsEn, explicitTitleAr, explicitTagsAr, explicitLabelsAr };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return handleBadRequest("Invalid JSON body");
    }

    const templateId = sanitizeText(body?.templateId);
    const pageId = sanitizeText(body?.pageId || body?.design?.activePageId);
    const designPages = Array.isArray(body?.design?.pages) ? (body.design.pages as PublishPage[]) : [];
    const elementIds = Array.isArray(body?.elementIds)
      ? Array.from(new Set(body.elementIds.map((value: unknown) => sanitizeText(value)).filter(Boolean)))
      : [];

    if (!pageId || designPages.length === 0 || elementIds.length === 0) {
      return handleBadRequest("Missing page, design, or selected elements to publish.");
    }

    const page = designPages.find((entry) => sanitizeText(entry?.id) === pageId) || null;
    if (!page) {
      return handleBadRequest("The selected page could not be found.");
    }

    const allElements = Array.isArray(page.elements) ? page.elements : [];
    const selectedElements = allElements.filter((element) => elementIds.includes(sanitizeText(element?.id)));
    if (selectedElements.length === 0) {
      return handleBadRequest("No selected elements were found on the active page.");
    }

    const textInputs = new Set<string>();
    const metadataByElementId = new Map<
      string,
      {
        titleEn: string;
        tagsEn: string[];
        labelsEn: string[];
        explicitTitleAr: string;
        explicitTagsAr: string[];
        explicitLabelsAr: string[];
      }
    >();
    selectedElements.forEach((element) => {
      const metadata = buildElementMetadata(element);
      metadataByElementId.set(sanitizeText(element.id), metadata);
      textInputs.add(metadata.titleEn);
      metadata.tagsEn.forEach((tag) => textInputs.add(tag));
      metadata.labelsEn.forEach((label) => textInputs.add(label));
    });

    const translations = await translateBatchToArabic(Array.from(textInputs));

    const published: Array<{ elementId: string; assetId: string; source: string; status: string }> = [];
    const skipped: Array<{ elementId: string; reason: string }> = [];

    for (const element of selectedElements) {
      const elementId = sanitizeText(element.id);
      const skipReason = getPublishableSkipReason(element as never, page as never);
      if (skipReason) {
        skipped.push({ elementId, reason: skipReason });
        continue;
      }

      let assetUrl = resolveElementAssetSource(element);
      if (!assetUrl) {
        skipped.push({ elementId, reason: "missing-source" });
        continue;
      }

      if (assetUrl.startsWith("data:")) {
        assetUrl = await uploadDataUrlToStorage(assetUrl, session.userId, sanitizeText(element.name) || "element");
      }

      const metadata = metadataByElementId.get(elementId) || buildElementMetadata(element);
      const titleAr = sanitizeText(
        metadata.explicitTitleAr || translations.get(metadata.titleEn) || metadata.titleEn
      );
      const tagsAr = uniqueStrings(
        metadata.explicitTagsAr.length > 0
          ? metadata.explicitTagsAr
          : metadata.tagsEn.map((tag) => translations.get(tag) || tag)
      );
      const labelsAr = uniqueStrings(
        metadata.explicitLabelsAr.length > 0
          ? metadata.explicitLabelsAr
          : metadata.labelsEn.map((label) => translations.get(label) || label)
      );
      const translationStatus =
        Boolean(metadata.explicitTitleAr) ||
        metadata.explicitTagsAr.length > 0 ||
        titleAr !== metadata.titleEn ||
        tagsAr.some((tag, index) => tag !== metadata.tagsEn[index])
          ? "translated"
          : "fallback";

      const result = await upsertImportedElementAsset({
        source: inferPublishSource(element as never),
        sourceAssetId: buildSourceAssetId(element, templateId, assetUrl),
        ownerId: session.userId,
        kind: "image",
        titleEn: metadata.titleEn,
        titleAr,
        tagsEn: metadata.tagsEn,
        tagsAr,
        labelsEn: metadata.labelsEn,
        labelsAr,
        assetUrl,
        thumbnailUrl: assetUrl,
        width: Number.isFinite(Number(element.width)) ? Number(element.width) : null,
        height: Number.isFinite(Number(element.height)) ? Number(element.height) : null,
        freeSvg: false,
        translationStatus,
        sourcePayload: {
          templateId,
          pageId,
          elementId,
          importNodeId: sanitizeText(element.importNodeId),
          importParentId: sanitizeText(element.importParentId),
          importKind: sanitizeText(element.importKind),
          importZIndex: Number.isFinite(Number(element.importZIndex)) ? Number(element.importZIndex) : null,
          fallback: Boolean(element.fallback),
          fallbackReason: sanitizeText(element.fallbackReason),
          rasterOriginalSrc: assetUrl,
          rasterPalette: normalizePaletteForPublish(element.rasterPalette),
          rasterPaletteVersion: Math.max(0, Number(element.rasterPaletteVersion || 0)),
          rasterColorMap:
            element.rasterColorMap && typeof element.rasterColorMap === "object" && !Array.isArray(element.rasterColorMap)
              ? element.rasterColorMap
              : {},
        },
      });

      published.push({
        elementId,
        assetId: String(result?.id || ""),
        source: String(result?.source || inferPublishSource(element as never)),
        status: result?.id ? "upserted" : "unknown",
      });
    }

    logger.info("Published canvas elements to imported library", {
      userId: session.userId,
      templateId,
      pageId,
      requestedCount: elementIds.length,
      publishedCount: published.length,
      skippedCount: skipped.length,
    });

    return NextResponse.json({ ok: true, published, skipped }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to publish elements",
      422
    );
  }
}
