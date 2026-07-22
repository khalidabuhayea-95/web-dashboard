import type { EditorElement, EditorPage } from "@/store/editorStore";
import type { FrameShape } from "@/lib/editor/frames";

type ImageElement = EditorElement & { type: "image" };

type ImageCanvasPatchResult = {
  supported: boolean;
  patch: Partial<EditorElement> | null;
  reason?: string;
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const EPSILON = 0.0001;
const ROTATION_TOLERANCE = 0.001;
const DEFAULT_ALPHA_THRESHOLD = 8;
const MAX_TRIM_SCAN_SIDE = 4096;
const EDGE_BACKGROUND_MIN_CHANNEL = 240;
const EDGE_BACKGROUND_WHITE_DISTANCE = 32;
const MAX_ALPHA_SHAPE_SAMPLES = 28;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeScale(value: unknown) {
  const next = toNumber(value, 1);
  if (Math.abs(next) < EPSILON) return 1;
  return next;
}

function resolveSourceDimension(value: unknown, fallback: number) {
  const next = toNumber(value, fallback);
  return Math.max(1, next);
}

function resolveCurrentCrop(
  element: ImageElement,
  sourceWidth: number,
  sourceHeight: number
) {
  const cropX = clamp(toNumber(element.cropX, 0), 0, sourceWidth - 1);
  const cropY = clamp(toNumber(element.cropY, 0), 0, sourceHeight - 1);
  const cropWidth = clamp(
    toNumber(element.cropWidth, sourceWidth),
    1,
    sourceWidth - cropX
  );
  const cropHeight = clamp(
    toNumber(element.cropHeight, sourceHeight),
    1,
    sourceHeight - cropY
  );

  return { cropX, cropY, cropWidth, cropHeight };
}

function rectIntersection(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, right, bottom };
}

function visualFrameRect(element: ImageElement) {
  const width = Math.max(1, toNumber(element.width, 1));
  const height = Math.max(1, toNumber(element.height, 1));
  const scaleX = normalizeScale(element.scaleX);
  const scaleY = normalizeScale(element.scaleY);
  const x = toNumber(element.x, 0);
  const y = toNumber(element.y, 0);
  const left = scaleX >= 0 ? x : x - width;
  const top = scaleY >= 0 ? y : y - height;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    scaleX,
    scaleY,
  };
}

function toNodePositionFromVisualRect(
  visual: Rect,
  scaleX: number,
  scaleY: number
) {
  const x = scaleX >= 0 ? visual.left : visual.right;
  const y = scaleY >= 0 ? visual.top : visual.bottom;
  return { x, y };
}

function loadBrowserImage(sourceInput: string): Promise<HTMLImageElement> {
  const source = String(sourceInput || "").trim();
  if (!source) {
    return Promise.reject(new Error("Image source is required."));
  }
  if (typeof Image === "undefined") {
    return Promise.reject(new Error("Image loading is unavailable in this environment."));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error("Image metadata is unavailable."));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("Failed to load image source."));
    image.src = source;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      resolve(image);
    }
  });
}

export function isSvgDataUrlSource(sourceInput: string) {
  return /^data:image\/svg\+xml(?:;[^,]+)?,/i.test(String(sourceInput || "").trim());
}

// Supersample factor for baking built-in shape / icon SVGs into PNGs. SVG is
// vector, so 4x keeps shapes crisp when the layer is enlarged on the (much
// larger) design canvas — a 120px shape bakes at 480px. Shared by the shapes
// panel (click-to-add) and the canvas drop handler (drag-to-add).
export const SVG_SHAPE_RASTER_SCALE = 4;

// Intrinsic (longest-edge) pixel size baked into a shape's render SVG. A browser rasterizes an
// <svg> <img> at its intrinsic width/height, so this — not the draw size — caps how crisp the
// live-vector shape looks when enlarged on the canvas. 2048 keeps it sharp up to a full-canvas
// size while bounding the decoded-bitmap memory per shape.
export const SHAPE_VECTOR_INTRINSIC_EDGE_PX = 2048;

export async function rasterizeSvgDataUrlToPngDataUrl(
  sourceInput: string,
  options?: { scale?: number }
) {
  const source = String(sourceInput || "").trim();
  if (!source) {
    throw new Error("Image source is required.");
  }
  if (!isSvgDataUrlSource(source)) {
    return source;
  }
  if (typeof document === "undefined") {
    throw new Error("SVG rasterization is only available in the browser.");
  }

  // SVG is vector, so drawing it onto a larger canvas re-rasterizes it crisply.
  // A >1 scale bakes the shape at a higher pixel resolution so it stays sharp
  // when the layer is enlarged on the (much larger) design canvas.
  const scale = Math.max(1, Math.min(8, Number(options?.scale) || 1));

  const image = await loadBrowserImage(source);
  const naturalWidth = Math.max(1, Math.round(Number(image.naturalWidth) || 1));
  const naturalHeight = Math.max(1, Math.round(Number(image.naturalHeight) || 1));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create a canvas for SVG rasterization.");
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

// Given a built-in shape's SVG data URL and the trim crop computed on its baked raster (cropX/Y/W/H
// in source-pixel space + the source dimensions), returns a new SVG data URL whose viewBox is
// cropped to the shape's content. This lets the canvas render the shape as a LIVE vector that fills
// its (trimmed) layer box with no Konva crop and no padding — so it stays razor-sharp at any zoom
// instead of upscaling the fixed-resolution baked PNG. Returns null when it can't be derived.
export function buildTrimmedShapeSvgDataUrl(
  svgSource: string,
  crop: {
    cropX?: number;
    cropY?: number;
    cropWidth?: number;
    cropHeight?: number;
    sourceWidth?: number;
    sourceHeight?: number;
  }
): string | null {
  try {
    const raw = String(svgSource || "").trim();
    if (!isSvgDataUrlSource(raw)) return null;
    const commaIndex = raw.indexOf(",");
    if (commaIndex < 0) return null;
    const svg = decodeURIComponent(raw.slice(commaIndex + 1));
    const viewBoxMatch = svg.match(
      /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/
    );
    if (!viewBoxMatch) return null;
    const vbX = Number(viewBoxMatch[1]);
    const vbY = Number(viewBoxMatch[2]);
    const vbW = Number(viewBoxMatch[3]);
    const vbH = Number(viewBoxMatch[4]);
    if (!(vbW > 0) || !(vbH > 0)) return null;

    // The baked raster is a scaled copy of the SVG viewBox, so map the pixel crop back to viewBox
    // units by that scale.
    const sourceWidth = Number(crop.sourceWidth) || vbW;
    const sourceHeight = Number(crop.sourceHeight) || vbH;
    const scaleX = sourceWidth / vbW;
    const scaleY = sourceHeight / vbH;
    if (!(scaleX > 0) || !(scaleY > 0)) return null;
    const cropX = Number(crop.cropX) || 0;
    const cropY = Number(crop.cropY) || 0;
    const cropWidth = Number(crop.cropWidth) || sourceWidth;
    const cropHeight = Number(crop.cropHeight) || sourceHeight;
    const round = (value: number) => Math.round(value * 100) / 100;
    const nx = round(vbX + cropX / scaleX);
    const ny = round(vbY + cropY / scaleY);
    const nw = round(cropWidth / scaleX);
    const nh = round(cropHeight / scaleY);
    if (!(nw > 0) || !(nh > 0)) return null;

    // A browser rasterizes an <svg> <img> at its INTRINSIC width/height and then scales that
    // bitmap, so the intrinsic size — not the draw size — sets the resolution. Keep the cropped
    // viewBox (content coords) but give the SVG a large intrinsic size so it decodes at high
    // resolution and stays crisp when the layer is enlarged on the canvas. Aspect is preserved
    // (outW/outH == nw/nh), so it still fills its box without distortion.
    const intrinsicScale = SHAPE_VECTOR_INTRINSIC_EDGE_PX / Math.max(nw, nh);
    const outW = round(nw * intrinsicScale);
    const outH = round(nh * intrinsicScale);

    // Rewrite only the opening <svg> tag so width/height on inner elements (e.g. <rect>) are safe.
    const tagEnd = svg.indexOf(">");
    if (tagEnd < 0) return null;
    const head = svg
      .slice(0, tagEnd)
      .replace(/\swidth="[^"]*"/, ` width="${outW}"`)
      .replace(/\sheight="[^"]*"/, ` height="${outH}"`)
      .replace(/viewBox="[^"]*"/, `viewBox="${nx} ${ny} ${nw} ${nh}"`);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(head + svg.slice(tagEnd))}`;
  } catch {
    return null;
  }
}

function rotateScaledLocalOffset(
  localX: number,
  localY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number
) {
  const radians = (toNumber(rotationDegrees, 0) * Math.PI) / 180;
  const scaledX = localX * scaleX;
  const scaledY = localY * scaleY;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos,
  };
}

export function canUseCanvasCropForImage(element: EditorElement | null | undefined) {
  if (!element || element.type !== "image") {
    return {
      supported: false,
      reason: "Select exactly one image layer.",
    };
  }

  if (Math.abs(toNumber(element.rotation, 0)) > ROTATION_TOLERANCE) {
    return {
      supported: false,
      reason: "Clip to Canvas currently supports non-rotated images only.",
    };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  if (!source) {
    return {
      supported: false,
      reason: "This image has no source to analyze.",
    };
  }

  return { supported: true };
}

export async function prepareImageElementForCanvasCrop(element: ImageElement): Promise<{
  supported: boolean;
  element: ImageElement | null;
  reason?: string;
}> {
  const support = canUseCanvasCropForImage(element);
  if (!support.supported) {
    return { supported: false, element: null, reason: support.reason };
  }

  const currentSourceWidth = toNumber(element.sourceWidth, 0);
  const currentSourceHeight = toNumber(element.sourceHeight, 0);
  if (currentSourceWidth > 0 && currentSourceHeight > 0) {
    return { supported: true, element };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  if (!source) {
    return {
      supported: false,
      element: null,
      reason: "This image has no source to analyze.",
    };
  }

  let image: HTMLImageElement;
  try {
    image = await loadBrowserImage(source);
  } catch (error) {
    return {
      supported: false,
      element: null,
      reason: error instanceof Error ? error.message : "Failed to load image metadata.",
    };
  }

  const sourceWidth = Math.max(1, Math.round(Number(image.naturalWidth || image.width || 0)));
  const sourceHeight = Math.max(1, Math.round(Number(image.naturalHeight || image.height || 0)));

  return {
    supported: true,
    element: {
      ...element,
      sourceWidth,
      sourceHeight,
      cropX: Number.isFinite(Number(element.cropX)) ? element.cropX : 0,
      cropY: Number.isFinite(Number(element.cropY)) ? element.cropY : 0,
      cropWidth:
        Number.isFinite(Number(element.cropWidth)) && Number(element.cropWidth) > 0
          ? element.cropWidth
          : sourceWidth,
      cropHeight:
        Number.isFinite(Number(element.cropHeight)) && Number(element.cropHeight) > 0
          ? element.cropHeight
          : sourceHeight,
    },
  };
}

export function canTrimTransparentPaddingForImage(element: EditorElement | null | undefined) {
  if (!element || element.type !== "image") {
    return {
      supported: false,
      reason: "Select exactly one image layer.",
    };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  if (!source) {
    return {
      supported: false,
      reason: "This image has no source to analyze.",
    };
  }

  return { supported: true };
}

export async function computeTrimTransparentPaddingPatch(
  element: ImageElement,
  options: { alphaThreshold?: number } = {}
): Promise<ImageCanvasPatchResult> {
  const support = canTrimTransparentPaddingForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  if (typeof document === "undefined") {
    return {
      supported: false,
      patch: null,
      reason: "Padding trim is only available in the browser.",
    };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  let image: HTMLImageElement;
  try {
    image = await loadBrowserImage(source);
  } catch (error) {
    return {
      supported: false,
      patch: null,
      reason: error instanceof Error ? error.message : "Failed to load image for trimming.",
    };
  }

  const sourceWidth = resolveSourceDimension(
    element.sourceWidth,
    Number(image.naturalWidth || element.width || 1)
  );
  const sourceHeight = resolveSourceDimension(
    element.sourceHeight,
    Number(image.naturalHeight || element.height || 1)
  );
  const currentCrop = resolveCurrentCrop(element, sourceWidth, sourceHeight);
  const scanScale = Math.min(
    1,
    MAX_TRIM_SCAN_SIDE / Math.max(currentCrop.cropWidth, currentCrop.cropHeight, 1)
  );
  const scanWidth = Math.max(1, Math.round(currentCrop.cropWidth * scanScale));
  const scanHeight = Math.max(1, Math.round(currentCrop.cropHeight * scanScale));
  const canvas = document.createElement("canvas");
  canvas.width = scanWidth;
  canvas.height = scanHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      supported: false,
      patch: null,
      reason: "Failed to create a canvas for image trimming.",
    };
  }

  try {
    context.clearRect(0, 0, scanWidth, scanHeight);
    context.drawImage(
      image,
      currentCrop.cropX,
      currentCrop.cropY,
      currentCrop.cropWidth,
      currentCrop.cropHeight,
      0,
      0,
      scanWidth,
      scanHeight
    );
  } catch (error) {
    return {
      supported: false,
      patch: null,
      reason: error instanceof Error ? error.message : "Failed to draw image for trimming.",
    };
  }

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, scanWidth, scanHeight).data;
  } catch {
    return {
      supported: false,
      patch: null,
      reason: "This image source does not allow pixel inspection for trimming.",
    };
  }

  const alphaThreshold = clamp(
    Math.round(toNumber(options.alphaThreshold, DEFAULT_ALPHA_THRESHOLD)),
    1,
    255
  );

  let minX = scanWidth;
  let minY = scanHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < scanHeight; y += 1) {
    for (let x = 0; x < scanWidth; x += 1) {
      const alpha = pixels[(y * scanWidth + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      supported: true,
      patch: null,
      reason: "No visible pixels were detected in this image.",
    };
  }

  const trimLeftRatio = clamp(minX / scanWidth, 0, 1);
  const trimTopRatio = clamp(minY / scanHeight, 0, 1);
  const trimRightRatio = clamp((maxX + 1) / scanWidth, 0, 1);
  const trimBottomRatio = clamp((maxY + 1) / scanHeight, 0, 1);
  const trimWidthRatio = trimRightRatio - trimLeftRatio;
  const trimHeightRatio = trimBottomRatio - trimTopRatio;

  if (
    trimLeftRatio <= EPSILON &&
    trimTopRatio <= EPSILON &&
    Math.abs(trimWidthRatio - 1) <= EPSILON &&
    Math.abs(trimHeightRatio - 1) <= EPSILON
  ) {
    return {
      supported: true,
      patch: null,
      reason: "This image does not have transparent padding to trim.",
    };
  }

  const nextCropX = clamp(
    currentCrop.cropX + trimLeftRatio * currentCrop.cropWidth,
    0,
    sourceWidth - 1
  );
  const nextCropY = clamp(
    currentCrop.cropY + trimTopRatio * currentCrop.cropHeight,
    0,
    sourceHeight - 1
  );
  const nextCropWidth = clamp(
    trimWidthRatio * currentCrop.cropWidth,
    1,
    sourceWidth - nextCropX
  );
  const nextCropHeight = clamp(
    trimHeightRatio * currentCrop.cropHeight,
    1,
    sourceHeight - nextCropY
  );

  const localOffsetX = Math.max(0, toNumber(element.width, 1) * trimLeftRatio);
  const localOffsetY = Math.max(0, toNumber(element.height, 1) * trimTopRatio);
  const scaleX = normalizeScale(element.scaleX);
  const scaleY = normalizeScale(element.scaleY);
  const rotatedOffset = rotateScaledLocalOffset(
    localOffsetX,
    localOffsetY,
    scaleX,
    scaleY,
    element.rotation
  );

  return {
    supported: true,
    patch: {
      x: toNumber(element.x, 0) + rotatedOffset.x,
      y: toNumber(element.y, 0) + rotatedOffset.y,
      width: Math.max(1, toNumber(element.width, 1) * trimWidthRatio),
      height: Math.max(1, toNumber(element.height, 1) * trimHeightRatio),
      sourceWidth,
      sourceHeight,
      cropX: nextCropX,
      cropY: nextCropY,
      cropWidth: nextCropWidth,
      cropHeight: nextCropHeight,
    },
  };
}

function isEdgeWhiteBackgroundPixel(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
  options: {
    alphaThreshold: number;
    minChannel: number;
    whiteDistance: number;
  }
) {
  const offset = pixelIndex * 4;
  const alpha = pixels[offset + 3];
  if (alpha < options.alphaThreshold) return true;

  const red = pixels[offset];
  const green = pixels[offset + 1];
  const blue = pixels[offset + 2];
  if (Math.min(red, green, blue) < options.minChannel) return false;

  const distanceToWhite = Math.sqrt(
    (255 - red) * (255 - red) +
      (255 - green) * (255 - green) +
      (255 - blue) * (255 - blue)
  );
  return distanceToWhite <= options.whiteDistance;
}

function clearEdgeWhiteBackgroundPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    alphaThreshold: number;
    minChannel: number;
    whiteDistance: number;
  }
) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueue = (pixelIndex: number) => {
    if (pixelIndex < 0 || pixelIndex >= pixelCount || visited[pixelIndex]) return;
    if (!isEdgeWhiteBackgroundPixel(pixels, pixelIndex, options)) return;
    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  let clearedPixels = 0;
  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart];
    queueStart += 1;

    const offset = pixelIndex * 4;
    if (pixels[offset + 3] !== 0) {
      pixels[offset + 3] = 0;
      clearedPixels += 1;
    }

    const x = pixelIndex % width;
    if (x > 0) enqueue(pixelIndex - 1);
    if (x < width - 1) enqueue(pixelIndex + 1);
    if (pixelIndex >= width) enqueue(pixelIndex - width);
    if (pixelIndex < pixelCount - width) enqueue(pixelIndex + width);
  }

  return clearedPixels;
}

function measureVisibleAlphaBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function buildFrameShapeFromVisibleAlpha(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): FrameShape | null {
  const bounds = measureVisibleAlphaBounds(pixels, width, height, alphaThreshold);
  if (!bounds) return null;

  const trimmedWidth = Math.max(1, bounds.maxX - bounds.minX + 1);
  const trimmedHeight = Math.max(1, bounds.maxY - bounds.minY + 1);
  const stepCount = Math.max(3, Math.min(MAX_ALPHA_SHAPE_SAMPLES, trimmedWidth));
  const topPoints: number[] = [];
  const bottomPoints: number[] = [];
  const topRatios: number[] = [];
  const bottomRatios: number[] = [];

  for (let step = 0; step < stepCount; step += 1) {
    const sampleRatio = stepCount === 1 ? 0 : step / (stepCount - 1);
    const sampleX = bounds.minX + Math.round(sampleRatio * (trimmedWidth - 1));
    let topY = -1;
    let bottomY = -1;

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const alpha = pixels[(y * width + sampleX) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (topY < 0) topY = y;
      bottomY = y;
    }

    if (topY < 0 || bottomY < 0) continue;

    const normalizedX = trimmedWidth <= 1 ? 0 : ((sampleX - bounds.minX) / (trimmedWidth - 1)) * 100;
    const normalizedTopY = trimmedHeight <= 1 ? 0 : ((topY - bounds.minY) / (trimmedHeight - 1)) * 100;
    const normalizedBottomY =
      trimmedHeight <= 1 ? 100 : ((bottomY - bounds.minY) / (trimmedHeight - 1)) * 100;

    topRatios.push(normalizedTopY);
    bottomRatios.push(normalizedBottomY);
    topPoints.push(normalizedX, normalizedTopY);
    bottomPoints.unshift(normalizedBottomY);
    bottomPoints.unshift(normalizedX);
  }

  const points = [...topPoints, ...bottomPoints];
  if (points.length < 6) return null;
  const isRectLike =
    bounds.minX === 0 &&
    bounds.minY === 0 &&
    bounds.maxX === width - 1 &&
    bounds.maxY === height - 1 &&
    topRatios.every((value) => value <= 1) &&
    bottomRatios.every((value) => value >= 99);
  if (isRectLike) return null;

  return {
    presetId: "frame-alpha-mask",
    kind: "polygon",
    points: points.map((value) => clamp(Number(value.toFixed(4)), 0, 100)),
  };
}

export async function computeRemoveEdgeWhiteBackgroundPatch(
  element: ImageElement,
  options: {
    alphaThreshold?: number;
    minChannel?: number;
    whiteDistance?: number;
  } = {}
): Promise<ImageCanvasPatchResult> {
  const support = canTrimTransparentPaddingForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  if (typeof document === "undefined") {
    return {
      supported: false,
      patch: null,
      reason: "Background cleanup is only available in the browser.",
    };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  let image: HTMLImageElement;
  try {
    image = await loadBrowserImage(source);
  } catch (error) {
    return {
      supported: false,
      patch: null,
      reason: error instanceof Error ? error.message : "Failed to load image for background cleanup.",
    };
  }

  const sourceWidth = resolveSourceDimension(
    element.sourceWidth,
    Number(image.naturalWidth || element.width || 1)
  );
  const sourceHeight = resolveSourceDimension(
    element.sourceHeight,
    Number(image.naturalHeight || element.height || 1)
  );
  const currentCrop = resolveCurrentCrop(element, sourceWidth, sourceHeight);
  const scanScale = Math.min(
    1,
    MAX_TRIM_SCAN_SIDE / Math.max(currentCrop.cropWidth, currentCrop.cropHeight, 1)
  );
  const scanWidth = Math.max(1, Math.round(currentCrop.cropWidth * scanScale));
  const scanHeight = Math.max(1, Math.round(currentCrop.cropHeight * scanScale));
  const canvas = document.createElement("canvas");
  canvas.width = scanWidth;
  canvas.height = scanHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      supported: false,
      patch: null,
      reason: "Failed to create a canvas for background cleanup.",
    };
  }

  try {
    context.clearRect(0, 0, scanWidth, scanHeight);
    context.drawImage(
      image,
      currentCrop.cropX,
      currentCrop.cropY,
      currentCrop.cropWidth,
      currentCrop.cropHeight,
      0,
      0,
      scanWidth,
      scanHeight
    );
  } catch (error) {
    return {
      supported: false,
      patch: null,
      reason: error instanceof Error ? error.message : "Failed to draw image for background cleanup.",
    };
  }

  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, scanWidth, scanHeight);
  } catch {
    return {
      supported: false,
      patch: null,
      reason: "This image source does not allow pixel inspection for background cleanup.",
    };
  }

  const pixels = imageData.data;
  const alphaThreshold = clamp(
    Math.round(toNumber(options.alphaThreshold, DEFAULT_ALPHA_THRESHOLD)),
    1,
    255
  );
  const minChannel = clamp(
    Math.round(toNumber(options.minChannel, EDGE_BACKGROUND_MIN_CHANNEL)),
    0,
    255
  );
  const whiteDistance = clamp(
    toNumber(options.whiteDistance, EDGE_BACKGROUND_WHITE_DISTANCE),
    0,
    442
  );
  const backgroundOptions = { alphaThreshold, minChannel, whiteDistance };
  const clearedPixels = clearEdgeWhiteBackgroundPixels(
    pixels,
    scanWidth,
    scanHeight,
    backgroundOptions
  );

  const scanBounds = measureVisibleAlphaBounds(
    pixels,
    scanWidth,
    scanHeight,
    alphaThreshold
  );

  if (!scanBounds) {
    return {
      supported: true,
      patch: null,
      reason: "No visible pixels remained after background cleanup.",
    };
  }

  const outputWidth = Math.max(1, Math.round(currentCrop.cropWidth));
  const outputHeight = Math.max(1, Math.round(currentCrop.cropHeight));
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) {
    return {
      supported: false,
      patch: null,
      reason: "Failed to create a canvas for cleaned image output.",
    };
  }
  outputContext.clearRect(0, 0, outputWidth, outputHeight);
  outputContext.drawImage(
    image,
    currentCrop.cropX,
    currentCrop.cropY,
    currentCrop.cropWidth,
    currentCrop.cropHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );

  try {
    const fullSizeImageData = outputContext.getImageData(0, 0, outputWidth, outputHeight);
    clearEdgeWhiteBackgroundPixels(
      fullSizeImageData.data,
      outputWidth,
      outputHeight,
      backgroundOptions
    );
    const fullSizeBounds = measureVisibleAlphaBounds(
      fullSizeImageData.data,
      outputWidth,
      outputHeight,
      alphaThreshold
    );
    if (!fullSizeBounds) {
      return {
        supported: true,
        patch: null,
        reason: "No visible pixels remained after background cleanup.",
      };
    }

    const trimLeftRatio = clamp(fullSizeBounds.minX / outputWidth, 0, 1);
    const trimTopRatio = clamp(fullSizeBounds.minY / outputHeight, 0, 1);
    const trimRightRatio = clamp((fullSizeBounds.maxX + 1) / outputWidth, 0, 1);
    const trimBottomRatio = clamp((fullSizeBounds.maxY + 1) / outputHeight, 0, 1);
    const trimWidthRatio = trimRightRatio - trimLeftRatio;
    const trimHeightRatio = trimBottomRatio - trimTopRatio;

    const localOffsetX = Math.max(0, toNumber(element.width, 1) * trimLeftRatio);
    const localOffsetY = Math.max(0, toNumber(element.height, 1) * trimTopRatio);
    const scaleX = normalizeScale(element.scaleX);
    const scaleY = normalizeScale(element.scaleY);
    const rotatedOffset = rotateScaledLocalOffset(
      localOffsetX,
      localOffsetY,
      scaleX,
      scaleY,
      element.rotation
    );
    const frameShape = buildFrameShapeFromVisibleAlpha(
      fullSizeImageData.data,
      outputWidth,
      outputHeight,
      alphaThreshold
    );
    const hasTrimmedPadding =
      fullSizeBounds.minX > 0 ||
      fullSizeBounds.minY > 0 ||
      fullSizeBounds.maxX < outputWidth - 1 ||
      fullSizeBounds.maxY < outputHeight - 1;
    const hasCleanup = clearedPixels > 0;
    const hasShapeMask = Boolean(frameShape);

    if (!hasCleanup && !hasTrimmedPadding && !hasShapeMask) {
      return {
        supported: true,
        patch: null,
        reason: "No white edge background or transparent frame shape was detected in this image.",
      };
    }

    const trimmedWidth = Math.max(1, fullSizeBounds.maxX - fullSizeBounds.minX + 1);
    const trimmedHeight = Math.max(1, fullSizeBounds.maxY - fullSizeBounds.minY + 1);
    let trimmedDataUrl = "";
    if (hasCleanup || hasTrimmedPadding) {
      const trimmedCanvas = document.createElement("canvas");
      trimmedCanvas.width = trimmedWidth;
      trimmedCanvas.height = trimmedHeight;
      const trimmedContext = trimmedCanvas.getContext("2d", { willReadFrequently: true });
      if (!trimmedContext) {
        return {
          supported: false,
          patch: null,
          reason: "Failed to create a canvas for trimmed image output.",
        };
      }

      trimmedContext.putImageData(
        fullSizeImageData,
        -fullSizeBounds.minX,
        -fullSizeBounds.minY
      );

      trimmedDataUrl = trimmedCanvas.toDataURL("image/png");
      if (!trimmedDataUrl.startsWith("data:image/")) {
        return {
          supported: false,
          patch: null,
          reason: "Failed to build trimmed image output.",
        };
      }
    }

    return {
      supported: true,
      patch: {
        x: toNumber(element.x, 0) + rotatedOffset.x,
        y: toNumber(element.y, 0) + rotatedOffset.y,
        width: Math.max(1, toNumber(element.width, 1) * trimWidthRatio),
        height: Math.max(1, toNumber(element.height, 1) * trimHeightRatio),
        ...(hasCleanup || hasTrimmedPadding
          ? {
              src: trimmedDataUrl,
              rasterOriginalSrc: trimmedDataUrl,
              sourceWidth: trimmedWidth,
              sourceHeight: trimmedHeight,
              cropX: 0,
              cropY: 0,
              cropWidth: trimmedWidth,
              cropHeight: trimmedHeight,
              rasterPalette: [],
              rasterPaletteVersion: 0,
              rasterColorMap: {},
            }
          : {}),
        ...(frameShape ? { frameShape } : {}),
      },
    };
  } catch {
    return {
      supported: false,
      patch: null,
      reason: "This image source does not allow pixel cleanup at full size.",
    };
  }

}

export function computeClipToCanvasPatch(
  element: ImageElement,
  page: Pick<EditorPage, "width" | "height">
): ImageCanvasPatchResult {
  const support = canUseCanvasCropForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  const pageRect: Rect = {
    left: 0,
    top: 0,
    right: Math.max(1, toNumber(page.width, 1)),
    bottom: Math.max(1, toNumber(page.height, 1)),
  };
  const visual = visualFrameRect(element);
  const intersection = rectIntersection(
    {
      left: visual.left,
      top: visual.top,
      right: visual.right,
      bottom: visual.bottom,
    },
    pageRect
  );

  if (!intersection) {
    return {
      supported: true,
      patch: null,
      reason: "Image is fully outside the canvas.",
    };
  }

  const sourceWidth = resolveSourceDimension(element.sourceWidth, visual.width);
  const sourceHeight = resolveSourceDimension(element.sourceHeight, visual.height);
  const currentCrop = resolveCurrentCrop(element, sourceWidth, sourceHeight);

  const relLeft = clamp((intersection.left - visual.left) / visual.width, 0, 1);
  const relTop = clamp((intersection.top - visual.top) / visual.height, 0, 1);
  const relRight = clamp((intersection.right - visual.left) / visual.width, relLeft, 1);
  const relBottom = clamp((intersection.bottom - visual.top) / visual.height, relTop, 1);

  const sourceLeft =
    visual.scaleX >= 0 ? relLeft : 1 - relRight;
  const sourceRight =
    visual.scaleX >= 0 ? relRight : 1 - relLeft;
  const sourceTop =
    visual.scaleY >= 0 ? relTop : 1 - relBottom;
  const sourceBottom =
    visual.scaleY >= 0 ? relBottom : 1 - relTop;

  const nextCropX = clamp(
    currentCrop.cropX + sourceLeft * currentCrop.cropWidth,
    0,
    sourceWidth - 1
  );
  const nextCropY = clamp(
    currentCrop.cropY + sourceTop * currentCrop.cropHeight,
    0,
    sourceHeight - 1
  );
  const nextCropWidth = clamp(
    (sourceRight - sourceLeft) * currentCrop.cropWidth,
    1,
    sourceWidth - nextCropX
  );
  const nextCropHeight = clamp(
    (sourceBottom - sourceTop) * currentCrop.cropHeight,
    1,
    sourceHeight - nextCropY
  );

  const nextVisual: Rect = {
    left: intersection.left,
    top: intersection.top,
    right: intersection.right,
    bottom: intersection.bottom,
  };
  const nextPosition = toNodePositionFromVisualRect(
    nextVisual,
    visual.scaleX,
    visual.scaleY
  );

  return {
    supported: true,
    patch: {
      x: nextPosition.x,
      y: nextPosition.y,
      width: Math.max(1, intersection.right - intersection.left),
      height: Math.max(1, intersection.bottom - intersection.top),
      sourceWidth,
      sourceHeight,
      cropX: nextCropX,
      cropY: nextCropY,
      cropWidth: nextCropWidth,
      cropHeight: nextCropHeight,
    },
  };
}

export function computeFitToCanvasPatch(
  element: ImageElement,
  page: Pick<EditorPage, "width" | "height">
): ImageCanvasPatchResult {
  const support = canUseCanvasCropForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  const pageWidth = Math.max(1, toNumber(page.width, 1));
  const pageHeight = Math.max(1, toNumber(page.height, 1));
  const imageWidth = Math.max(1, toNumber(element.width, 1));
  const imageHeight = Math.max(1, toNumber(element.height, 1));
  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;

  let nextWidth = pageWidth;
  let nextHeight = pageHeight;

  if (imageRatio > pageRatio) {
    nextHeight = pageHeight;
    nextWidth = pageHeight * imageRatio;
  } else {
    nextWidth = pageWidth;
    nextHeight = pageWidth / imageRatio;
  }

  const scaleX = normalizeScale(element.scaleX) < 0 ? -1 : 1;
  const scaleY = normalizeScale(element.scaleY) < 0 ? -1 : 1;
  const visualLeft = (pageWidth - nextWidth) / 2;
  const visualTop = (pageHeight - nextHeight) / 2;
  const positioned = {
    ...element,
    rotation: 0,
    scaleX,
    scaleY,
    width: nextWidth,
    height: nextHeight,
    ...toNodePositionFromVisualRect(
      {
        left: visualLeft,
        top: visualTop,
        right: visualLeft + nextWidth,
        bottom: visualTop + nextHeight,
      },
      scaleX,
      scaleY
    ),
  } as ImageElement;

  const clipped = computeClipToCanvasPatch(positioned, page);
  if (!clipped.supported) return clipped;

  return {
    supported: true,
    patch: {
      rotation: 0,
      scaleX,
      scaleY,
      width: nextWidth,
      height: nextHeight,
      ...toNodePositionFromVisualRect(
        {
          left: visualLeft,
          top: visualTop,
          right: visualLeft + nextWidth,
          bottom: visualTop + nextHeight,
        },
        scaleX,
        scaleY
      ),
      ...(clipped.patch || {}),
    },
  };
}
