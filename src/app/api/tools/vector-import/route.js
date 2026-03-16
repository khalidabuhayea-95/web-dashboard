import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { initializeCanvas, readPsd } from "ag-psd";
import { createCanvas } from "canvas";
import { NextResponse } from "next/server";
import { PNG } from "pngjs";

import { extractFabricData } from "@/lib/templates/editorData";
import { getEditorSession, normalizeSlug } from "@/lib/templates/server";
import { createImportedTemplate } from "@/lib/tools/canvaImportTemplate";
import {
  buildImportMetadata,
  buildLayerTreeFromFabricObjects,
  deriveLayerStatsFromFabricObjects,
} from "@/lib/tools/importParity";

export const runtime = "nodejs";
export const maxDuration = 120;
const execFile = promisify(execFileCallback);

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampDimension(value, fallback = 1080) {
  const numeric = Math.round(numberOr(value, fallback));
  return Math.min(8192, Math.max(1, numeric));
}

function parseImportName(name, fileName) {
  const providedName = String(name || "").trim();
  if (providedName) return providedName;
  const fromFile = String(fileName || "")
    .replace(/\.(svg|pdf|psd)$/i, "")
    .trim();
  if (fromFile) return fromFile;
  return `Imported Vector Template ${new Date().toISOString().slice(0, 10)}`;
}

function parseImportSlug(slug, name) {
  const provided = String(slug || "").trim();
  if (provided) return provided;
  return normalizeSlug(name);
}

function parseThumbnailDataUrl(value) {
  const source = String(value || "").trim();
  if (!source.startsWith("data:image/")) return "";
  if (!source.includes(";base64,")) return "";
  return source;
}

function bufferToDataUrl(buffer, mime = "image/png") {
  if (!buffer || buffer.length === 0) return "";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function getImageDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 4 >= buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (!segmentLength || segmentLength < 2) break;
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && offset + 8 < buffer.length) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      offset += 2 + segmentLength;
    }
  }

  return null;
}

function buildSingleImageFabricData(imageDataUrl, width, height, layerName = "Imported Artwork") {
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
        width,
        height,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        opacity: 1,
        src: imageDataUrl,
        layerType: "image",
        layerName,
        layerLocked: false,
        layerHidden: false,
        sourceWidth: width,
        sourceHeight: height,
      },
    ],
  };
}

let agPsdCanvasReady = false;

function createBlankImageData(width, height) {
  const safeWidth = clampDimension(width, 1);
  const safeHeight = clampDimension(height, 1);
  return {
    width: safeWidth,
    height: safeHeight,
    data: new Uint8ClampedArray(safeWidth * safeHeight * 4),
  };
}

function initializeAgPsdCanvas() {
  if (agPsdCanvasReady) return;

  const agCreateCanvas = (width, height) => {
    const safeWidth = clampDimension(width, 1);
    const safeHeight = clampDimension(height, 1);
    return createCanvas(safeWidth, safeHeight);
  };

  const agCreateImageData = (width, height) => {
    const safeWidth = clampDimension(width, 1);
    const safeHeight = clampDimension(height, 1);
    const canvas = createCanvas(safeWidth, safeHeight);
    const context = canvas.getContext("2d");
    return context.createImageData(safeWidth, safeHeight);
  };

  initializeCanvas(agCreateCanvas, agCreateImageData);
  agPsdCanvasReady = true;
}

function normalizePsdImageData(imageData, fallbackWidth, fallbackHeight) {
  if (!imageData || typeof imageData !== "object") return null;
  const width = clampDimension(imageData.width, fallbackWidth || 1);
  const height = clampDimension(imageData.height, fallbackHeight || 1);
  const expectedLength = width * height * 4;

  let data = imageData.data;
  if (!data) return null;

  if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    if (data instanceof Uint16Array) {
      const converted = new Uint8ClampedArray(expectedLength);
      const length = Math.min(expectedLength, data.length);
      for (let index = 0; index < length; index += 1) {
        converted[index] = Math.max(0, Math.min(255, data[index] >> 8));
      }
      data = converted;
    } else if (data instanceof Float32Array || data instanceof Float64Array) {
      const converted = new Uint8ClampedArray(expectedLength);
      const length = Math.min(expectedLength, data.length);
      for (let index = 0; index < length; index += 1) {
        const value = data[index] * 255;
        converted[index] = Number.isFinite(value)
          ? Math.max(0, Math.min(255, Math.round(value)))
          : 0;
      }
      data = converted;
    } else if (ArrayBuffer.isView(data)) {
      data = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return null;
    }
  }

  const normalized = new Uint8ClampedArray(expectedLength);
  const availableLength = Math.min(expectedLength, data.length);
  normalized.set(data.subarray(0, availableLength), 0);
  return { width, height, data: normalized };
}

function normalizePsdCanvasImageData(canvas, fallbackWidth, fallbackHeight) {
  if (!canvas || typeof canvas !== "object") return null;

  const width = clampDimension(canvas.width, fallbackWidth || 1);
  const height = clampDimension(canvas.height, fallbackHeight || 1);
  if (width <= 0 || height <= 0) return null;

  if (canvas.data) {
    const normalizedFromData = normalizePsdImageData(canvas, width, height);
    if (normalizedFromData) return normalizedFromData;
  }

  if (typeof canvas.getContext !== "function") return null;
  try {
    const context = canvas.getContext("2d");
    if (!context || typeof context.getImageData !== "function") return null;
    const imageData = context.getImageData(0, 0, width, height);
    return normalizePsdImageData(imageData, width, height);
  } catch (_error) {
    return null;
  }
}

function getPsdLayerImageData(layer) {
  const fallbackWidth = Math.max(1, Math.round(numberOr(layer?.right, 0) - numberOr(layer?.left, 0)));
  const fallbackHeight = Math.max(1, Math.round(numberOr(layer?.bottom, 0) - numberOr(layer?.top, 0)));
  return (
    normalizePsdImageData(layer?.imageData, fallbackWidth, fallbackHeight) ||
    normalizePsdCanvasImageData(layer?.canvas, fallbackWidth, fallbackHeight)
  );
}

const PSD_BLEND_MODE_TO_FABRIC = {
  normal: "source-over",
  "pass through": "source-over",
  dissolve: "source-over",
  darken: "darken",
  multiply: "multiply",
  "color burn": "color-burn",
  "linear burn": "multiply",
  "darker color": "darken",
  lighten: "lighten",
  screen: "screen",
  "color dodge": "color-dodge",
  "linear dodge": "screen",
  "lighter color": "lighten",
  overlay: "overlay",
  "soft light": "soft-light",
  "hard light": "hard-light",
  "vivid light": "hard-light",
  "linear light": "hard-light",
  "pin light": "hard-light",
  "hard mix": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  subtract: "difference",
  divide: "screen",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

function mapPsdBlendModeToFabric(value) {
  const normalized = String(value || "normal")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const composite = PSD_BLEND_MODE_TO_FABRIC[normalized];
  if (!composite) {
    return {
      raw: normalized || "normal",
      supported: false,
      composite: "source-over",
    };
  }
  return {
    raw: normalized || "normal",
    supported: true,
    composite,
  };
}

function hasEnabledPsdEffects(layer) {
  const effects = layer?.effects;
  if (!effects || typeof effects !== "object") return false;

  const isEffectEnabled = (value) => {
    if (Array.isArray(value)) return value.some((item) => isEffectEnabled(item));
    if (typeof value === "boolean") return value;
    if (!value || typeof value !== "object") return false;
    if ("enabled" in value) return Boolean(value.enabled);
    if ("present" in value) return Boolean(value.present);
    return Object.keys(value).length > 0;
  };

  return Object.values(effects).some((effect) => isEffectEnabled(effect));
}

function hasPsdAdjustmentLayer(layer) {
  return Boolean(layer?.adjustment && typeof layer.adjustment === "object");
}

function resolvePsdLayerBounds(layer, imageData = null) {
  let left = Math.round(numberOr(layer?.left, 0));
  let top = Math.round(numberOr(layer?.top, 0));
  let right = Math.round(numberOr(layer?.right, left));
  let bottom = Math.round(numberOr(layer?.bottom, top));
  if (right <= left && imageData?.width) right = left + imageData.width;
  if (bottom <= top && imageData?.height) bottom = top + imageData.height;
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function collectRenderablePsdLayers(children, target = []) {
  if (!Array.isArray(children)) return target;
  for (const layer of children) {
    if (layer?.children?.length) {
      collectRenderablePsdLayers(layer.children, target);
    }
    const isVisible = !layer?.hidden && numberOr(layer?.opacity, 1) > 0;
    if (!isVisible) continue;

    const normalized = getPsdLayerImageData(layer);
    const hasText =
      layer?.text &&
      typeof layer.text === "object" &&
      typeof layer.text.text === "string" &&
      layer.text.text.trim().length > 0;
    if (normalized || hasText) {
      target.push({
        layer,
        name: String(layer?.name || "").trim(),
        left: Math.round(numberOr(layer?.left, 0)),
        top: Math.round(numberOr(layer?.top, 0)),
        right: Math.round(numberOr(layer?.right, 0)),
        bottom: Math.round(numberOr(layer?.bottom, 0)),
        opacity: Math.max(0, Math.min(1, numberOr(layer?.opacity, 1))),
        imageData: normalized,
        hasText,
      });
    }
  }
  return target;
}

function blendLayerOntoCanvas(destination, destinationWidth, destinationHeight, layer) {
  if (!layer?.imageData || !destination) return;
  const sourceWidth = layer.imageData.width;
  const sourceHeight = layer.imageData.height;
  const sourcePixels = layer.imageData.data;
  const destPixels = destination.data;
  const layerOpacity = Math.max(0, Math.min(1, numberOr(layer.opacity, 1)));
  if (layerOpacity <= 0) return;

  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    const targetY = layer.top + sourceY;
    if (targetY < 0 || targetY >= destinationHeight) continue;

    for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
      const targetX = layer.left + sourceX;
      if (targetX < 0 || targetX >= destinationWidth) continue;

      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const targetIndex = (targetY * destinationWidth + targetX) * 4;
      const sourceAlpha = (sourcePixels[sourceIndex + 3] / 255) * layerOpacity;
      if (sourceAlpha <= 0) continue;

      const targetAlpha = destPixels[targetIndex + 3] / 255;
      const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) continue;

      destPixels[targetIndex + 0] = Math.round(
        ((sourcePixels[sourceIndex + 0] * sourceAlpha) +
          (destPixels[targetIndex + 0] * targetAlpha * (1 - sourceAlpha))) /
          outAlpha
      );
      destPixels[targetIndex + 1] = Math.round(
        ((sourcePixels[sourceIndex + 1] * sourceAlpha) +
          (destPixels[targetIndex + 1] * targetAlpha * (1 - sourceAlpha))) /
          outAlpha
      );
      destPixels[targetIndex + 2] = Math.round(
        ((sourcePixels[sourceIndex + 2] * sourceAlpha) +
          (destPixels[targetIndex + 2] * targetAlpha * (1 - sourceAlpha))) /
          outAlpha
      );
      destPixels[targetIndex + 3] = Math.round(outAlpha * 255);
    }
  }
}

function flattenPsdLayers(psd) {
  const width = clampDimension(psd?.width, 1);
  const height = clampDimension(psd?.height, 1);
  const flattened = createBlankImageData(width, height);
  const renderableLayers = collectRenderablePsdLayers(psd?.children || []);
  if (!renderableLayers.length) return null;

  // PSD children are typically listed top-to-bottom, so we composite in reverse.
  for (let index = renderableLayers.length - 1; index >= 0; index -= 1) {
    blendLayerOntoCanvas(flattened, width, height, renderableLayers[index]);
  }
  return flattened;
}

function scaleImageData(imageData, targetWidth, targetHeight) {
  const width = clampDimension(imageData?.width, 1);
  const height = clampDimension(imageData?.height, 1);
  const resolvedTargetWidth = clampDimension(targetWidth, width);
  const resolvedTargetHeight = clampDimension(targetHeight, height);
  if (resolvedTargetWidth === width && resolvedTargetHeight === height) {
    return imageData;
  }

  const sourcePixels = imageData.data;
  const scaledPixels = new Uint8ClampedArray(resolvedTargetWidth * resolvedTargetHeight * 4);

  for (let y = 0; y < resolvedTargetHeight; y += 1) {
    const sourceY = Math.min(
      height - 1,
      Math.round((y / Math.max(1, resolvedTargetHeight - 1)) * (height - 1))
    );
    for (let x = 0; x < resolvedTargetWidth; x += 1) {
      const sourceX = Math.min(
        width - 1,
        Math.round((x / Math.max(1, resolvedTargetWidth - 1)) * (width - 1))
      );
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (y * resolvedTargetWidth + x) * 4;
      scaledPixels[targetIndex + 0] = sourcePixels[sourceIndex + 0];
      scaledPixels[targetIndex + 1] = sourcePixels[sourceIndex + 1];
      scaledPixels[targetIndex + 2] = sourcePixels[sourceIndex + 2];
      scaledPixels[targetIndex + 3] = sourcePixels[sourceIndex + 3];
    }
  }

  return {
    width: resolvedTargetWidth,
    height: resolvedTargetHeight,
    data: scaledPixels,
  };
}

function scaleImageDataIfNeeded(imageData, maxDimension) {
  const maxSide = clampDimension(maxDimension, 1920);
  const width = clampDimension(imageData?.width, 1);
  const height = clampDimension(imageData?.height, 1);
  const largestSide = Math.max(width, height);
  if (!largestSide || largestSide <= maxSide) return imageData;
  const scale = maxSide / largestSide;
  return scaleImageData(imageData, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
}

function hasVisiblePixels(imageData, minimumOpaquePixels = 4) {
  if (!imageData?.data || !Number.isFinite(minimumOpaquePixels)) return false;
  let visibleCount = 0;
  for (let index = 3; index < imageData.data.length; index += 4) {
    if (imageData.data[index] > 8) {
      visibleCount += 1;
      if (visibleCount >= minimumOpaquePixels) return true;
    }
  }
  return false;
}

function normalizePsdColorChannel(value) {
  const numeric = numberOr(value, 0);
  if (!Number.isFinite(numeric)) return 0;
  const channel = numeric <= 1 ? numeric * 255 : numeric;
  return Math.max(0, Math.min(255, Math.round(channel)));
}

function psdColorToCss(color, fallback = "rgb(255,255,255)") {
  if (!color || typeof color !== "object") return fallback;
  const red = normalizePsdColorChannel(color.r);
  const green = normalizePsdColorChannel(color.g);
  const blue = normalizePsdColorChannel(color.b);
  return `rgb(${red},${green},${blue})`;
}

function mapPsdTextAlign(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "center") return "center";
  if (normalized === "right") return "right";
  if (normalized === "justify") return "justify";
  return "left";
}

const PSD_FONT_FAMILY_ALIASES = {
  "fredokaone regular": "Fredoka One",
  "fredokaone": "Fredoka One",
  "dejavusans": "DejaVu Sans",
  "dejavusans bold": "DejaVu Sans",
  "dejavusans oblique": "DejaVu Sans",
  "dejavusans boldoblique": "DejaVu Sans",
};

function normalizePsdFontFamily(fontName) {
  const raw = String(fontName || "").trim();
  if (!raw) return "Arial";
  const normalized = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const canonicalKey = normalized.toLowerCase();
  if (PSD_FONT_FAMILY_ALIASES[canonicalKey]) {
    return PSD_FONT_FAMILY_ALIASES[canonicalKey];
  }
  const stripped = normalized
    .replace(/\b(regular|book|roman|normal|medium|semi\s*bold|semibold|demi|bold|black|light)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || normalized;
}

function inferPsdFontWeight(style) {
  if (style?.fauxBold) return "bold";
  const fontName = String(style?.font?.name || "")
    .trim()
    .toLowerCase();
  if (!fontName) return "normal";
  if (fontName.includes("black")) return 900;
  if (fontName.includes("extra") && fontName.includes("bold")) return 800;
  if (fontName.includes("semi") && fontName.includes("bold")) return 600;
  if (fontName.includes("demi")) return 600;
  if (fontName.includes("bold")) return "bold";
  if (fontName.includes("light")) return 300;
  return "normal";
}

function inferPsdFontStyle(style) {
  if (style?.fauxItalic) return "italic";
  const fontName = String(style?.font?.name || "")
    .trim()
    .toLowerCase();
  if (fontName.includes("italic") || fontName.includes("oblique")) return "italic";
  return "normal";
}

function buildPsdTextObject(entry, globalScale, index) {
  const textData = entry?.layer?.text;
  const textValue = String(textData?.text || "").replace(/\r/g, "");
  if (!textValue.trim()) return null;

  const style = textData?.style || {};
  const paragraphStyle = textData?.paragraphStyle || {};
  const rectWidth = Math.max(8, Math.round(Math.max(1, entry.right - entry.left) * globalScale));
  const rectHeight = Math.max(8, Math.round(Math.max(1, entry.bottom - entry.top) * globalScale));
  const fontSizeRaw = Math.max(2, numberOr(style.fontSize, 24));
  const fontSize = Math.max(2, Math.round(fontSizeRaw * globalScale));
  const leadingValue = numberOr(style.leading, 0);
  const lineHeight =
    leadingValue > 0 && fontSizeRaw > 0
      ? Math.max(0.6, Math.min(4, leadingValue / fontSizeRaw))
      : 1.2;

  return {
    type: "Textbox",
    version: "7.0.0",
    originX: "left",
    originY: "top",
    left: Math.round(entry.left * globalScale),
    top: Math.round(entry.top * globalScale),
    width: rectWidth,
    height: rectHeight,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: Math.max(0, Math.min(1, numberOr(entry.opacity, 1))),
    text: textValue,
    fontFamily: normalizePsdFontFamily(style?.font?.name),
    fontSize,
    fontWeight: inferPsdFontWeight(style),
    fontStyle: inferPsdFontStyle(style),
    fill: psdColorToCss(style?.fillColor, "rgb(255,255,255)"),
    textAlign: mapPsdTextAlign(paragraphStyle?.justification),
    lineHeight,
    charSpacing: Math.round(numberOr(style?.tracking, 0)),
    underline: Boolean(style?.underline),
    linethrough: Boolean(style?.strikethrough),
    layerType: "text",
    layerName: entry.name || `Text ${index + 1}`,
    layerLocked: false,
    layerHidden: false,
    globalCompositeOperation: entry?.blend?.composite || "source-over",
    blendMode: entry?.blend?.raw || "normal",
    fontName: String(style?.font?.name || "").trim() || undefined,
  };
}

function collectPsdImportLayers(children, depth = 0, target = []) {
  if (!Array.isArray(children)) return target;

  for (const layer of children) {
    const opacity = Math.max(0, Math.min(1, numberOr(layer?.opacity, 1)));
    if (layer?.hidden || opacity <= 0) continue;

    const imageData = getPsdLayerImageData(layer);
    const bounds = resolvePsdLayerBounds(layer, imageData);
    const hasText =
      layer?.text &&
      typeof layer.text === "object" &&
      typeof layer.text.text === "string" &&
      layer.text.text.trim().length > 0;
    const hasChildren = Array.isArray(layer?.children) && layer.children.length > 0;
    const hasMask = Boolean(layer?.mask || layer?.vectorMask);
    const hasEffects = hasEnabledPsdEffects(layer);
    const hasAdjustment = hasPsdAdjustmentLayer(layer);
    const blend = mapPsdBlendModeToFabric(layer?.blendMode);
    const hasRenderableImage =
      Boolean(imageData) &&
      imageData.width >= 2 &&
      imageData.height >= 2 &&
      bounds.width >= 2 &&
      bounds.height >= 2 &&
      hasVisiblePixels(imageData, 2);
    const name = String(layer?.name || "").trim();

    if (hasChildren) {
      const shouldFlattenGroup = depth > 0;
      if (shouldFlattenGroup && hasRenderableImage) {
        target.push({
          layer,
          name,
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          opacity,
          imageData,
          hasText: false,
          hasMask,
          hasEffects,
          hasAdjustment,
          blend,
          isGroup: true,
        });
        continue;
      }
      collectPsdImportLayers(layer.children, depth + 1, target);
      continue;
    }

    if (!hasText && !hasRenderableImage && !hasAdjustment) continue;
    target.push({
      layer,
      name,
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      opacity,
      imageData: hasRenderableImage ? imageData : null,
      hasText,
      hasMask,
      hasEffects,
      hasAdjustment,
      blend,
      isGroup: false,
    });
  }

  return target;
}

function collectPsdImportLayersV2(children, context = {}, target = [], tree = []) {
  if (!Array.isArray(children)) return { target, tree };

  const parentId = String(context?.parentId || "").trim() || null;
  const depth = Math.max(0, numberOr(context?.depth, 0));
  const sequence = context?.sequence && typeof context.sequence === "object"
    ? context.sequence
    : { value: 0 };

  for (let index = 0; index < children.length; index += 1) {
    const layer = children[index];
    const opacity = Math.max(0, Math.min(1, numberOr(layer?.opacity, 1)));
    if (layer?.hidden || opacity <= 0) continue;

    sequence.value += 1;
    const nodeId = `psd-layer-${sequence.value}`;
    const imageData = getPsdLayerImageData(layer);
    const bounds = resolvePsdLayerBounds(layer, imageData);
    const hasChildren = Array.isArray(layer?.children) && layer.children.length > 0;
    const hasText =
      layer?.text &&
      typeof layer.text === "object" &&
      typeof layer.text.text === "string" &&
      layer.text.text.trim().length > 0;
    const hasMask = Boolean(layer?.mask || layer?.vectorMask);
    const hasEffects = hasEnabledPsdEffects(layer);
    const hasAdjustment = hasPsdAdjustmentLayer(layer);
    const blend = mapPsdBlendModeToFabric(layer?.blendMode);
    const hasRenderableImage =
      Boolean(imageData) &&
      imageData.width >= 2 &&
      imageData.height >= 2 &&
      bounds.width >= 2 &&
      bounds.height >= 2 &&
      hasVisiblePixels(imageData, 2);
    const name = String(layer?.name || "").trim() || `PSD Layer ${sequence.value}`;
    const kind = hasChildren ? "group" : hasText ? "text" : hasRenderableImage ? "image" : hasAdjustment ? "adjustment" : "unknown";
    const unsupportedSignals = hasMask || hasEffects || hasAdjustment || !blend?.supported;
    const fallbackReason = unsupportedSignals
      ? [
          hasMask ? "mask" : "",
          hasEffects ? "effects" : "",
          hasAdjustment ? "adjustment" : "",
          !blend?.supported ? `blend:${blend?.raw || "unsupported"}` : "",
        ]
          .filter(Boolean)
          .join(",")
      : "";

    tree.push({
      id: nodeId,
      parentId,
      zIndex: index,
      name,
      kind,
      bounds: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      transform: {
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity,
      },
      fallback: Boolean(fallbackReason),
      fallbackReason,
    });

    const entry = {
      nodeId,
      parentId,
      depth,
      layer,
      name,
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      opacity,
      imageData: hasRenderableImage ? imageData : null,
      hasText,
      hasMask,
      hasEffects,
      hasAdjustment,
      hasChildren,
      blend,
      kind,
      fallbackReason,
    };

    const preferGroupRaster =
      hasChildren &&
      hasRenderableImage &&
      (hasMask || hasEffects || hasAdjustment || !blend?.supported);

    if (preferGroupRaster) {
      target.push({
        ...entry,
        isGroup: true,
      });
      continue;
    }

    if (hasChildren) {
      collectPsdImportLayersV2(
        layer.children,
        { parentId: nodeId, depth: depth + 1, sequence },
        target,
        tree
      );
      continue;
    }

    if (!hasText && !hasRenderableImage && !hasAdjustment) continue;
    target.push({
      ...entry,
      isGroup: false,
    });
  }

  return { target, tree };
}

function shouldUseEditablePsdText(entry) {
  if (!entry?.hasText) return false;
  if (entry?.hasEffects || entry?.hasAdjustment) return false;
  if (entry?.hasMask) return false;
  if (!entry?.blend?.supported) return false;

  const warpStyle = String(entry?.layer?.text?.warp?.style || "")
    .trim()
    .toLowerCase();
  if (warpStyle && warpStyle !== "none") return false;

  const transform = Array.isArray(entry?.layer?.text?.transform) ? entry.layer.text.transform : null;
  if (transform && transform.length >= 6) {
    const horizontalScale = Math.abs(numberOr(transform[0], 1));
    const verticalScale = Math.abs(numberOr(transform[3], 1));
    const hasRotationOrSkew =
      Math.abs(numberOr(transform[1], 0)) > 0.0001 || Math.abs(numberOr(transform[2], 0)) > 0.0001;
    if (hasRotationOrSkew || horizontalScale <= 0 || verticalScale <= 0) {
      return false;
    }
  }

  return true;
}

function buildPsdImageObject(entry, layerImageData, left, top, index, options = {}) {
  const imagePngBuffer = encodeImageDataToPng(layerImageData);
  const imageDataUrl = bufferToDataUrl(imagePngBuffer, "image/png");
  const layerName = entry.name || `PSD Layer ${index + 1}`;
  const fallbackReason = String(options?.fallbackReason || entry?.fallbackReason || "").trim();
  return {
    type: "Image",
    version: "7.0.0",
    originX: "left",
    originY: "top",
    left,
    top,
    width: layerImageData.width,
    height: layerImageData.height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: Math.max(0, Math.min(1, numberOr(entry.opacity, 1))),
    src: imageDataUrl,
    layerType: entry.isGroup ? "group" : entry.hasText ? "text" : "image",
    layerName,
    layerLocked: false,
    layerHidden: false,
    sourceWidth: layerImageData.width,
    sourceHeight: layerImageData.height,
    globalCompositeOperation: entry?.blend?.composite || "source-over",
    blendMode: entry?.blend?.raw || "normal",
    importNodeId: String(options?.importNodeId || entry?.nodeId || `psd-layer-${index + 1}`),
    importParentId: String(options?.importParentId || entry?.parentId || "").trim() || null,
    importKind: String(options?.importKind || entry?.kind || "image"),
    fallback: Boolean(options?.fallback ?? Boolean(fallbackReason)),
    fallbackReason,
  };
}

function buildPsdLayerFabricData(psd, maxDimension) {
  const sourceWidth = clampDimension(psd?.width, 1);
  const sourceHeight = clampDimension(psd?.height, 1);
  const limit = clampDimension(maxDimension, 1920);
  const globalScale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const canvasWidth = Math.max(1, Math.round(sourceWidth * globalScale));
  const canvasHeight = Math.max(1, Math.round(sourceHeight * globalScale));
  const maxLayerObjects = 420;
  const { target: collectedLayers, tree } = collectPsdImportLayersV2(psd?.children || [], {
    parentId: null,
    depth: 0,
    sequence: { value: 0 },
  });
  const orderedLayers = [...collectedLayers].reverse();
  if (!orderedLayers.length) {
    return null;
  }

  const objects = [];
  const warnings = [];
  let editableCount = 0;
  let rasterizedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < orderedLayers.length; index += 1) {
    const entry = orderedLayers[index];
    if (index >= maxLayerObjects) {
      skippedCount += 1;
      continue;
    }

    if (shouldUseEditablePsdText(entry)) {
      const textObject = buildPsdTextObject(entry, globalScale, index);
      if (textObject) {
        textObject.importNodeId = String(entry.nodeId);
        textObject.importParentId = String(entry.parentId || "").trim() || null;
        textObject.importKind = "text";
        textObject.fallback = false;
        textObject.fallbackReason = "";
        objects.push(textObject);
        editableCount += 1;
        continue;
      }
    }

    if (entry.imageData) {
      let layerImageData = entry.imageData;
      let left = entry.left;
      let top = entry.top;

      if (globalScale < 1) {
        const nextWidth = Math.max(1, Math.round(entry.imageData.width * globalScale));
        const nextHeight = Math.max(1, Math.round(entry.imageData.height * globalScale));
        layerImageData = scaleImageData(entry.imageData, nextWidth, nextHeight);
        left = Math.round(left * globalScale);
        top = Math.round(top * globalScale);
      }

      const fallbackReason = String(
        entry.fallbackReason ||
          (entry.hasText && !shouldUseEditablePsdText(entry) ? "text-rasterized" : "") ||
          (!entry?.blend?.supported ? `blend:${entry?.blend?.raw || "unsupported"}` : "") ||
          (entry.hasAdjustment ? "adjustment" : "") ||
          (entry.hasEffects ? "effects" : "") ||
          (entry.hasMask ? "mask" : "")
      ).trim();
      const fallback = Boolean(fallbackReason);
      const imageObject = buildPsdImageObject(entry, layerImageData, left, top, index, {
        importNodeId: entry.nodeId,
        importParentId: entry.parentId,
        importKind: entry.isGroup ? "group" : entry.hasText ? "text" : "image",
        fallback,
        fallbackReason,
      });
      objects.push(imageObject);
      if (fallback) {
        rasterizedCount += 1;
      } else {
        editableCount += 1;
      }
      continue;
    }

    skippedCount += 1;
    warnings.push(`Skipped layer without renderable pixels: ${entry.name}`);
  }

  if (orderedLayers.length > maxLayerObjects) {
    warnings.push(
      `Layer cap reached (${maxLayerObjects}). ${orderedLayers.length - maxLayerObjects} layers were skipped.`
    );
  }

  if (!objects.length) return null;

  const detectedCount = tree.length > 0 ? tree.length : orderedLayers.length;
  const layerStats = {
    detected: detectedCount,
    editable: editableCount,
    rasterized: rasterizedCount,
    skipped: Math.max(skippedCount, detectedCount - editableCount - rasterizedCount),
  };
  const layerTree = tree.length > 0 ? tree : buildLayerTreeFromFabricObjects(objects);
  const importMetadata = buildImportMetadata({
    source: "psd-import",
    importVersion: 2,
    page: {
      id: "psd-page-1",
      name: "PSD Page 1",
      width: canvasWidth,
      height: canvasHeight,
      sourceWidth,
      sourceHeight,
    },
    layerTree,
    layerStats: deriveLayerStatsFromFabricObjects(objects),
    warnings,
  });
  importMetadata.layerStats = layerStats;

  return {
    layerCount: objects.length,
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight,
    layerStats,
    warnings,
    importMetadata,
    fabricData: {
      version: "7.0.0",
      objects,
    },
  };
}

function decodePsdDocument(fileBuffer) {
  initializeAgPsdCanvas();
  const psd = readPsd(fileBuffer, {
    useImageData: true,
    skipThumbnail: true,
    throwForMissingFeatures: false,
    logMissingFeatures: false,
  });
  const compositeImageData = normalizePsdImageData(psd?.imageData, psd?.width, psd?.height);
  const fallbackImageData = compositeImageData ? null : flattenPsdLayers(psd);
  return {
    psd,
    compositeImageData: compositeImageData || fallbackImageData,
  };
}

function encodeImageDataToPng(imageData) {
  const width = clampDimension(imageData?.width, 1);
  const height = clampDimension(imageData?.height, 1);
  const expectedLength = width * height * 4;
  if (!imageData?.data || imageData.data.length < expectedLength) {
    throw new Error("PSD image data is invalid.");
  }
  const png = new PNG({ width, height });
  png.data = Buffer.from(imageData.data.subarray(0, expectedLength));
  return PNG.sync.write(png);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function convertPsdDocumentToPng(fileBuffer, maxDimension) {
  const { compositeImageData } = decodePsdDocument(fileBuffer);
  const selectedImageData = compositeImageData;

  if (!selectedImageData) {
    throw new Error("PSD decoding succeeded but no renderable pixels were found.");
  }

  const scaled = scaleImageDataIfNeeded(selectedImageData, maxDimension);
  return encodeImageDataToPng(scaled);
}

async function convertPdfDocumentToPng(fileBuffer, maxDimension) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vector-import-"));
  const inputPath = path.join(tempDir, `${randomUUID()}.pdf`);
  const outputPngPath = path.join(tempDir, `${randomUUID()}.png`);
  const outputScaledPath = path.join(tempDir, `${randomUUID()}-scaled.png`);

  try {
    await fs.writeFile(inputPath, fileBuffer);
    const maxSide = clampDimension(maxDimension, 1920);
    let sipsError = null;

    try {
      await execFile("sips", ["-s", "format", "png", inputPath, "--out", outputPngPath], {
        maxBuffer: 16 * 1024 * 1024,
      });
      if (!(await pathExists(outputPngPath))) {
        throw new Error("Conversion did not produce a PNG output.");
      }

      let finalPath = outputPngPath;
      if (maxSide > 0) {
        try {
          await execFile("sips", ["-Z", String(maxSide), outputPngPath, "--out", outputScaledPath], {
            maxBuffer: 16 * 1024 * 1024,
          });
          if (await pathExists(outputScaledPath)) {
            finalPath = outputScaledPath;
          }
        } catch (_error) {
          finalPath = outputPngPath;
        }
      }

      return await fs.readFile(finalPath);
    } catch (error) {
      sipsError = error;
    }

    try {
      const quickLookOutputDir = path.join(tempDir, "ql");
      await fs.mkdir(quickLookOutputDir, { recursive: true });
      await execFile(
        "qlmanage",
        ["-t", "-s", String(maxSide || 1920), "-o", quickLookOutputDir, inputPath],
        { maxBuffer: 16 * 1024 * 1024 }
      );
      const quickLookFiles = await fs.readdir(quickLookOutputDir);
      const pngFileName = quickLookFiles.find((entry) => entry.toLowerCase().endsWith(".png"));
      if (!pngFileName) {
        throw new Error("QuickLook did not produce a PNG output.");
      }
      const quickLookPath = path.join(quickLookOutputDir, pngFileName);
      return await fs.readFile(quickLookPath);
    } catch (quickLookError) {
      const sipsMessage = sipsError?.message || "Unknown sips error.";
      const quickLookMessage = quickLookError?.message || "Unknown QuickLook error.";
      throw new Error(
        `Document conversion failed. sips: ${sipsMessage}. qlmanage: ${quickLookMessage}`
      );
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function inferRasterUploadFormat(file, explicitFormat = "") {
  const requested = String(explicitFormat || "").trim().toLowerCase();
  if (requested === "pdf" || requested === "psd") return requested;
  const fileName = String(file?.name || "").trim().toLowerCase();
  const mime = String(file?.type || "").trim().toLowerCase();
  if (fileName.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (
    fileName.endsWith(".psd") ||
    mime === "image/vnd.adobe.photoshop" ||
    mime === "application/vnd.adobe.photoshop" ||
    mime === "application/photoshop" ||
    mime === "application/x-photoshop"
  ) {
    return "psd";
  }
  return "";
}

function inferRasterUploadFormatFromMeta({ explicitFormat = "", fileName = "", mime = "" }) {
  const requested = String(explicitFormat || "").trim().toLowerCase();
  if (requested === "pdf" || requested === "psd") return requested;

  const normalizedName = String(fileName || "").trim().toLowerCase();
  const normalizedMime = String(mime || "").trim().toLowerCase();

  if (normalizedName.endsWith(".pdf") || normalizedMime.includes("application/pdf")) {
    return "pdf";
  }
  if (
    normalizedName.endsWith(".psd") ||
    normalizedMime.includes("image/vnd.adobe.photoshop") ||
    normalizedMime.includes("application/vnd.adobe.photoshop") ||
    normalizedMime.includes("application/photoshop") ||
    normalizedMime.includes("application/x-photoshop")
  ) {
    return "psd";
  }
  return "";
}

async function importRasterDocument(session, params) {
  const fileName = String(params?.fileName || "").trim();
  const normalizedFormat = String(params?.format || "").trim().toLowerCase();
  const fileBytes = Buffer.isBuffer(params?.fileBytes) ? params.fileBytes : null;
  if (!fileBytes || !["pdf", "psd"].includes(normalizedFormat)) {
    return NextResponse.json(
      { error: "Upload a valid PDF or PSD file." },
      { status: 400 }
    );
  }

  const requestedName = parseImportName(params?.name, fileName);
  const requestedSlug = parseImportSlug(params?.slug, requestedName);
  const maxDimension = clampDimension(params?.maxDimension, 1920);

  if (fileBytes.length === 0) {
    return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
  }

  try {
    if (normalizedFormat === "psd") {
      const { psd, compositeImageData } = decodePsdDocument(fileBytes);
      const layered = buildPsdLayerFabricData(psd, maxDimension);
      if (layered && Array.isArray(layered.fabricData?.objects) && layered.fabricData.objects.length > 0) {
        let previewDataUrl = "";
        if (compositeImageData) {
          const previewPngBuffer = encodeImageDataToPng(
            scaleImageDataIfNeeded(compositeImageData, Math.min(1280, maxDimension))
          );
          previewDataUrl = bufferToDataUrl(previewPngBuffer, "image/png");
        }
        if (!previewDataUrl) {
          previewDataUrl = String(
            layered.fabricData.objects.find((object) => String(object?.src || "").startsWith("data:image/"))?.src || ""
          );
        }

        const template = await createImportedTemplate({
          ownerId: session.userId,
          imageDataUrl: previewDataUrl,
          thumbnailDataUrl: previewDataUrl,
          fabricData: layered.fabricData,
          importMetadata: layered.importMetadata,
          name: requestedName,
          slug: requestedSlug,
          canvasWidth: layered.canvasWidth,
          canvasHeight: layered.canvasHeight,
          sourceWidth: layered.sourceWidth,
          sourceHeight: layered.sourceHeight,
          tags: [normalizedFormat, "imported", "vector", "layers", "parity-v2"],
          action: "import-psd",
        });

        return NextResponse.json(
          {
            message: "PSD template imported with layer parity.",
            template,
            layerCount: layered.layerCount,
            importVersion: layered.importMetadata?.importVersion || 2,
            layerStats: layered.importMetadata?.layerStats || layered.layerStats || null,
            warnings: layered.importMetadata?.warnings || layered.warnings || [],
          },
          { status: 201 }
        );
      }

      const pngBuffer = await convertPsdDocumentToPng(fileBytes, maxDimension);
      const dimensions = getImageDimensions(pngBuffer);
      const width = clampDimension(dimensions?.width, 1080);
      const height = clampDimension(dimensions?.height, 1080);
      const imageDataUrl = bufferToDataUrl(pngBuffer, "image/png");
      const singleImageFabric = buildSingleImageFabricData(
        imageDataUrl,
        width,
        height,
        "Imported PSD Artwork"
      );
      const importMetadata = buildImportMetadata({
        source: "psd-import",
        importVersion: 2,
        page: {
          id: "psd-page-1",
          name: "PSD Page 1",
          width,
          height,
          sourceWidth: width,
          sourceHeight: height,
        },
        layerTree: buildLayerTreeFromFabricObjects(singleImageFabric.objects),
        layerStats: {
          detected: 1,
          editable: 0,
          rasterized: 1,
          skipped: 0,
        },
        warnings: ["Layer-parity extraction failed. Imported composite snapshot."],
      });

      const template = await createImportedTemplate({
        ownerId: session.userId,
        imageDataUrl,
        thumbnailDataUrl: imageDataUrl,
        fabricData: singleImageFabric,
        importMetadata,
        name: requestedName,
        slug: requestedSlug,
        canvasWidth: width,
        canvasHeight: height,
        sourceWidth: width,
        sourceHeight: height,
        tags: [normalizedFormat, "imported", "vector", "raster", "parity-v2"],
        action: "import-psd",
      });

      return NextResponse.json(
        {
          message: "PSD template imported as composite snapshot fallback.",
          template,
          layerCount: 1,
          importVersion: importMetadata.importVersion,
          layerStats: importMetadata.layerStats,
          warnings: importMetadata.warnings,
        },
        { status: 201 }
      );
    }

    const pngBuffer = await convertPdfDocumentToPng(fileBytes, maxDimension);
    const dimensions = getImageDimensions(pngBuffer);
    const width = clampDimension(dimensions?.width, 1080);
    const height = clampDimension(dimensions?.height, 1080);
    const imageDataUrl = bufferToDataUrl(pngBuffer, "image/png");
    const fabricData = buildSingleImageFabricData(imageDataUrl, width, height, "Imported PDF Page 1");

    const template = await createImportedTemplate({
      ownerId: session.userId,
      imageDataUrl,
      thumbnailDataUrl: imageDataUrl,
      fabricData,
      name: requestedName,
      slug: requestedSlug,
      canvasWidth: width,
      canvasHeight: height,
      sourceWidth: width,
      sourceHeight: height,
      tags: [normalizedFormat, "imported", "vector", "raster"],
      action: "import-pdf",
    });

    return NextResponse.json(
      {
        message: "PDF template imported (page 1 rasterized).",
        template,
        layerCount: 1,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to import file.",
        details: error?.message || "Unknown raster import error.",
      },
      { status: 422 }
    );
  }
}

export async function runVectorRasterImportForOwner({
  ownerId,
  fileBytes,
  fileName,
  name,
  slug,
  maxDimension,
  format,
}) {
  const response = await importRasterDocument(
    { userId: String(ownerId || "").trim() },
    {
      fileBytes,
      fileName,
      name,
      slug,
      maxDimension,
      format,
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      String(payload?.details || payload?.error || "Failed to import file.")
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function parseDataUrlToBuffer(dataUrl) {
  const source = String(dataUrl || "").trim();
  if (!source.startsWith("data:")) return null;
  const marker = ";base64,";
  const markerIndex = source.indexOf(marker);
  if (markerIndex <= 0) return null;
  const base64Value = source.slice(markerIndex + marker.length);
  try {
    return Buffer.from(base64Value, "base64");
  } catch (_error) {
    return null;
  }
}

async function importRasterDocumentFromJson(session, body) {
  const format = String(body?.format || "").trim().toLowerCase();
  if (!["pdf", "psd"].includes(format)) {
    return NextResponse.json(
      { error: "Unsupported raster format in JSON payload." },
      { status: 400 }
    );
  }

  const fileDataUrl = String(body?.fileDataUrl || "").trim();
  const fileBytes = parseDataUrlToBuffer(fileDataUrl);
  if (!fileBytes) {
    return NextResponse.json(
      { error: "Invalid fileDataUrl. Expected base64 data URL." },
      { status: 400 }
    );
  }

  return importRasterDocument(session, {
    fileBytes,
    fileName: String(body?.fileName || "").trim(),
    name: body?.name,
    slug: body?.slug,
    maxDimension: body?.maxDimension,
    format,
  });
}

export async function POST(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const url = new URL(request.url);
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();

  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/json")) {
    const rawHeaderFileName = String(request.headers.get("x-file-name") || "");
    let decodedFileName = rawHeaderFileName;
    try {
      decodedFileName = decodeURIComponent(rawHeaderFileName);
    } catch (_error) {
      decodedFileName = rawHeaderFileName;
    }
    const format = inferRasterUploadFormatFromMeta({
      explicitFormat: url.searchParams.get("format"),
      fileName: decodedFileName,
      mime: contentType,
    });
    if (format === "pdf" || format === "psd") {
      const fileBytes = Buffer.from(await request.arrayBuffer());
      return importRasterDocument(session, {
        fileBytes,
        fileName: decodedFileName,
        name: url.searchParams.get("name"),
        slug: url.searchParams.get("slug"),
        maxDimension: url.searchParams.get("maxDimension"),
        format,
      });
    }
  }

  if (contentType.includes("multipart/form-data")) {
    let formData;
    try {
      formData = await request.formData();
    } catch (_error) {
      return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
    }
    const file = formData.get("file");
    const format = inferRasterUploadFormat(file, formData.get("format"));
    if (format === "pdf" || format === "psd") {
      const fileBytes = file && typeof file.arrayBuffer === "function"
        ? Buffer.from(await file.arrayBuffer())
        : null;
      return importRasterDocument(session, {
        fileBytes,
        fileName: String(file?.name || "").trim(),
        name: formData.get("name"),
        slug: formData.get("slug"),
        maxDimension: formData.get("maxDimension"),
        format,
      });
    }
    return NextResponse.json(
      { error: "Unsupported multipart format. Use PDF or PSD for file uploads." },
      { status: 400 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const format = String(body?.format || "svg").trim().toLowerCase();
  if (format === "pdf" || format === "psd") {
    return importRasterDocumentFromJson(session, body);
  }
  if (format !== "svg") {
    return NextResponse.json(
      {
        error: "Unsupported vector format.",
        details: "Use SVG JSON import or PDF/PSD upload.",
      },
      { status: 400 }
    );
  }

  const fabricData = extractFabricData(body?.fabricData) || extractFabricData(body?.editorData);
  const hasFabricData = Boolean(
    fabricData &&
      typeof fabricData === "object" &&
      Array.isArray(fabricData.objects) &&
      fabricData.objects.length > 0
  );

  if (!hasFabricData) {
    return NextResponse.json(
      { error: "Missing fabricData objects for SVG import." },
      { status: 400 }
    );
  }

  const canvasWidth = clampDimension(body?.canvasWidth, 1080);
  const canvasHeight = clampDimension(body?.canvasHeight, 1080);
  const sourceWidth = clampDimension(body?.sourceWidth, canvasWidth);
  const sourceHeight = clampDimension(body?.sourceHeight, canvasHeight);
  const requestedName = parseImportName(body?.name, body?.fileName);
  const requestedSlug = parseImportSlug(body?.slug, requestedName);
  const thumbnailDataUrl = parseThumbnailDataUrl(body?.thumbnailDataUrl);

  try {
    const template = await createImportedTemplate({
      ownerId: session.userId,
      imageDataUrl: "",
      thumbnailDataUrl,
      fabricData,
      name: requestedName,
      slug: requestedSlug,
      canvasWidth,
      canvasHeight,
      sourceWidth,
      sourceHeight,
      tags: ["svg", "imported", "vector", "layers"],
      action: "import-svg",
    });

    return NextResponse.json(
      {
        message: "SVG template imported successfully.",
        template,
        layerCount: fabricData.objects.length,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to import SVG template.",
        details: error?.message || "Unknown SVG import error.",
      },
      { status: 422 }
    );
  }
}
