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

/**
 * The template `data` an import stores, resolved without touching the database: the fabric
 * payload (from the editor data first, then the raw fabric data, else a one-image snapshot), the
 * import metadata attached under `meta.import`, and every animation fitted to the tab it lands
 * in. Pure, so the extension → template path can be exercised end to end in a unit test.
 *
 * Canva's effects have no one-for-one equivalent here, so the importer maps each preset onto the
 * closest one by feel. That says nothing about WHICH tab the result belongs to, and the tabs are
 * not interchangeable — Rise, Pan, Drift and friends are Loop and Exit effects here, never
 * entrances. A Canva entrance mapped onto Rise landed in the Entrance slot holding something that
 * tab does not offer: unselectable in the editor, and an entrance the app does not list either.
 * This is the second half of the mapping — the closest effect the tab actually offers — and it
 * runs on the server so an older extension build cannot route around it. It rewrites slot TYPES
 * only; durations, delays, directions and intensities pass through untouched, and an element's
 * explicit three-slot `animations` object rides along next to its legacy mediaAnimation* mirror
 * (the editor and the mobile serializer prefer the slots wherever both are present).
 */
export function resolveImportedTemplateData({
  fabricData,
  editorData,
  importMetadata,
  imageDataUrl,
  canvasWidth,
  canvasHeight,
  sourceWidth,
  sourceHeight,
}) {
  const incomingFabricData = extractFabricData(editorData) || extractFabricData(fabricData);
  const hasFabricData = Boolean(
    incomingFabricData && Array.isArray(incomingFabricData.objects) && incomingFabricData.objects.length > 0
  );
  const baseData = hasFabricData
    ? incomingFabricData
    : imageDataUrl
      ? buildFabricData(imageDataUrl, canvasWidth, canvasHeight, sourceWidth, sourceHeight)
      : null;
  if (!baseData) return { data: null, hasFabricData: false, refittedAnimations: 0 };
  const metadataFromEditor = readImportMetadataFromEditorData(editorData);
  const data = attachImportMetadataToFabricData(baseData, importMetadata || metadataFromEditor);
  const refittedAnimations = fitImportedAnimationsToCategories(data);
  return { data, hasFabricData, refittedAnimations };
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
  const { data, hasFabricData, refittedAnimations } = resolveImportedTemplateData({
    fabricData,
    editorData,
    importMetadata,
    imageDataUrl: sanitizedImageSource,
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight,
  });

  if (!data || (!hasFabricData && !sanitizedImageSource)) {
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

// ---------------------------------------------------------------------------------------------
// Canvas clamp ↔ layer geometry
// ---------------------------------------------------------------------------------------------
// The extension lays every layer out in the Canva page's OWN pixels and sends canvasWidth =
// sourceWidth, trusting the page size to survive as the canvas. normalizeCanvasInput then clamps
// the canvas to `maxDimension` (1920 by default) — and until now nothing rescaled the layers with
// it. A 1587×2245 poster became a 1357×1920 canvas holding 1587×2245 geometry: the title sat off
// centre, the bottom third (name box, clouds, mosque) fell below the page, and the app clipped the
// same way since the mobile serializer trusts canvasSize too. Every 1080×1920 story import dodged
// this because it never hit the clamp.
//
// These helpers rescale a fabric payload into the clamped canvas so the stored template is
// coherent again: positions and box sizes by the axis factors, and every other pixel-valued field
// by the uniform factor (the clamp is uniform, so they are equal). Text is scaled through
// fontSize/width/height and never through scaleX/scaleY — the mobile contract keeps text scales
// sign-only (flips). Intrinsic-geometry objects (images, videos, paths, groups) scale through
// scaleX/scaleY so their source pixels, crop rects and path commands stay untouched. Em-relative
// (charSpacing), ratio (lineHeight, mediaCornerRadius), time and source-pixel fields pass through.

const TEXT_OBJECT_TYPES = new Set(["textbox", "text", "i-text", "itext"]);
// Parametric shapes: fabric draws these from width/height (+ radii), so the size fields scale
// directly and the pixel radii with them.
const PARAMETRIC_SHAPE_TYPES = new Set(["rect", "circle", "ellipse", "triangle", "line"]);
// Animation params the importer emits in page pixels (docs/canva-animation-parity.md §8.1).
const HORIZONTAL_PX_PARAM_KEYS = ["travelX", "poseX"];
const VERTICAL_PX_PARAM_KEYS = ["travelY", "poseY", "y1From", "y1To", "y2To"];
const UNIFORM_PX_OBJECT_KEYS = [
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
  "strokeWidth",
  "mediaBlur",
  "mediaStrokeWidth",
  "cornerRadius",
  "textBackgroundRadius",
  "rx",
  "ry",
  "radius",
];

function scaleFiniteNumber(value, factor) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric * factor : value;
}

/**
 * The factors that take source-page pixels into the clamped canvas, or null when the canvas kept
 * the page's own size (the common case) or the dimensions are unusable.
 */
export function resolveImportCanvasScale({ canvasWidth, canvasHeight, sourceWidth, sourceHeight } = {}) {
  const values = [canvasWidth, canvasHeight, sourceWidth, sourceHeight].map((value) => Number(value));
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  const [cw, ch, sw, sh] = values;
  const sx = cw / sw;
  const sy = ch / sh;
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return null;
  return { sx, sy, uniform: Math.min(sx, sy) };
}

function scaleAnimationParams(params, scale) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const next = { ...params };
  for (const key of HORIZONTAL_PX_PARAM_KEYS) {
    if (key in next) next[key] = scaleFiniteNumber(next[key], scale.sx);
  }
  for (const key of VERTICAL_PX_PARAM_KEYS) {
    if (key in next) next[key] = scaleFiniteNumber(next[key], scale.sy);
  }
  return next;
}

function scaleAnimationSlots(animations, scale) {
  if (!animations || typeof animations !== "object" || Array.isArray(animations)) return animations;
  const next = { ...animations };
  for (const slot of Object.keys(next)) {
    const spec = next[slot];
    if (!spec || typeof spec !== "object" || Array.isArray(spec) || !("params" in spec)) continue;
    next[slot] = { ...spec, params: scaleAnimationParams(spec.params, scale) };
  }
  return next;
}

/** One fabric object rescaled into the clamped canvas (a new object; the input is not mutated). */
export function scaleFabricObjectToCanvas(object, scale) {
  if (!object || typeof object !== "object" || !scale) return object;
  const { sx, sy, uniform } = scale;
  const type = String(object.type || "").toLowerCase();
  const next = { ...object };
  if ("left" in next) next.left = scaleFiniteNumber(next.left, sx);
  if ("top" in next) next.top = scaleFiniteNumber(next.top, sy);
  if (TEXT_OBJECT_TYPES.has(type)) {
    if ("width" in next) next.width = scaleFiniteNumber(next.width, sx);
    if ("height" in next) next.height = scaleFiniteNumber(next.height, sy);
    if ("fontSize" in next) next.fontSize = scaleFiniteNumber(next.fontSize, uniform);
    if ("wrapWidth" in next) next.wrapWidth = scaleFiniteNumber(next.wrapWidth, sx);
    // letterSpacing (px) is the legacy mirror of charSpacing (em); only the px form scales.
    if ("letterSpacing" in next) next.letterSpacing = scaleFiniteNumber(next.letterSpacing, uniform);
  } else if (PARAMETRIC_SHAPE_TYPES.has(type)) {
    if ("width" in next) next.width = scaleFiniteNumber(next.width, sx);
    if ("height" in next) next.height = scaleFiniteNumber(next.height, sy);
    if (type === "line") {
      for (const key of ["x1", "x2"]) if (key in next) next[key] = scaleFiniteNumber(next[key], sx);
      for (const key of ["y1", "y2"]) if (key in next) next[key] = scaleFiniteNumber(next[key], sy);
    }
  } else {
    // Intrinsic geometry (image, video, path, polygon, group…): the size lives in scaleX/scaleY.
    next.scaleX = scaleFiniteNumber(next.scaleX ?? 1, sx);
    next.scaleY = scaleFiniteNumber(next.scaleY ?? 1, sy);
  }
  for (const key of UNIFORM_PX_OBJECT_KEYS) {
    if (key in next) next[key] = scaleFiniteNumber(next[key], uniform);
  }
  if (next.shadow && typeof next.shadow === "object" && !Array.isArray(next.shadow)) {
    next.shadow = {
      ...next.shadow,
      ...("blur" in next.shadow ? { blur: scaleFiniteNumber(next.shadow.blur, uniform) } : {}),
      ...("offsetX" in next.shadow ? { offsetX: scaleFiniteNumber(next.shadow.offsetX, sx) } : {}),
      ...("offsetY" in next.shadow ? { offsetY: scaleFiniteNumber(next.shadow.offsetY, sy) } : {}),
    };
  }
  if ("animations" in next) next.animations = scaleAnimationSlots(next.animations, scale);
  return next;
}

/**
 * The whole fabric payload rescaled into the clamped canvas. Returns the input untouched when
 * there is nothing to scale (null scale, or no objects), so callers can pass the result straight on.
 */
export function scaleFabricDataToCanvas(fabricData, scale) {
  if (!scale || !fabricData || typeof fabricData !== "object" || !Array.isArray(fabricData.objects)) {
    return fabricData;
  }
  return {
    ...fabricData,
    objects: fabricData.objects.map((object) => scaleFabricObjectToCanvas(object, scale)),
  };
}

/**
 * The extension's editor metadata carries a layer tree whose bounds are page-relative pixels;
 * keep them in the same space as the objects they describe.
 */
export function scaleEditorDataLayerTree(editorData, scale) {
  if (!scale || !editorData || typeof editorData !== "object" || !Array.isArray(editorData.layerTree)) {
    return editorData;
  }
  return {
    ...editorData,
    layerTree: editorData.layerTree.map((node) => {
      if (!node || typeof node !== "object") return node;
      const bounds = node.bounds || node.pageRelativeRect || node.rect;
      if (!bounds || typeof bounds !== "object") return node;
      return {
        ...node,
        bounds: {
          ...bounds,
          x: scaleFiniteNumber(bounds.x, scale.sx),
          y: scaleFiniteNumber(bounds.y, scale.sy),
          width: scaleFiniteNumber(bounds.width, scale.sx),
          height: scaleFiniteNumber(bounds.height, scale.sy),
        },
      };
    }),
  };
}
