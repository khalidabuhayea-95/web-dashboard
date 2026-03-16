import prisma from "@/lib/prisma";
import { resizeThumbnailDataUrlHalf } from "@/lib/media/thumbnailResize.server";
import { extractFabricData } from "@/lib/templates/editorData";
import { buildSnapshot, normalizeSlug } from "@/lib/templates/server";
import {
  attachImportMetadataToFabricData,
  readImportMetadataFromEditorData,
} from "@/lib/tools/importParity";
import { findExternalCanvaReferences } from "@/lib/tools/importAssetSanitizer";

function numberClamp(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function sanitizeDataUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (input.startsWith("data:image/") || input.startsWith("data:video/")) {
    if (!input.includes(",")) return "";
    return input;
  }
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

export function buildFabricData(snapshotDataUrl, canvasWidth, canvasHeight, sourceWidth, sourceHeight) {
  const resolvedSourceWidth = Math.max(1, Math.round(sourceWidth || canvasWidth));
  const resolvedSourceHeight = Math.max(1, Math.round(sourceHeight || canvasHeight));
  const scaleX = canvasWidth / resolvedSourceWidth;
  const scaleY = canvasHeight / resolvedSourceHeight;

  return {
    version: "7.0.0",
    objects: [
      {
        type: "Image",
        version: "7.0.0",
        originX: "left",
        originY: "top",
        left: 0,
        top: 0,
        width: resolvedSourceWidth,
        height: resolvedSourceHeight,
        scaleX,
        scaleY,
        angle: 0,
        opacity: 1,
        src: snapshotDataUrl,
        layerType: "image",
        layerName: "Imported Canva Snapshot",
        layerLocked: false,
        layerHidden: false,
        sourceWidth: resolvedSourceWidth,
        sourceHeight: resolvedSourceHeight,
      },
    ],
  };
}

async function ensureUniqueSlug(baseSlug) {
  const base = normalizeSlug(baseSlug) || `canva-import-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (true) {
    const existing = await prisma.template.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    counter += 1;
    candidate = `${base}-${counter}`;
  }
}

async function ensureUniqueName(ownerId, baseName) {
  const normalized = String(baseName || "").trim() || `Imported Canva Template ${new Date().toISOString().slice(0, 10)}`;
  let candidate = normalized;
  let counter = 1;

  while (true) {
    const existing = await prisma.template.findFirst({
      where: { ownerId, name: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    counter += 1;
    candidate = `${normalized} (${counter})`;
  }
}

export function normalizeCanvasInput({ width, height, sourceWidth, sourceHeight, maxDimension = 1920 }) {
  const rawWidth = numberClamp(width, 1080, 1, 8192);
  const rawHeight = numberClamp(height, 1080, 1, 8192);
  const rawSourceWidth = numberClamp(sourceWidth, rawWidth, 1, 8192);
  const rawSourceHeight = numberClamp(sourceHeight, rawHeight, 1, 8192);
  const limit = numberClamp(maxDimension, 1920, 320, 4096);
  const downscale = Math.min(1, limit / Math.max(rawWidth, rawHeight));

  return {
    canvasWidth: Math.max(1, Math.round(rawWidth * downscale)),
    canvasHeight: Math.max(1, Math.round(rawHeight * downscale)),
    sourceWidth: rawSourceWidth,
    sourceHeight: rawSourceHeight,
  };
}

export async function createImportedTemplate({
  ownerId,
  imageDataUrl,
  thumbnailDataUrl,
  fabricData,
  editorData,
  name,
  slug,
  canvasWidth,
  canvasHeight,
  sourceWidth,
  sourceHeight,
  tags = ["canva", "imported"],
  action = "import-canva",
  importMetadata,
}) {
  const sanitizedImageSource = sanitizeDataUrl(imageDataUrl);
  const rawThumbnailSource = sanitizeDataUrl(thumbnailDataUrl || imageDataUrl);
  const sanitizedThumbnailSource = rawThumbnailSource.startsWith("data:image/")
    ? await resizeThumbnailDataUrlHalf(rawThumbnailSource)
    : rawThumbnailSource;
  const incomingFabricData = extractFabricData(editorData) || extractFabricData(fabricData);
  const hasFabricData = Boolean(incomingFabricData && Array.isArray(incomingFabricData.objects) && incomingFabricData.objects.length > 0);

  if (!hasFabricData && !sanitizedImageSource) {
    throw new Error("Invalid import payload. Missing template data.");
  }
  if (sanitizedImageSource.startsWith("data:") && sanitizedImageSource.length > 28_000_000) {
    throw new Error("Image payload is too large.");
  }
  if (sanitizedThumbnailSource.startsWith("data:") && sanitizedThumbnailSource.length > 28_000_000) {
    throw new Error("Thumbnail payload is too large.");
  }
  if (!ownerId) {
    throw new Error("Missing owner id.");
  }

  const uniqueName = await ensureUniqueName(ownerId, name);
  const uniqueSlug = await ensureUniqueSlug(slug || uniqueName);
  const baseData = hasFabricData
    ? incomingFabricData
    : buildFabricData(sanitizedImageSource, canvasWidth, canvasHeight, sourceWidth, sourceHeight);
  const metadataFromEditor = readImportMetadataFromEditorData(editorData);
  const data = attachImportMetadataToFabricData(baseData, importMetadata || metadataFromEditor);
  const disallowedCanvaReferences = findExternalCanvaReferences(
    {
      data,
      thumbnailDataUrl: sanitizedThumbnailSource,
    },
    { pathPrefix: "template", maxResults: 1, assetFieldsOnly: true }
  );
  if (disallowedCanvaReferences.length > 0) {
    throw new Error(
      `External Canva asset references are not allowed (${disallowedCanvaReferences[0].path}).`
    );
  }

  const serializedDataLength = JSON.stringify(data).length;
  if (serializedDataLength > 30_000_000) {
    throw new Error("Template payload is too large.");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.template.create({
      data: {
        ownerId,
        name: uniqueName,
        slug: uniqueSlug,
        status: "draft",
        canvasSize: { width: canvasWidth, height: canvasHeight },
        category: "general",
        subCategory: "general",
        tags,
        thumbnailDataUrl: sanitizedThumbnailSource || null,
        data,
      },
    });

    await tx.templateRevision.create({
      data: {
        templateId: created.id,
        version: created.version,
        action,
        actorId: ownerId,
        snapshot: buildSnapshot(created),
      },
    });

    return created;
  });
}
