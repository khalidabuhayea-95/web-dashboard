import { randomBytes, randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";
import { resizeThumbnailDataUrlHalf } from "@/lib/media/thumbnailResize.server";
import { fitImportedAnimationsToCategories } from "@/lib/editor/animationSlotFit";
import { extractFabricData } from "@/lib/templates/editorData";
import { uploadTemplatePageThumbnails } from "@/lib/templates/pageThumbnails.server";
import { buildSnapshot, normalizeSlug } from "@/lib/templates/serverCore";
import {
  attachImportMetadataToFabricData,
  readImportMetadataFromEditorData,
} from "@/lib/tools/importParity";
import { findExternalCanvaReferences } from "@/lib/tools/importAssetSanitizer";

const DEFAULT_IMPORT_PLACEMENTS = [{ category: "general", subCategory: "general" }];

/**
 * Where a newly imported template is filed: wherever the owner filed the one before it.
 *
 * Imports arrive in batches — a dozen Canva stories in a row — and every one of them used to land
 * on general/general, so the same two dropdowns had to be re-picked for each. The most recently
 * touched template IS "the previous one" in the only sense that matters here, and its placements
 * were already validated against the taxonomy when it was saved, so they are copied as they stand.
 * A first-ever import, or any lookup trouble, falls back to general.
 */
async function resolveImportPlacements(ownerId) {
  if (!ownerId) return DEFAULT_IMPORT_PLACEMENTS;
  try {
    const previous = await prisma.template.findFirst({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      select: { category: true, subCategory: true, categories: true },
    });
    const pairs = Array.isArray(previous?.categories) ? previous.categories : [];
    const cleaned = pairs
      .map((pair) => ({
        category: String(pair?.category || "").trim().toLowerCase(),
        subCategory: String(pair?.subCategory || "").trim().toLowerCase(),
      }))
      .filter((pair) => Boolean(pair.category) && Boolean(pair.subCategory));
    if (cleaned.length > 0) return cleaned;

    // Older rows predate the placements array and carry only the scalar pair.
    const category = String(previous?.category || "").trim().toLowerCase();
    const subCategory = String(previous?.subCategory || "").trim().toLowerCase();
    if (category && subCategory) return [{ category, subCategory }];
  } catch (_error) {
    // Inheriting a placement is a convenience; it must never be the reason an import fails.
  }
  return DEFAULT_IMPORT_PLACEMENTS;
}

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

// Cap the collision walk to avoid unbounded sequential DB round-trips on import;
// the unique constraint on `slug` is the final backstop after the random suffix.
const MAX_UNIQUENESS_ATTEMPTS = 25;

async function ensureUniqueSlug(baseSlug) {
  const base = normalizeSlug(baseSlug) || `canva-import-${Date.now()}`;
  let candidate = base;

  for (let counter = 1; counter <= MAX_UNIQUENESS_ATTEMPTS; counter += 1) {
    const existing = await prisma.template.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${base}-${counter + 1}`;
  }

  return `${base}-${randomBytes(4).toString("hex")}`;
}

async function ensureUniqueName(ownerId, baseName) {
  const normalized = String(baseName || "").trim() || `Imported Canva Template ${new Date().toISOString().slice(0, 10)}`;
  let candidate = normalized;

  for (let counter = 1; counter <= MAX_UNIQUENESS_ATTEMPTS; counter += 1) {
    const existing = await prisma.template.findFirst({
      where: { ownerId, name: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${normalized} (${counter + 1})`;
  }

  return `${normalized} (${randomBytes(3).toString("hex")})`;
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
  pageThumbnails = null,
  /** Explicit placements win; otherwise the import inherits the previous template's. */
  categories = null,
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

  // Canva's effects have no one-for-one equivalent here, so the importer maps each preset onto the
  // closest one by feel. That says nothing about WHICH tab the result belongs to, and the tabs are
  // not interchangeable — Rise, Pan, Drift and friends are Loop and Exit effects here, never
  // entrances. A Canva entrance mapped onto Rise landed in the Entrance slot holding something that
  // tab does not offer: unselectable in the editor, and an entrance the app does not list either.
  // This is the second half of the mapping — the closest effect the tab actually offers — and it
  // runs on the server so an older extension build cannot route around it.
  const refittedAnimations = fitImportedAnimationsToCategories(data);
  if (refittedAnimations > 0 && importMetadata && typeof importMetadata === "object") {
    importMetadata.refittedAnimations = refittedAnimations;
  }
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

  const importPages =
    data?.meta?.import?.pages && Array.isArray(data.meta.import.pages)
      ? data.meta.import.pages
      : null;
  const pageCount = importPages && importPages.length > 1 ? importPages.length : 1;

  // Upload per-page previews BEFORE the row exists so the id is stable: mint it here rather
  // than letting the DB default it, and reuse it for both the object keys and the insert.
  const templateId = randomUUID();
  const storedPageThumbnails = await uploadTemplatePageThumbnails({
    pageThumbnails,
    ownerId,
    templateId,
  });

  const explicitPlacements = (Array.isArray(categories) ? categories : [])
    .map((pair) => ({
      category: String(pair?.category || "").trim().toLowerCase(),
      subCategory: String(pair?.subCategory || "").trim().toLowerCase(),
    }))
    .filter((pair) => Boolean(pair.category) && Boolean(pair.subCategory));
  const placements =
    explicitPlacements.length > 0 ? explicitPlacements : await resolveImportPlacements(ownerId);

  return prisma.$transaction(async (tx) => {
    const created = await tx.template.create({
      data: {
        id: templateId,
        ownerId,
        name: uniqueName,
        slug: uniqueSlug,
        status: "draft",
        canvasSize: { width: canvasWidth, height: canvasHeight },
        pageCount,
        ...(storedPageThumbnails ? { pageThumbnails: storedPageThumbnails } : {}),
        category: placements[0].category,
        subCategory: placements[0].subCategory,
        // Inherited from the previous template (see resolveImportPlacements); a designer
        // re-files or widens it from the editor's Category tab afterwards.
        categories: placements,
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
