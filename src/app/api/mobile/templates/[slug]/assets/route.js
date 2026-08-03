import { NextResponse } from "next/server";

import { isTemplateAllowedByTaxonomy, prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import prisma from "@/lib/prisma";
import { extractEditorPagesData, extractFabricData } from "@/lib/templates/editorData";
import {
  isRasterizableShapeLayer,
  renderShapeLayerToPngBuffer,
} from "@/lib/templates/shapeRaster";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";
import {
  getObject,
  getPublicObjectProxyUrl,
  getPublicStorageBucketName,
  parsePublicObjectKey,
} from "@/lib/storage/objectStorage.server";
import { trimShapeSvg } from "@/lib/mobile/shapeSvgTrim.server";
import { recolorSvgSource } from "@/lib/editor/imagePalette";
import { resolveTemplateAudience } from "@/lib/mobile/templateAudience.server";

export const runtime = "nodejs";

const DATA_URI_PATTERN = /^data:([^;,]+)(;base64)?,([\s\S]+)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDataUri(value) {
  const source = String(value || "").trim();
  const match = source.match(DATA_URI_PATTERN);
  if (!match) return null;
  const mimeType = String(match[1] || "").trim() || "application/octet-stream";
  const isBase64 = String(match[2] || "").toLowerCase() === ";base64";
  const encoded = String(match[3] || "").trim();
  if (!encoded) return null;
  try {
    return {
      mimeType,
      bytes: isBase64
        ? Buffer.from(encoded, "base64")
        : Buffer.from(decodeURIComponent(encoded), "utf8"),
    };
  } catch {
    return null;
  }
}

async function rasterizeSvgBytes(svgBytes) {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default || sharpModule;
  return sharp(svgBytes).png().toBuffer();
}

async function objectBodyToBuffer(body) {
  if (!body) return null;
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  if (typeof body.arrayBuffer === "function") {
    return Buffer.from(await body.arrayBuffer());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeFrameContentTransform(value) {
  const transform = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fit = ["contain", "manual"].includes(String(transform.fit || "").toLowerCase())
    ? String(transform.fit).toLowerCase()
    : "cover";
  return {
    fit,
    scale: clamp(numberOr(transform.scale, 1), 0.1, 8),
    offsetX: clamp(numberOr(transform.offsetX, 0), -10000, 10000),
    offsetY: clamp(numberOr(transform.offsetY, 0), -10000, 10000),
  };
}

function resolveFramePreviewLayout(object) {
  const frameContent = object?.frameContent && typeof object.frameContent === "object"
    ? object.frameContent
    : {};
  const frameWidth = Math.max(1, Math.round(numberOr(object?.width, 1)));
  const frameHeight = Math.max(1, Math.round(numberOr(object?.height, 1)));
  const sourceWidth = Math.max(1, numberOr(frameContent.sourceWidth, frameWidth));
  const sourceHeight = Math.max(1, numberOr(frameContent.sourceHeight, frameHeight));
  const transform = normalizeFrameContentTransform(object?.frameContentTransform);
  const baseScale =
    transform.fit === "manual"
      ? 1
      : transform.fit === "contain"
        ? Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight)
        : Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const resolvedScale = Math.max(0.01, baseScale * transform.scale);
  const renderedWidth = Math.max(1, Math.round(sourceWidth * resolvedScale));
  const renderedHeight = Math.max(1, Math.round(sourceHeight * resolvedScale));

  return {
    frameWidth,
    frameHeight,
    renderedWidth,
    renderedHeight,
    x: Math.round((frameWidth - renderedWidth) / 2 + transform.offsetX),
    y: Math.round((frameHeight - renderedHeight) / 2 + transform.offsetY),
  };
}

async function readImageSourceBytes(source) {
  const raw = String(source || "").trim();
  if (!raw) return null;

  const publicObjectKey = parsePublicObjectKey(raw);
  if (publicObjectKey) {
    const object = await getObject(getPublicStorageBucketName(), publicObjectKey);
    return objectBodyToBuffer(object.Body);
  }

  if (/^https?:\/\//i.test(raw)) {
    const response = await fetch(raw);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  const parsed = parseDataUri(raw);
  return parsed?.bytes || null;
}

async function renderFrameContentPreviewPng(object) {
  const frameContent = object?.frameContent && typeof object.frameContent === "object"
    ? object.frameContent
    : null;
  if (!frameContent) return null;

  const source = String(
    frameContent.kind === "video"
      ? frameContent.posterSrc || ""
      : frameContent.src || ""
  ).trim();
  if (!source) return null;

  const sourceBytes = await readImageSourceBytes(source);
  if (!sourceBytes) return null;

  const sharpModule = await import("sharp");
  const sharp = sharpModule.default || sharpModule;
  const layout = resolveFramePreviewLayout(object);
  const extendLeft = Math.max(0, layout.x);
  const extendTop = Math.max(0, layout.y);
  const cropLeft = Math.max(0, -layout.x);
  const cropTop = Math.max(0, -layout.y);
  const canvasWidth = Math.max(layout.frameWidth + cropLeft, extendLeft + layout.renderedWidth);
  const canvasHeight = Math.max(layout.frameHeight + cropTop, extendTop + layout.renderedHeight);
  const extendRight = Math.max(0, canvasWidth - layout.renderedWidth - extendLeft);
  const extendBottom = Math.max(0, canvasHeight - layout.renderedHeight - extendTop);

  return sharp(sourceBytes, { animated: false })
    .rotate()
    .resize(layout.renderedWidth, layout.renderedHeight, { fit: "fill" })
    .ensureAlpha()
    .extend({
      top: extendTop,
      bottom: extendBottom,
      left: extendLeft,
      right: extendRight,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extract({
      left: cropLeft,
      top: cropTop,
      width: layout.frameWidth,
      height: layout.frameHeight,
    })
    .png()
    .toBuffer();
}

function resolvePageObjects(templateData, pageIndex) {
  const pages = extractEditorPagesData(templateData);
  if (Array.isArray(pages) && pages.length > 0) {
    const boundedIndex =
      Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pages.length ? pageIndex : 0;
    return {
      objects: Array.isArray(pages[boundedIndex]?.objects) ? pages[boundedIndex].objects : [],
      allPages: pages,
    };
  }
  const data = extractFabricData(templateData) || templateData || {};
  return {
    objects: Array.isArray(data?.objects) ? data.objects : [],
    allPages: null,
  };
}

function findLayerObject(templateData, elementId, index, pageIndex = 0) {
  const { objects, allPages } = resolvePageObjects(templateData, pageIndex);

  const normalizedElementId = String(elementId || "").trim();
  const matchById = (list) =>
    list.find((item) => {
      const id = String(item?.id || item?.layerId || "").trim();
      return id === normalizedElementId;
    }) || null;

  let object = null;
  if (normalizedElementId) {
    object = matchById(objects);
    // The id is authoritative — search the other pages before trusting a
    // positional index, so stale/proxied URLs still resolve to the right layer.
    if (!object && Array.isArray(allPages)) {
      for (const page of allPages) {
        object = matchById(Array.isArray(page?.objects) ? page.objects : []);
        if (object) break;
      }
    }
  }
  if (!object && Number.isFinite(index) && index >= 0 && index < objects.length) {
    object = objects[index];
  }
  if (!object || typeof object !== "object") return null;
  return object;
}

function resolveLayerSource(object, field) {
  if (!object || typeof object !== "object") return "";

  const frameContent = object.frameContent && typeof object.frameContent === "object"
    ? object.frameContent
    : null;
  if (field === "frameContent.src" || field === "frameContentSrc") {
    return typeof frameContent?.src === "string" ? frameContent.src.trim() : "";
  }
  if (field === "frameContent.posterSrc" || field === "frameContentPosterSrc") {
    return typeof frameContent?.posterSrc === "string" ? frameContent.posterSrc.trim() : "";
  }

  const candidateFields = field
    ? [String(field)]
    : ["src", "imageUri", "thumbnailUri", "videoUri"];
  for (const key of candidateFields) {
    const value = object?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function resolveBackgroundSource(templateData, field, pageIndex = 0) {
  const pages = extractEditorPagesData(templateData);
  let background = null;
  if (Array.isArray(pages) && pages.length > 0) {
    const boundedIndex =
      Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pages.length ? pageIndex : 0;
    background = pages[boundedIndex]?.background;
  } else {
    const data = extractFabricData(templateData) || templateData || {};
    background = data?.background;
  }
  if (typeof background === "string" && background.trim()) {
    return background.trim();
  }
  if (!background || typeof background !== "object") return "";

  if (field === "imageUri" && typeof background.imageUri === "string") {
    return background.imageUri.trim();
  }
  if (typeof background.imageUri === "string" && background.imageUri.trim()) {
    return background.imageUri.trim();
  }
  return "";
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const templateRef = String(resolvedParams?.id || resolvedParams?.slug || "").trim();
  if (!templateRef) {
    return NextResponse.json({ error: "Missing template id or slug." }, { status: 400 });
  }
  const where = UUID_PATTERN.test(templateRef) ? { id: templateRef } : { slug: templateRef };

  const { searchParams } = new URL(request.url);
  const scope = String(searchParams.get("scope") || "layer").trim().toLowerCase();
  const field = String(searchParams.get("field") || "").trim();
  const elementId = String(searchParams.get("elementId") || "").trim();
  const indexParam = searchParams.get("index");
  const index = Number.isFinite(Number(indexParam)) ? Number(indexParam) : null;
  const pageParam = searchParams.get("page");
  const pageIndex =
    Number.isInteger(Number(pageParam)) && Number(pageParam) > 0 ? Number(pageParam) : 0;

  const audience = await resolveTemplateAudience(request);
  const template = await prisma.template.findFirst({
    where: {
      ...audience.statusWhere,
      ...where,
    },
    select: {
      category: true,
      subCategory: true,
      data: true,
      thumbnailDataUrl: true,
    },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const taxonomySettings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(taxonomySettings);
  if (!isTemplateAllowedByTaxonomy(template, taxonomy)) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  let source = "";
  const layerObject =
    scope === "layer" ? findLayerObject(template.data, elementId, index, pageIndex) : null;
  if (scope === "layer" && (field === "frameContent.preview" || field === "frameContentPreview")) {
    try {
      const bytes = await renderFrameContentPreviewPng(layerObject);
      if (!bytes) {
        return NextResponse.json({ error: "Asset not found." }, { status: 404 });
      }
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": audience.cacheControl("public, max-age=300"),
          Vary: "Authorization",
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to render frame preview asset." },
        { status: 422 }
      );
    }
  }

  if (scope === "layer" && field === "shape-raster") {
    if (!isRasterizableShapeLayer(layerObject)) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    try {
      const bytes = renderShapeLayerToPngBuffer(layerObject);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": audience.cacheControl("public, max-age=300"),
          Vary: "Authorization",
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to rasterize shape asset." },
        { status: 422 }
      );
    }
  }

  if (scope === "layer" && field === "vector") {
    const vectorSource = String(layerObject?.vectorSrc || "").trim();
    if (!vectorSource) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const vectorObjectKey = parsePublicObjectKey(vectorSource);
    if (vectorObjectKey) {
      const proxyUrl = new URL(getPublicObjectProxyUrl(vectorObjectKey), request.url);
      return NextResponse.redirect(proxyUrl, 307);
    }
    if (/^https?:\/\//i.test(vectorSource)) {
      return NextResponse.redirect(vectorSource, 307);
    }

    if (!/^data:image\/svg\+xml/i.test(vectorSource)) {
      return NextResponse.json({ error: "Unsupported asset source." }, { status: 422 });
    }
    // Bake an active palette recolor into the SVG's fills (identical maths to the raster recolor)
    // so a recolored shape ships as a crisp vector instead of a rasterized PNG — a no-op when the
    // layer has no active remap.
    const recoloredVector = recolorSvgSource(
      vectorSource,
      layerObject?.rasterPalette,
      layerObject?.rasterColorMap
    );
    // Crop the viewBox to the shape's content bounds (authoring SVGs carry transparent padding)
    // so it fills its box like the trimmed raster, then serve the raw SVG so it stays crisp when
    // scaled — do NOT fall through to the SVG->PNG rasterization used for other sources below.
    const trimmedVector = await trimShapeSvg(recoloredVector);
    return new NextResponse(Buffer.from(trimmedVector.svg, "utf8"), {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": audience.cacheControl("public, max-age=300"),
        Vary: "Authorization",
      },
    });
  }

  if (scope === "thumbnail") {
    source = String(template.thumbnailDataUrl || "").trim();
  } else if (scope === "background") {
    source = resolveBackgroundSource(template.data, field, pageIndex);
  } else {
    source = resolveLayerSource(layerObject, field);
  }

  if (!source) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  const publicObjectKey = parsePublicObjectKey(source);
  if (publicObjectKey) {
    const proxyUrl = new URL(getPublicObjectProxyUrl(publicObjectKey), request.url);
    return NextResponse.redirect(proxyUrl, 307);
  }

  if (/^https?:\/\//i.test(source)) {
    return NextResponse.redirect(source, 307);
  }

  const parsed = parseDataUri(source);
  if (!parsed) {
    return NextResponse.json({ error: "Unsupported asset source." }, { status: 422 });
  }

  if (parsed.mimeType.toLowerCase() === "image/svg+xml") {
    const pngBytes = await rasterizeSvgBytes(parsed.bytes);
    return new NextResponse(pngBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": audience.cacheControl("public, max-age=300"),
        Vary: "Authorization",
      },
    });
  }

  return new NextResponse(parsed.bytes, {
    status: 200,
    headers: {
      "Content-Type": parsed.mimeType,
      "Cache-Control": audience.cacheControl("public, max-age=300"),
      Vary: "Authorization",
    },
  });
}
