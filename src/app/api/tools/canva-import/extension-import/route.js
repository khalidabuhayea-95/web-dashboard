import { NextResponse } from "next/server";

import { upsertEditorCustomFont } from "@/lib/editor/customFonts.server";
import { createLogger } from "@/lib/logging/logger";
import { attachRequestIdHeader, getRequestLogContext, resolveRequestId } from "@/lib/logging/request";
import { checkRateLimit, createRateLimitResponse, resolveRequestIp } from "@/lib/security/rateLimit.server";
import { verifyCanvaImportToken } from "@/lib/tools/canvaImportAuth";
import { sanitizeImportPayloadAssets } from "@/lib/tools/importAssetSanitizer";
import {
  buildFabricData,
  createImportedTemplate,
  normalizeCanvasInput,
} from "@/lib/tools/canvaImportTemplate";
import {
  buildImportMetadata,
  buildLayerTreeFromFabricObjects,
  deriveLayerStatsFromFabricObjects,
  readImportMetadataFromEditorData,
} from "@/lib/tools/importParity";

export const runtime = "nodejs";
export const maxDuration = 120;
const logger = createLogger("api.tools.canva-extension-import");
const EXTENSION_IMPORT_IP_LIMIT = {
  limit: 120,
  windowMs: 60_000,
};
const EXTENSION_IMPORT_USER_LIMIT = {
  limit: 24,
  windowMs: 60_000,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Private-Network": "true",
};

function withCors(response) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

function getToken(request, body) {
  const auth = String(request.headers.get("authorization") || "");
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return String(body?.token || "").trim();
}

function parseTitle(rawTitle) {
  const source = String(rawTitle || "").trim();
  const cleaned = source
    .replace(/\s*\|\s*Canva\s*$/i, "")
    .replace(/\s*-\s*Canva\s*$/i, "")
    .trim();
  return cleaned || "Imported Canva Template";
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const GENERIC_FONT_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
]);

function normalizeFontFamilyName(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const primary = input.split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
  if (!primary) return "";
  if (GENERIC_FONT_FAMILIES.has(primary.toLowerCase())) return "";
  return primary.replace(/\s+/g, " ").trim();
}

function deriveUsedFontsFromFabricObjects(objects) {
  if (!Array.isArray(objects)) return [];
  const seen = new Set();
  const usedFonts = [];
  objects.forEach((object) => {
    const type = String(object?.type || "").toLowerCase();
    if (type !== "text" && type !== "textbox" && type !== "i-text") return;
    const family = normalizeFontFamilyName(object?.fontFamily || object?.fontName);
    if (!family) return;
    const key = family.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    usedFonts.push(family);
  });
  return usedFonts;
}

function containsArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function sanitizeFontCategories(value, fallbackSample = "") {
  const categories = Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => item === "EXCLUSIVE" || item === "ARABIC" || item === "ENGLISH")
    : [];

  if (!categories.includes("EXCLUSIVE")) {
    categories.unshift("EXCLUSIVE");
  }

  if (!categories.includes("ARABIC") && !categories.includes("ENGLISH")) {
    categories.push(containsArabicScript(fallbackSample) ? "ARABIC" : "ENGLISH");
  }

  return Array.from(new Set(categories));
}

function collectFontCategoryHintsFromObjects(objects, resultMap) {
  if (!Array.isArray(objects)) return;
  objects.forEach((object) => {
    if (!object || typeof object !== "object") return;
    const type = String(object.type || "").toLowerCase();

    if (Array.isArray(object.objects)) {
      collectFontCategoryHintsFromObjects(object.objects, resultMap);
    }

    if (type !== "text" && type !== "textbox" && type !== "i-text") return;
    const family = normalizeFontFamilyName(object.fontFamily || object.fontName);
    if (!family) return;
    const key = family.toLowerCase();
    const textSample = String(object.text || "").trim() || family;
    const existing = new Set(resultMap.get(key) || ["EXCLUSIVE"]);
    existing.add(containsArabicScript(textSample) ? "ARABIC" : "ENGLISH");
    resultMap.set(key, Array.from(existing));
  });
}

function deriveImportedFontCategoryHints(fabricData) {
  const map = new Map();
  const objects = Array.isArray(fabricData?.objects) ? fabricData.objects : [];
  collectFontCategoryHintsFromObjects(objects, map);
  return map;
}

function normalizeCanvaObjectToTopLeftOrigin(input) {
  if (!input || typeof input !== "object") return input;
  const object = { ...input };
  const rawScaleX = numberOr(object.scaleX, 1);
  const rawScaleY = numberOr(object.scaleY, 1);
  const scaleX = Math.max(0.0001, Math.abs(rawScaleX));
  const scaleY = Math.max(0.0001, Math.abs(rawScaleY));
  const signedScaleX = (object.flipX ? -1 : 1) * (rawScaleX < 0 ? -1 : 1);
  const signedScaleY = (object.flipY ? -1 : 1) * (rawScaleY < 0 ? -1 : 1);
  const width = Math.max(1, numberOr(object.width, 1) * scaleX);
  const height = Math.max(1, numberOr(object.height, 1) * scaleY);
  const originX = String(object.originX || "left").toLowerCase();
  const originY = String(object.originY || "top").toLowerCase();
  const rotation = numberOr(object.rotation, numberOr(object.angle, 0));

  const anchorX = Number.isFinite(Number(object.left))
    ? numberOr(object.left, 0)
    : numberOr(object.x, 0);
  const anchorY = Number.isFinite(Number(object.top))
    ? numberOr(object.top, 0)
    : numberOr(object.y, 0);
  const originOffsetX = originX === "center" ? width / 2 : originX === "right" ? width : 0;
  const originOffsetY = originY === "center" ? height / 2 : originY === "bottom" ? height : 0;
  const localX = -originOffsetX * signedScaleX;
  const localY = -originOffsetY * signedScaleY;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const left = anchorX + localX * cos - localY * sin;
  const top = anchorY + localX * sin + localY * cos;

  return {
    ...object,
    left,
    top,
    originX: "left",
    originY: "top",
  };
}

function normalizeFabricDataOrigins(fabricData) {
  if (!fabricData || typeof fabricData !== "object") return fabricData;
  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (!objects.length) return fabricData;
  return {
    ...fabricData,
    objects: objects.map((object) => normalizeCanvaObjectToTopLeftOrigin(object)),
  };
}

function normalizeIncomingCustomFonts(editorData) {
  const source =
    editorData && typeof editorData === "object" && Array.isArray(editorData.customFonts)
      ? editorData.customFonts
      : [];
  const seen = new Set();
  const result = [];
  source.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const family = normalizeFontFamilyName(item.family);
    const dataUrl = String(item.dataUrl || "").trim();
    const mimeType = String(item.mimeType || "").trim().toLowerCase();
    const fileName = String(item.fileName || "").trim();
    if (!family || !dataUrl.startsWith("data:")) return;
    const key = family.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      family,
      dataUrl,
      mimeType,
      fileName,
      categories: sanitizeFontCategories(item.categories, family),
    });
  });
  return result;
}

function rgbToHex(r, g, b) {
  const toHex = (value) => {
    const v = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    return v.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseColorToHex(colorValue) {
  const source = String(colorValue || "").trim().toLowerCase();
  if (!source) return "";
  const shortHex = source.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const h = shortHex[1];
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  const fullHex = source.match(/^#([0-9a-f]{6})$/i);
  if (fullHex) return `#${fullHex[1].toLowerCase()}`;
  const rgb = source.match(
    /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+)\s*)?\)$/i
  );
  if (rgb) {
    const alpha = Number(rgb[4] || 1);
    if (Number.isFinite(alpha) && alpha <= 0.02) return "";
    return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])).toLowerCase();
  }
  return "";
}

function samplePointsForBackground(width, height) {
  const xInset = Math.max(2, Math.round(width * 0.04));
  const yInset = Math.max(2, Math.round(height * 0.04));
  const points = [
    [xInset, yInset],
    [width - 1 - xInset, yInset],
    [xInset, height - 1 - yInset],
    [width - 1 - xInset, height - 1 - yInset],
    [Math.round(width * 0.5), yInset],
    [Math.round(width * 0.5), height - 1 - yInset],
    [xInset, Math.round(height * 0.5)],
    [width - 1 - xInset, Math.round(height * 0.5)],
  ];
  return points;
}

async function inferBackgroundColorFromSnapshot(snapshotSource) {
  const source = String(snapshotSource || "").trim();
  if (!source) return "";

  let canvasLib;
  try {
    canvasLib = await import("canvas");
  } catch (_error) {
    return "";
  }
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) return "";

  try {
    const image = await canvasLib.loadImage(source);
    const width = Math.max(1, Math.round(numberOr(image?.width, 1)));
    const height = Math.max(1, Math.round(numberOr(image?.height, 1)));
    const canvas = canvasLib.createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);

    const points = samplePointsForBackground(width, height);
    const colors = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x, y] = points[index];
      const px = Math.max(0, Math.min(width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(height - 1, Math.round(y)));
      const pixel = context.getImageData(px, py, 1, 1).data;
      const alpha = Number(pixel?.[3] || 0);
      if (alpha < 40) continue;
      colors.push([Number(pixel?.[0] || 0), Number(pixel?.[1] || 0), Number(pixel?.[2] || 0)]);
    }
    if (colors.length === 0) return "";

    const avg = colors.reduce(
      (acc, color) => [acc[0] + color[0], acc[1] + color[1], acc[2] + color[2]],
      [0, 0, 0]
    );
    const count = colors.length;
    return rgbToHex(avg[0] / count, avg[1] / count, avg[2] / count);
  } catch (_error) {
    return "";
  }
}

function pruneRedundantBaseShapeLayer(fabricData, canvasWidth, canvasHeight) {
  if (!fabricData || typeof fabricData !== "object") {
    return {
      fabricData,
      removedLayerIds: [],
      warnings: [],
      promotedBackgroundColor: "",
    };
  }

  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (objects.length <= 1) {
    return {
      fabricData,
      removedLayerIds: [],
      warnings: [],
      promotedBackgroundColor: "",
    };
  }

  const pageWidth = Math.max(1, Math.round(numberOr(canvasWidth, 1)));
  const pageHeight = Math.max(1, Math.round(numberOr(canvasHeight, 1)));
  const pageArea = Math.max(1, pageWidth * pageHeight);

  function getRenderedBounds(object) {
    const scaleX = Math.max(0.0001, Math.abs(numberOr(object?.scaleX, 1)));
    const scaleY = Math.max(0.0001, Math.abs(numberOr(object?.scaleY, 1)));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = String(object?.originX || "left").toLowerCase();
    const originY = String(object?.originY || "top").toLowerCase();
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return { left, top, width, height, area: width * height };
  }

  const fullPageImageIndexes = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => String(object?.type || "").toLowerCase() === "image")
    .filter(({ object }) => {
      if (object?.visible === false || object?.layerHidden === true) return false;
      if (numberOr(object?.opacity, 1) <= 0.02) return false;
      const bounds = getRenderedBounds(object);
      const coverage = bounds.area / pageArea;
      if (coverage < 0.9) return false;
      const nearOrigin =
        Math.abs(bounds.left) <= pageWidth * 0.06 &&
        Math.abs(bounds.top) <= pageHeight * 0.06;
      return nearOrigin;
    })
    .map((entry) => entry.index);

  if (fullPageImageIndexes.length === 0) {
    return {
      fabricData,
      removedLayerIds: [],
      warnings: [],
      promotedBackgroundColor: "",
    };
  }

  const candidate = objects
    .map((object, index) => ({ object, index }))
    .find(({ object, index }) => {
      const type = String(object?.type || "").toLowerCase();
      if (type !== "rect") return false;
      const kind = String(object?.importKind || object?.layerType || "").toLowerCase();
      if (kind !== "shape") return false;
      if (object?.visible === false || object?.layerHidden === true) return false;
      if (numberOr(object?.opacity, 1) <= 0.02) return false;
      const strokeWidth = Math.max(0, numberOr(object?.strokeWidth, 0));
      if (strokeWidth > 0.5) return false;
      const bounds = getRenderedBounds(object);
      const coverage = bounds.area / pageArea;
      if (coverage < 0.9) return false;
      const nearOrigin =
        Math.abs(bounds.left) <= pageWidth * 0.06 &&
        Math.abs(bounds.top) <= pageHeight * 0.06;
      if (!nearOrigin) return false;
      const minImageIndex = Math.min(...fullPageImageIndexes);
      if (!Number.isFinite(minImageIndex) || index >= minImageIndex) return false;
      return true;
    });

  if (!candidate) {
    return {
      fabricData,
      removedLayerIds: [],
      warnings: [],
      promotedBackgroundColor: "",
    };
  }

  const removedLayerId = String(candidate.object?.importNodeId || `shape-${candidate.index + 1}`).trim();
  const nextObjects = objects.filter((_object, index) => index !== candidate.index);
  const promotedBackgroundColor = parseColorToHex(candidate.object?.fill);

  return {
    fabricData: {
      ...fabricData,
      objects: nextObjects,
    },
    removedLayerIds: removedLayerId ? [removedLayerId] : [],
    warnings: [
      `Removed redundant base shape layer (${removedLayerId || `index-${candidate.index}`}).`,
    ],
    promotedBackgroundColor,
  };
}

function pruneRedundantSyntheticBackgroundLayer(fabricData, canvasWidth, canvasHeight) {
  if (!fabricData || typeof fabricData !== "object") {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (objects.length <= 1) {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const pageWidth = Math.max(1, Math.round(numberOr(canvasWidth, 1)));
  const pageHeight = Math.max(1, Math.round(numberOr(canvasHeight, 1)));
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const warnings = [];

  const candidates = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => {
      if (!object || typeof object !== "object") return false;
      const type = String(object.type || "").toLowerCase();
      if (type !== "image") return false;
      const fallbackReason = String(object.fallbackReason || "").toLowerCase();
      const isFallback = Boolean(object.fallback) || fallbackReason.length > 0;
      if (!isFallback) return false;
      if (!fallbackReason.includes("full-snapshot")) return false;
      const nodeId = String(object.importNodeId || "").trim();
      const looksSyntheticNode = !nodeId || /^layer-\d+$/i.test(nodeId);
      if (!looksSyntheticNode) return false;
      const scaleX = Math.max(0.0001, Math.abs(numberOr(object.scaleX, 1)));
      const scaleY = Math.max(0.0001, Math.abs(numberOr(object.scaleY, 1)));
      const width = Math.max(1, numberOr(object.width, 1) * scaleX);
      const height = Math.max(1, numberOr(object.height, 1) * scaleY);
      const coverage = (width * height) / pageArea;
      if (coverage < 0.9) return false;
      const originX = String(object.originX || "left").toLowerCase();
      const originY = String(object.originY || "top").toLowerCase();
      let left = numberOr(object.left, 0);
      let top = numberOr(object.top, 0);
      if (originX === "center") left -= width / 2;
      if (originX === "right") left -= width;
      if (originY === "center") top -= height / 2;
      if (originY === "bottom") top -= height;
      const leftClose = Math.abs(left) <= pageWidth * 0.05;
      const topClose = Math.abs(top) <= pageHeight * 0.05;
      return leftClose && topClose;
    });

  if (candidates.length === 0) {
    return { fabricData, removedLayerIds: [], warnings };
  }

  const nonCandidateCount = objects.length - candidates.length;
  if (nonCandidateCount <= 0) {
    return { fabricData, removedLayerIds: [], warnings };
  }

  const sortedCandidates = [...candidates].sort((a, b) => a.index - b.index);
  const removeCandidate = sortedCandidates[0];
  if (!removeCandidate) {
    return { fabricData, removedLayerIds: [], warnings };
  }

  const removeIndex = removeCandidate.index;
  const removedLayerId = String(removeCandidate.object?.importNodeId || `layer-${removeIndex + 1}`).trim();
  const nextObjects = objects.filter((_object, index) => index !== removeIndex);
  warnings.push(
    `Removed redundant synthetic full-page fallback layer (${removedLayerId || `index-${removeIndex}`}).`
  );

  return {
    fabricData: {
      ...fabricData,
      objects: nextObjects,
    },
    removedLayerIds: removedLayerId ? [removedLayerId] : [],
    warnings,
  };
}

function pruneRedundantFallbackEdgeOverlayLayer(fabricData, canvasWidth, canvasHeight) {
  if (!fabricData || typeof fabricData !== "object") {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (objects.length <= 2) {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const pageWidth = Math.max(1, Math.round(numberOr(canvasWidth, 1)));
  const pageHeight = Math.max(1, Math.round(numberOr(canvasHeight, 1)));
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const warnings = [];

  function getRenderedBounds(object) {
    const scaleX = Math.max(0.0001, Math.abs(numberOr(object?.scaleX, 1)));
    const scaleY = Math.max(0.0001, Math.abs(numberOr(object?.scaleY, 1)));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = String(object?.originX || "left").toLowerCase();
    const originY = String(object?.originY || "top").toLowerCase();
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      area: width * height,
    };
  }

  const fullPageImageIndexes = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => String(object?.type || "").toLowerCase() === "image")
    .filter(({ object }) => {
      if (object?.visible === false || object?.layerHidden === true) return false;
      if (numberOr(object?.opacity, 1) <= 0.02) return false;
      const bounds = getRenderedBounds(object);
      const coverage = bounds.area / pageArea;
      if (coverage < 0.88) return false;
      const nearOrigin =
        Math.abs(bounds.left) <= pageWidth * 0.06 &&
        Math.abs(bounds.top) <= pageHeight * 0.06;
      return nearOrigin;
    })
    .map((entry) => entry.index);

  if (fullPageImageIndexes.length === 0) {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const minimumBackdropIndex = Math.min(...fullPageImageIndexes);
  const removableIndexes = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object, index }) => {
      if (index <= minimumBackdropIndex) return false;
      const type = String(object?.type || "").toLowerCase();
      if (type !== "image") return false;
      if (object?.visible === false || object?.layerHidden === true) return false;
      if (numberOr(object?.opacity, 1) <= 0.02) return false;

      const fallbackReason = String(object?.fallbackReason || "").toLowerCase();
      if (!fallbackReason.includes("snapshot-crop-server") && !fallbackReason.includes("backdrop-crop-server")) {
        return false;
      }

      const bounds = getRenderedBounds(object);
      const coverage = bounds.area / pageArea;
      const widthRatio = bounds.width / pageWidth;
      const heightRatio = bounds.height / pageHeight;
      const anchoredToLeftEdge = bounds.left <= pageWidth * 0.08;
      const anchoredToRightEdge = bounds.right >= pageWidth * 0.92;
      const anchoredToTopEdge = bounds.top <= pageHeight * 0.12;
      const anchoredToBottomEdge = bounds.bottom >= pageHeight * 0.88;

      // Canva-protected fallback crops can produce wide edge strips from the page snapshot.
      // Keep the rule edge-anchored + tall, but allow medium widths so those artifacts are removed.
      if (coverage < 0.22 || coverage > 0.9) return false;
      if (widthRatio < 0.35 || widthRatio > 0.95) return false;
      if (heightRatio < 0.7) return false;
      if (!(anchoredToLeftEdge || anchoredToRightEdge)) return false;
      if (!(anchoredToTopEdge && anchoredToBottomEdge)) return false;
      return true;
    })
    .map((entry) => entry.index);

  if (removableIndexes.length === 0) {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const removeIndexSet = new Set(removableIndexes);
  const removedLayerIds = removableIndexes
    .map((index) => String(objects[index]?.importNodeId || `layer-${index + 1}`).trim())
    .filter(Boolean);
  const nextObjects = objects.filter((_object, index) => !removeIndexSet.has(index));
  warnings.push(
    `${removedLayerIds.length} protected fallback edge overlay layer${removedLayerIds.length === 1 ? "" : "s"} ignored.`
  );

  return {
    fabricData: {
      ...fabricData,
      objects: nextObjects,
    },
    removedLayerIds,
    warnings,
  };
}

function pruneRedundantFullPageSnapshotCropLayer(fabricData, canvasWidth, canvasHeight) {
  if (!fabricData || typeof fabricData !== "object") {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (objects.length <= 1) {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const pageWidth = Math.max(1, Math.round(numberOr(canvasWidth, 1)));
  const pageHeight = Math.max(1, Math.round(numberOr(canvasHeight, 1)));
  const pageArea = Math.max(1, pageWidth * pageHeight);

  function getRenderedBounds(object) {
    const scaleX = Math.max(0.0001, Math.abs(numberOr(object?.scaleX, 1)));
    const scaleY = Math.max(0.0001, Math.abs(numberOr(object?.scaleY, 1)));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = String(object?.originX || "left").toLowerCase();
    const originY = String(object?.originY || "top").toLowerCase();
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return {
      left,
      top,
      width,
      height,
      area: width * height,
    };
  }

  function isFullPageLikeImage(object) {
    const type = String(object?.type || "").toLowerCase();
    if (type !== "image") return false;
    if (object?.visible === false || object?.layerHidden === true) return false;
    if (numberOr(object?.opacity, 1) <= 0.02) return false;

    const bounds = getRenderedBounds(object);
    const coverage = bounds.area / pageArea;
    if (coverage < 0.88) return false;
    if (bounds.width < pageWidth * 0.9 || bounds.height < pageHeight * 0.9) return false;

    const nearOrigin =
      Math.abs(bounds.left) <= pageWidth * 0.06 &&
      Math.abs(bounds.top) <= pageHeight * 0.06;
    return nearOrigin;
  }

  const removeIndexes = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => {
      const fallbackReason = String(object?.fallbackReason || "").toLowerCase();
      const isSnapshotCropFallback =
        fallbackReason.includes("snapshot-crop-server") ||
        fallbackReason.includes("backdrop-crop-server");
      if (!isSnapshotCropFallback) return false;
      if (!isFullPageLikeImage(object)) return false;
      return true;
    })
    .map(({ index }) => index)
    .filter((index) => {
      for (let scanIndex = index - 1; scanIndex >= 0; scanIndex -= 1) {
        if (isFullPageLikeImage(objects[scanIndex])) {
          return true;
        }
      }
      return false;
    });

  if (removeIndexes.length === 0) {
    return { fabricData, removedLayerIds: [], warnings: [] };
  }

  const removeSet = new Set(removeIndexes);
  const removedLayerIds = removeIndexes
    .map((index) => String(objects[index]?.importNodeId || `layer-${index + 1}`).trim())
    .filter(Boolean);
  const nextObjects = objects.filter((_object, index) => !removeSet.has(index));

  return {
    fabricData: {
      ...fabricData,
      objects: nextObjects,
    },
    removedLayerIds,
    warnings: [
      `${removedLayerIds.length} redundant full-page snapshot fallback layer${removedLayerIds.length === 1 ? "" : "s"} removed.`,
    ],
  };
}

function parseFailedFabricObjectIndexesFromError(errorMessage) {
  const source = String(errorMessage || "");
  const matches = source.matchAll(/fabricData\.objects\[(\d+)\]\.src/g);
  const indexes = new Set();
  for (const match of matches) {
    const index = Number(match?.[1]);
    if (!Number.isFinite(index) || index < 0) continue;
    indexes.add(index);
  }
  return indexes;
}

async function replaceExternalImageSourcesWithSnapshotCrops({
  fabricData,
  snapshotDataUrl,
  canvasWidth,
  canvasHeight,
  targetIndexes,
}) {
  const sourceDataUrl = String(snapshotDataUrl || "").trim();
  if (!fabricData || typeof fabricData !== "object") {
    return {
      fabricData,
      replacedCount: 0,
      warnings: [],
    };
  }
  if (!sourceDataUrl.startsWith("data:image/")) {
    return {
      fabricData,
      replacedCount: 0,
      warnings: [],
    };
  }

  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (objects.length === 0) {
    return {
      fabricData,
      replacedCount: 0,
      warnings: [],
    };
  }

  const targetCanvasWidth = Math.max(1, Math.round(numberOr(canvasWidth, 1)));
  const targetCanvasHeight = Math.max(1, Math.round(numberOr(canvasHeight, 1)));
  const warnings = [];
  let createCanvasFn;
  let loadImageFn;

  try {
    const canvasLib = await import("canvas");
    createCanvasFn = canvasLib.createCanvas;
    loadImageFn = canvasLib.loadImage;
  } catch (error) {
    warnings.push(
      `Layer snapshot fallback unavailable (canvas module): ${error?.message || "unknown error"}`
    );
    return {
      fabricData,
      replacedCount: 0,
      warnings,
    };
  }

  let snapshotImage;
  try {
    snapshotImage = await loadImageFn(sourceDataUrl);
  } catch (error) {
    warnings.push(
      `Layer snapshot fallback unavailable (decode failed): ${error?.message || "unknown error"}`
    );
    return {
      fabricData,
      replacedCount: 0,
      warnings,
    };
  }

  const snapshotWidth = Math.max(1, Math.round(numberOr(snapshotImage?.width, 1)));
  const snapshotHeight = Math.max(1, Math.round(numberOr(snapshotImage?.height, 1)));
  const nextObjects = objects.map((item) => ({ ...(item && typeof item === "object" ? item : {}) }));
  const pageArea = Math.max(1, targetCanvasWidth * targetCanvasHeight);
  const backdropCanvasCache = new Map();
  const droppedIndexSet = new Set();
  let snapshotCropReplacedCount = 0;
  let backdropCropReplacedCount = 0;
  let droppedProtectedLayerCount = 0;
  let replacedCount = 0;

  function getRenderedBounds(object) {
    const scaleX = Math.max(0.0001, Math.abs(numberOr(object?.scaleX, 1)));
    const scaleY = Math.max(0.0001, Math.abs(numberOr(object?.scaleY, 1)));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = String(object?.originX || "left").toLowerCase();
    const originY = String(object?.originY || "top").toLowerCase();
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  function normalizeBoundsToCanvas(bounds) {
    const normalizedLeft = Math.max(0, Math.min(targetCanvasWidth - 1, numberOr(bounds?.left, 0)));
    const normalizedTop = Math.max(0, Math.min(targetCanvasHeight - 1, numberOr(bounds?.top, 0)));
    const normalizedRight = Math.max(
      normalizedLeft + 1,
      Math.min(targetCanvasWidth, numberOr(bounds?.right, 0))
    );
    const normalizedBottom = Math.max(
      normalizedTop + 1,
      Math.min(targetCanvasHeight, numberOr(bounds?.bottom, 0))
    );
    return {
      left: normalizedLeft,
      top: normalizedTop,
      right: normalizedRight,
      bottom: normalizedBottom,
      width: Math.max(1, normalizedRight - normalizedLeft),
      height: Math.max(1, normalizedBottom - normalizedTop),
    };
  }

  function shouldPreferBackdropCrop(bounds) {
    const widthRatio = bounds.width / targetCanvasWidth;
    const heightRatio = bounds.height / targetCanvasHeight;
    const coverage = (bounds.width * bounds.height) / pageArea;
    const anchoredToLeftEdge = bounds.left <= targetCanvasWidth * 0.08;
    const anchoredToRightEdge = bounds.right >= targetCanvasWidth * 0.92;
    const anchoredToTopEdge = bounds.top <= targetCanvasHeight * 0.08;
    const anchoredToBottomEdge = bounds.bottom >= targetCanvasHeight * 0.92;
    return (
      coverage >= 0.45 &&
      widthRatio <= 0.9 &&
      heightRatio >= 0.82 &&
      (anchoredToLeftEdge || anchoredToRightEdge) &&
      (anchoredToTopEdge || anchoredToBottomEdge)
    );
  }

  function resolveCropRect(bounds, sourceWidth, sourceHeight) {
    const sx = Math.max(
      0,
      Math.min(
        sourceWidth - 1,
        Math.round((bounds.left / targetCanvasWidth) * sourceWidth)
      )
    );
    const sy = Math.max(
      0,
      Math.min(
        sourceHeight - 1,
        Math.round((bounds.top / targetCanvasHeight) * sourceHeight)
      )
    );
    const sw = Math.max(
      1,
      Math.min(
        sourceWidth - sx,
        Math.round((bounds.width / targetCanvasWidth) * sourceWidth)
      )
    );
    const sh = Math.max(
      1,
      Math.min(
        sourceHeight - sy,
        Math.round((bounds.height / targetCanvasHeight) * sourceHeight)
      )
    );
    return { sx, sy, sw, sh };
  }

  function findNearestFullPageBackdropLayer(targetIndex) {
    for (let scanIndex = targetIndex - 1; scanIndex >= 0; scanIndex -= 1) {
      const candidate = nextObjects[scanIndex];
      const candidateType = String(candidate?.type || "").toLowerCase();
      const candidateSrc = String(candidate?.src || "").trim();
      if (candidateType !== "image") continue;
      if (!candidateSrc.startsWith("data:image/") && !/^https?:\/\//i.test(candidateSrc)) continue;

      const candidateBounds = normalizeBoundsToCanvas(getRenderedBounds(candidate));
      const coverage = (candidateBounds.width * candidateBounds.height) / pageArea;
      const nearOrigin =
        candidateBounds.left <= targetCanvasWidth * 0.06 &&
        candidateBounds.top <= targetCanvasHeight * 0.06;
      const fullPageLike =
        coverage >= 0.88 &&
        candidateBounds.width >= targetCanvasWidth * 0.9 &&
        candidateBounds.height >= targetCanvasHeight * 0.9 &&
        nearOrigin;
      if (!fullPageLike) continue;

      return {
        cacheKey: `${scanIndex}:${candidateSrc}`,
        src: candidateSrc,
        bounds: candidateBounds,
      };
    }
    return null;
  }

  async function getBackdropCanvas(candidate) {
    if (!candidate) return null;
    if (backdropCanvasCache.has(candidate.cacheKey)) {
      return backdropCanvasCache.get(candidate.cacheKey);
    }

    const backdropPromise = (async () => {
      const image = await loadImageFn(candidate.src);
      const backdropCanvas = createCanvasFn(targetCanvasWidth, targetCanvasHeight);
      const backdropContext = backdropCanvas.getContext("2d");
      backdropContext.clearRect(0, 0, targetCanvasWidth, targetCanvasHeight);
      backdropContext.drawImage(
        image,
        candidate.bounds.left,
        candidate.bounds.top,
        candidate.bounds.width,
        candidate.bounds.height
      );
      return backdropCanvas;
    })();

    backdropCanvasCache.set(candidate.cacheKey, backdropPromise);
    return backdropPromise;
  }

  function shouldDropSnapshotFallbackLayer(bounds, hasBackdropLayer) {
    if (!hasBackdropLayer) return false;
    const coverage = (bounds.width * bounds.height) / pageArea;
    if (coverage < 0.14 || coverage > 0.78) return false;

    const widthRatio = bounds.width / targetCanvasWidth;
    const heightRatio = bounds.height / targetCanvasHeight;
    if (widthRatio < 0.28 || heightRatio < 0.22) return false;

    const nearLeftEdge = bounds.left <= targetCanvasWidth * 0.07;
    const nearRightEdge = bounds.right >= targetCanvasWidth * 0.93;
    const nearTopEdge = bounds.top <= targetCanvasHeight * 0.07;
    const nearBottomEdge = bounds.bottom >= targetCanvasHeight * 0.93;
    const edgeAnchored = nearLeftEdge || nearRightEdge || nearTopEdge || nearBottomEdge;
    return !edgeAnchored;
  }

  for (let index = 0; index < nextObjects.length; index += 1) {
    if (targetIndexes instanceof Set && targetIndexes.size > 0 && !targetIndexes.has(index)) {
      continue;
    }
    const object = nextObjects[index];
    const type = String(object?.type || "").toLowerCase();
    const src = String(object?.src || "").trim();
    if (type !== "image" || !/^https?:\/\//i.test(src)) continue;

    const bounds = normalizeBoundsToCanvas(getRenderedBounds(object));
    const backdropCandidate = findNearestFullPageBackdropLayer(index);
    if (shouldDropSnapshotFallbackLayer(bounds, Boolean(backdropCandidate))) {
      droppedIndexSet.add(index);
      droppedProtectedLayerCount += 1;
      continue;
    }

    let cropSource = snapshotImage;
    let cropSourceWidth = snapshotWidth;
    let cropSourceHeight = snapshotHeight;
    let usedBackdropFallback = false;

    if (shouldPreferBackdropCrop(bounds)) {
      if (backdropCandidate) {
        try {
          const backdropCanvas = await getBackdropCanvas(backdropCandidate);
          if (backdropCanvas) {
            cropSource = backdropCanvas;
            cropSourceWidth = targetCanvasWidth;
            cropSourceHeight = targetCanvasHeight;
            usedBackdropFallback = true;
          }
        } catch (_error) {
          // Fall back to snapshot crop if backdrop reconstruction is unavailable.
        }
      }
    }

    const { sx, sy, sw, sh } = resolveCropRect(bounds, cropSourceWidth, cropSourceHeight);

    try {
      const cropCanvas = createCanvasFn(sw, sh);
      const cropContext = cropCanvas.getContext("2d");
      cropContext.drawImage(cropSource, sx, sy, sw, sh, 0, 0, sw, sh);
      const croppedDataUrl = cropCanvas.toDataURL("image/png");
      if (!String(croppedDataUrl).startsWith("data:image/")) continue;

      object.src = croppedDataUrl;
      object.crossOrigin = undefined;
      object.fallback = true;
      object.fallbackReason = String(
        object?.fallbackReason ||
          (usedBackdropFallback ? "backdrop-crop-server" : "snapshot-crop-server")
      );
      replacedCount += 1;
      if (usedBackdropFallback) {
        backdropCropReplacedCount += 1;
      } else {
        snapshotCropReplacedCount += 1;
      }
    } catch (_error) {
      // Keep route resilient when one layer crop fails.
    }
  }

  if (replacedCount <= 0) {
    const hasDroppedLayers = droppedIndexSet.size > 0;
    if (!hasDroppedLayers) {
      return {
        fabricData,
        replacedCount: 0,
        warnings,
      };
    }
  }

  const finalObjects =
    droppedIndexSet.size > 0
      ? nextObjects.filter((_object, index) => !droppedIndexSet.has(index))
      : nextObjects;

  if (replacedCount <= 0 && droppedIndexSet.size <= 0) {
    return {
      fabricData,
      replacedCount: 0,
      warnings,
    };
  }

  if (snapshotCropReplacedCount > 0) {
    warnings.push(
      `${snapshotCropReplacedCount} protected image layer${snapshotCropReplacedCount === 1 ? "" : "s"} replaced using snapshot crops.`
    );
  }
  if (backdropCropReplacedCount > 0) {
    warnings.push(
      `${backdropCropReplacedCount} protected image layer${backdropCropReplacedCount === 1 ? "" : "s"} replaced using backdrop crops.`
    );
  }
  if (warnings.length === 0) {
    warnings.push(
      `${replacedCount} protected image layer${replacedCount === 1 ? "" : "s"} replaced using fallback crops.`
    );
  }
  if (droppedProtectedLayerCount > 0) {
    warnings.push(
      `${droppedProtectedLayerCount} protected image layer${droppedProtectedLayerCount === 1 ? "" : "s"} removed to avoid snapshot artifact duplication.`
    );
  }

  return {
    fabricData: {
      ...fabricData,
      objects: finalObjects,
    },
    replacedCount: replacedCount + droppedProtectedLayerCount,
    warnings,
  };
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const withCorsRequest = (response) => attachRequestIdHeader(withCors(response), requestId);

  const ipRateLimitState = checkRateLimit({
    scope: "api:tools:canva-extension-import:ip",
    identifier: resolveRequestIp(request),
    limit: EXTENSION_IMPORT_IP_LIMIT.limit,
    windowMs: EXTENSION_IMPORT_IP_LIMIT.windowMs,
  });
  if (!ipRateLimitState.allowed) {
    return withCorsRequest(
      createRateLimitResponse("Too many extension import requests. Please retry shortly.", ipRateLimitState)
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    requestLogger.warn("Invalid JSON body in extension import");
    return withCorsRequest(NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }));
  }

  const token = getToken(request, body);
  const verification = verifyCanvaImportToken(token);
  if (!verification.valid) {
    requestLogger.warn("Unauthorized extension import request", {
      reason: verification.reason,
    });
    return withCorsRequest(
      NextResponse.json(
        {
          error: "Unauthorized extension request.",
          details: verification.reason,
        },
        { status: 401 }
      )
    );
  }

  const userRateLimitState = checkRateLimit({
    scope: "api:tools:canva-extension-import:user",
    identifier: verification.userId,
    limit: EXTENSION_IMPORT_USER_LIMIT.limit,
    windowMs: EXTENSION_IMPORT_USER_LIMIT.windowMs,
  });
  if (!userRateLimitState.allowed) {
    return withCorsRequest(
      createRateLimitResponse("Too many extension imports for this account. Please retry shortly.", userRateLimitState)
    );
  }

  try {
  const rawImageDataUrl = String(body?.imageDataUrl || "");
  const rawThumbnailDataUrl = String(body?.thumbnailDataUrl || body?.imageDataUrl || "");
  const rawFabricData = normalizeFabricDataOrigins(body?.fabricData);
  const editorData = body?.editorData;
  const sourceUrl = String(body?.sourceUrl || "").trim();
  const title = parseTitle(body?.title);
  const requestedName = String(body?.name || "").trim() || title;
  const requestedSlug = String(body?.slug || "").trim();
  const dimensions = normalizeCanvasInput({
    width: body?.canvasWidth,
    height: body?.canvasHeight,
    sourceWidth: body?.sourceWidth,
    sourceHeight: body?.sourceHeight,
    maxDimension: body?.maxDimension || 1920,
  });
  const hasRawFabricData =
    rawFabricData &&
    typeof rawFabricData === "object" &&
    Array.isArray(rawFabricData.objects) &&
    rawFabricData.objects.length > 0;
  const hasRawImageSource =
    rawImageDataUrl.startsWith("data:image/") || /^https?:\/\//i.test(rawImageDataUrl);

  if (!hasRawFabricData && !hasRawImageSource) {
    return withCorsRequest(
      NextResponse.json(
        {
          error: "Invalid extension payload.",
          details: "Missing imageDataUrl URL/data URI or fabricData.",
        },
        { status: 400 }
      )
    );
  }

  let sanitizedImportPayload;
  let forcedSnapshotFallbackWarning = "";
  const layerCropFallbackWarnings = [];
  let initialSanitizeError = "";
  try {
    sanitizedImportPayload = await sanitizeImportPayloadAssets({
      ownerId: verification.userId,
      imageDataUrl: rawImageDataUrl,
      thumbnailDataUrl: rawThumbnailDataUrl,
      fabricData: rawFabricData,
      sourceLabel: "canva-extension",
      preserveSvg: true,
      rewriteExternalUrls: true,
    });
  } catch (error) {
    initialSanitizeError =
      error?.message || "Failed to sanitize import assets.";
    sanitizedImportPayload = null;
  }
  if (!sanitizedImportPayload) {
    const hasSnapshotFallback =
      rawThumbnailDataUrl.startsWith("data:image/") &&
      rawThumbnailDataUrl.length > 0;
    if (hasRawFabricData && hasSnapshotFallback) {
      let workingFabricData = rawFabricData;
      let currentSanitizeError = initialSanitizeError;
      const attemptedObjectIndexes = new Set();
      const maxLayerCropAttempts = 12;

      for (let attempt = 0; attempt < maxLayerCropAttempts; attempt += 1) {
        const failedIndexes = parseFailedFabricObjectIndexesFromError(currentSanitizeError);
        if (failedIndexes.size === 0) break;

        const pendingIndexes = new Set(
          Array.from(failedIndexes).filter((index) => !attemptedObjectIndexes.has(index))
        );
        if (pendingIndexes.size === 0) break;
        pendingIndexes.forEach((index) => attemptedObjectIndexes.add(index));

        const layerCropFallback = await replaceExternalImageSourcesWithSnapshotCrops({
          fabricData: workingFabricData,
          snapshotDataUrl: rawThumbnailDataUrl,
          canvasWidth: dimensions.canvasWidth,
          canvasHeight: dimensions.canvasHeight,
          targetIndexes: pendingIndexes,
        });
        if (Array.isArray(layerCropFallback.warnings) && layerCropFallback.warnings.length > 0) {
          layerCropFallbackWarnings.push(...layerCropFallback.warnings);
        }
        if (layerCropFallback.replacedCount <= 0) break;

        workingFabricData = layerCropFallback.fabricData;
        try {
          sanitizedImportPayload = await sanitizeImportPayloadAssets({
            ownerId: verification.userId,
            imageDataUrl: rawImageDataUrl,
            thumbnailDataUrl: rawThumbnailDataUrl,
            fabricData: workingFabricData,
            sourceLabel: "canva-extension-layer-crop-fallback",
            preserveSvg: true,
            rewriteExternalUrls: true,
          });
          break;
        } catch (layerFallbackError) {
          currentSanitizeError =
            layerFallbackError?.message || "layer crop fallback sanitization failed";
          initialSanitizeError = `${initialSanitizeError} | ${currentSanitizeError}`;
        }
      }
    }

    if (sanitizedImportPayload) {
      forcedSnapshotFallbackWarning =
        `Layer asset rewrite failed (${initialSanitizeError || "protected source"}); protected layers were replaced from fallback crops.`;
    }
  }

  if (!sanitizedImportPayload) {
    const hasSnapshotFallback =
      rawThumbnailDataUrl.startsWith("data:image/") &&
      rawThumbnailDataUrl.length > 0;
    if (!hasSnapshotFallback) {
      return withCorsRequest(
        NextResponse.json(
          {
            error: "Invalid extension assets.",
            details:
              initialSanitizeError ||
              "No fallback snapshot is available for unresolved layer assets.",
          },
          { status: 422 }
        )
      );
    }
    try {
      const snapshotFabricData = buildFabricData(
        rawThumbnailDataUrl,
        dimensions.canvasWidth,
        dimensions.canvasHeight,
        dimensions.sourceWidth,
        dimensions.sourceHeight
      );
      sanitizedImportPayload = await sanitizeImportPayloadAssets({
        ownerId: verification.userId,
        imageDataUrl: rawThumbnailDataUrl,
        thumbnailDataUrl: rawThumbnailDataUrl,
        fabricData: snapshotFabricData,
        sourceLabel: "canva-extension-snapshot-fallback",
        preserveSvg: true,
        rewriteExternalUrls: true,
      });
      forcedSnapshotFallbackWarning =
        `Layer asset rewrite failed (${initialSanitizeError || "protected source"}); imported as full snapshot fallback.`;
    } catch (fallbackError) {
      return withCorsRequest(
        NextResponse.json(
          {
            error: "Invalid extension assets.",
            details:
              (initialSanitizeError ? `${initialSanitizeError} | ` : "") +
                (fallbackError?.message || "Failed to sanitize fallback snapshot assets."),
          },
          { status: 422 }
        )
      );
    }
  }

  const imageDataUrl = sanitizedImportPayload.imageDataUrl;
  const thumbnailDataUrl = sanitizedImportPayload.thumbnailDataUrl;
  const prunedSyntheticBackground = pruneRedundantSyntheticBackgroundLayer(
    sanitizedImportPayload.fabricData,
    dimensions.canvasWidth,
    dimensions.canvasHeight
  );
  const prunedBaseShape = pruneRedundantBaseShapeLayer(
    prunedSyntheticBackground.fabricData,
    dimensions.canvasWidth,
    dimensions.canvasHeight
  );
  const prunedFallbackEdgeOverlay = pruneRedundantFallbackEdgeOverlayLayer(
    prunedBaseShape.fabricData,
    dimensions.canvasWidth,
    dimensions.canvasHeight
  );
  const prunedFullPageSnapshotCrop = pruneRedundantFullPageSnapshotCropLayer(
    prunedFallbackEdgeOverlay.fabricData,
    dimensions.canvasWidth,
    dimensions.canvasHeight
  );
  const inferredBackgroundColor = await inferBackgroundColorFromSnapshot(rawThumbnailDataUrl || thumbnailDataUrl);
  const fabricData = {
    ...(prunedFullPageSnapshotCrop.fabricData && typeof prunedFullPageSnapshotCrop.fabricData === "object"
      ? prunedFullPageSnapshotCrop.fabricData
      : {}),
  };
  const resolvedBackgroundColor =
    parseColorToHex(fabricData.backgroundColor) ||
    parseColorToHex(inferredBackgroundColor) ||
    parseColorToHex(prunedBaseShape.promotedBackgroundColor);
  if (resolvedBackgroundColor && !String(fabricData.backgroundColor || "").trim()) {
    fabricData.backgroundColor = resolvedBackgroundColor;
  }
  if (resolvedBackgroundColor) {
    if (!Array.isArray(prunedSyntheticBackground.warnings)) {
      prunedSyntheticBackground.warnings = [];
    }
    prunedSyntheticBackground.warnings.push(
      `Applied page background color ${resolvedBackgroundColor}.`
    );
  }
  const removedSyntheticLayerIds = [
    ...(Array.isArray(prunedSyntheticBackground.removedLayerIds)
      ? prunedSyntheticBackground.removedLayerIds
      : []),
    ...(Array.isArray(prunedBaseShape.removedLayerIds)
      ? prunedBaseShape.removedLayerIds
      : []),
    ...(Array.isArray(prunedFallbackEdgeOverlay.removedLayerIds)
      ? prunedFallbackEdgeOverlay.removedLayerIds
      : []),
    ...(Array.isArray(prunedFullPageSnapshotCrop.removedLayerIds)
      ? prunedFullPageSnapshotCrop.removedLayerIds
      : []),
  ];
  const hasFabricData =
    fabricData &&
    typeof fabricData === "object" &&
    Array.isArray(fabricData.objects) &&
    fabricData.objects.length > 0;
  const fabricObjects = hasFabricData ? fabricData.objects : [];
  const metadataFromEditor =
    forcedSnapshotFallbackWarning.length > 0
      ? null
      : readImportMetadataFromEditorData(editorData);
  const filteredEditorLayerTree =
    Array.isArray(metadataFromEditor?.layerTree) && metadataFromEditor.layerTree.length > 0
      ? metadataFromEditor.layerTree.filter((node) => {
          const id = String(node?.id || "").trim();
          return !removedSyntheticLayerIds.includes(id);
        })
      : [];
  const defaultLayerTree =
    filteredEditorLayerTree.length > 0
      ? filteredEditorLayerTree
      : buildLayerTreeFromFabricObjects(fabricObjects);
  const singleSnapshotLayerTree = !hasFabricData
    ? [
        {
          id: "canva-snapshot-1",
          parentId: null,
          zIndex: 0,
          name: "Imported Canva Snapshot",
          kind: "image",
          bounds: {
            x: 0,
            y: 0,
            width: dimensions.canvasWidth,
            height: dimensions.canvasHeight,
          },
          transform: {
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          fallback: true,
          fallbackReason: "full-snapshot",
        },
      ]
    : [];
  const computedStats = hasFabricData
    ? deriveLayerStatsFromFabricObjects(fabricObjects)
    : {
        detected: 1,
        editable: 0,
        rasterized: 1,
        skipped: 0,
      };
  const importMetadata = buildImportMetadata(
    {
      source: "canva-extension",
      importVersion: metadataFromEditor?.importVersion || 2,
      page: {
        id: metadataFromEditor?.page?.id || "canva-page-1",
        name: metadataFromEditor?.page?.name || "Canva Page 1",
        width: dimensions.canvasWidth,
        height: dimensions.canvasHeight,
        sourceWidth: dimensions.sourceWidth,
        sourceHeight: dimensions.sourceHeight,
      },
      layerTree: defaultLayerTree.length > 0 ? defaultLayerTree : singleSnapshotLayerTree,
      layerStats: metadataFromEditor?.layerStats || computedStats,
      usedFonts:
        Array.isArray(metadataFromEditor?.usedFonts) && metadataFromEditor.usedFonts.length > 0
          ? metadataFromEditor.usedFonts
          : deriveUsedFontsFromFabricObjects(fabricObjects),
      warnings: metadataFromEditor?.warnings || [],
      assetManifest: sanitizedImportPayload.assetManifest,
    },
    {
      page: {
        width: dimensions.canvasWidth,
        height: dimensions.canvasHeight,
      },
    }
  );
  const layerCount = importMetadata?.layerStats?.detected || (hasFabricData ? fabricObjects.length : 1);
  const customFonts = normalizeIncomingCustomFonts(editorData);
  const importedFontCategoryHints = deriveImportedFontCategoryHints(fabricData);
  let importedCustomFonts = 0;
  const importWarnings = Array.isArray(importMetadata?.warnings) ? [...importMetadata.warnings] : [];
  if (Array.isArray(prunedBaseShape.warnings) && prunedBaseShape.warnings.length > 0) {
    importWarnings.push(...prunedBaseShape.warnings);
  }
  if (Array.isArray(prunedSyntheticBackground.warnings) && prunedSyntheticBackground.warnings.length > 0) {
    importWarnings.push(...prunedSyntheticBackground.warnings);
  }
  if (Array.isArray(prunedFallbackEdgeOverlay.warnings) && prunedFallbackEdgeOverlay.warnings.length > 0) {
    importWarnings.push(...prunedFallbackEdgeOverlay.warnings);
  }
  if (Array.isArray(prunedFullPageSnapshotCrop.warnings) && prunedFullPageSnapshotCrop.warnings.length > 0) {
    importWarnings.push(...prunedFullPageSnapshotCrop.warnings);
  }
  if (layerCropFallbackWarnings.length > 0) {
    importWarnings.push(...layerCropFallbackWarnings);
  }
  if (Array.isArray(sanitizedImportPayload?.warnings) && sanitizedImportPayload.warnings.length > 0) {
    importWarnings.push(...sanitizedImportPayload.warnings);
  }
  if (forcedSnapshotFallbackWarning) {
    importWarnings.push(forcedSnapshotFallbackWarning);
  }

  if (customFonts.length > 0) {
    for (let index = 0; index < customFonts.length; index += 1) {
      const font = customFonts[index];
      try {
        const inferredCategories =
          importedFontCategoryHints.get(String(font.family || "").toLowerCase()) ||
          sanitizeFontCategories(font.categories, font.family);
        const fontResult = await upsertEditorCustomFont({
          family: font.family,
          dataUrl: font.dataUrl,
          mimeType: font.mimeType,
          fileName: font.fileName || `${font.family}.ttf`,
          categories: inferredCategories,
        });
        const conversionStatus = String(fontResult?.font?.conversionStatus || "").trim().toLowerCase();
        if (conversionStatus === "ready") {
          importedCustomFonts += 1;
        } else {
          const conversionError = String(fontResult?.font?.conversionError || "").trim();
          importWarnings.push(
            conversionError
              ? `Imported font "${font.family}" was saved but is not mobile-ready yet: ${conversionError}`
              : `Imported font "${font.family}" was saved but is not mobile-ready yet.`
          );
        }
      } catch (error) {
        importWarnings.push(
          `Failed to register imported font "${font.family}": ${error?.message || "unknown error"}`
        );
      }
    }
  }
  importMetadata.warnings = Array.from(new Set(importWarnings.map((item) => String(item || "").trim()).filter(Boolean)));

  try {
    const template = await createImportedTemplate({
      ownerId: verification.userId,
      imageDataUrl,
      thumbnailDataUrl,
      fabricData,
      name: requestedName,
      slug: requestedSlug,
      canvasWidth: dimensions.canvasWidth,
      canvasHeight: dimensions.canvasHeight,
      sourceWidth: dimensions.sourceWidth,
      sourceHeight: dimensions.sourceHeight,
      tags: hasFabricData ? ["canva", "imported", "extension", "layers", "parity-v2"] : ["canva", "imported", "extension", "parity-v2"],
      action: "import-canva-extension",
      importMetadata,
    });

    requestLogger.info("Canva extension template imported", {
      templateId: String(template?.id || ""),
      layerCount,
      importedCustomFonts,
      warningsCount: Array.isArray(importMetadata.warnings)
        ? importMetadata.warnings.length
        : 0,
    });

    return withCorsRequest(
      NextResponse.json(
        {
          message: "Canva template imported from Chrome extension.",
          template,
          sourceUrl,
          layerCount,
          importVersion: importMetadata.importVersion,
          layerStats: importMetadata.layerStats,
          usedFonts: importMetadata.usedFonts,
          warnings: importMetadata.warnings,
          importedCustomFonts,
        },
        { status: 201 }
      )
    );
  } catch (error) {
    requestLogger.error("Failed to import extension template payload", {}, error);
    return withCorsRequest(
      NextResponse.json(
        {
          error: "Failed to import from extension.",
          details: error?.message || "Unknown extension import error.",
        },
        { status: 422 }
      )
    );
  }
  } catch (error) {
    requestLogger.error("Unhandled extension import error", {}, error);
    return withCorsRequest(
      NextResponse.json(
        {
          error: "Failed to import from extension.",
          details: error?.message || "Unexpected extension import error.",
        },
        { status: 500 }
      )
    );
  }
}
