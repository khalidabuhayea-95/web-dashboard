import type { OcrTextBlock } from "./ocr.server";

// Arabic, Hebrew, and related RTL Unicode ranges.
const RTL_RANGE =
  /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;

let canvasLibPromise: Promise<{ loadImage: any; createCanvas: any } | null> | null = null;

async function getCanvasLib() {
  if (canvasLibPromise) return canvasLibPromise;
  canvasLibPromise = import("canvas")
    .then((module) => ({ loadImage: module.loadImage, createCanvas: module.createCanvas }))
    .catch(() => null);
  return canvasLibPromise;
}

export function isRtlText(text: string): boolean {
  return RTL_RANGE.test(String(text || ""));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Estimate the glyph colour inside a box: treat the box border as background,
// then average the pixels whose luminance differs most from it (the text).
function sampleColorFromImageData(
  data: Uint8ClampedArray,
  imgWidth: number,
  box: { x1: number; y1: number; x2: number; y2: number }
): string {
  const x1 = Math.max(0, Math.floor(box.x1));
  const y1 = Math.max(0, Math.floor(box.y1));
  const x2 = Math.min(imgWidth, Math.ceil(box.x2));
  const y2 = Math.ceil(box.y2);

  // Background estimate = mean luma of the top/bottom border rows.
  let bgLuma = 0;
  let bgCount = 0;
  for (const y of [y1, y2 - 1]) {
    for (let x = x1; x < x2; x += 2) {
      const i = (y * imgWidth + x) * 4;
      bgLuma += luma(data[i], data[i + 1], data[i + 2]);
      bgCount += 1;
    }
  }
  bgLuma = bgCount ? bgLuma / bgCount : 0;

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const i = (y * imgWidth + x) * 4;
      if (data[i + 3] < 16) continue;
      const pl = luma(data[i], data[i + 1], data[i + 2]);
      // Pixels far from the background luminance are likely glyph strokes.
      if (Math.abs(pl - bgLuma) < 60) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
  }
  if (!count) return "#000000";
  return toHex(r / count, g / count, b / count);
}

export type TextFabricObject = Record<string, unknown>;

// Map OCR blocks (in the OCR image's pixel space) onto Fabric text objects in
// the final canvas space. Font family/weight are intentionally generic — font
// fidelity is out of scope; the colour, text, position, and direction matter.
export async function buildTextLayerObjects({
  blocks,
  imageBytes,
  imageMimeType,
  ocrWidth,
  ocrHeight,
  canvasWidth,
  canvasHeight,
}: {
  blocks: OcrTextBlock[];
  imageBytes: Buffer;
  imageMimeType: string;
  ocrWidth: number;
  ocrHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): Promise<TextFabricObject[]> {
  if (!blocks.length) return [];

  const scaleX = canvasWidth / Math.max(1, ocrWidth);
  const scaleY = canvasHeight / Math.max(1, ocrHeight);

  // Decode the original image once for colour sampling (best-effort).
  let pixels: Uint8ClampedArray | null = null;
  let pixelWidth = 0;
  try {
    const canvasLib = await getCanvasLib();
    if (canvasLib?.loadImage && canvasLib?.createCanvas) {
      const image = await canvasLib.loadImage(
        `data:${imageMimeType || "image/png"};base64,${imageBytes.toString("base64")}`
      );
      const w = Math.max(1, Math.round(image.width));
      const h = Math.max(1, Math.round(image.height));
      const c = canvasLib.createCanvas(w, h);
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0, w, h);
      pixels = ctx.getImageData(0, 0, w, h).data;
      pixelWidth = w;
    }
  } catch {
    pixels = null;
  }

  return blocks.map((block, index) => {
    const left = block.x1 * scaleX;
    const top = block.y1 * scaleY;
    const width = Math.max(1, (block.x2 - block.x1) * scaleX);
    const height = Math.max(1, (block.y2 - block.y1) * scaleY);
    const rtl = isRtlText(block.text);
    const colorHex =
      pixels && pixelWidth
        ? sampleColorFromImageData(pixels, pixelWidth, block)
        : "#000000";

    return {
      id: `text-${index}`,
      type: "text",
      layerType: "text",
      layerName: block.text.slice(0, 24) || `Text ${index + 1}`,
      left,
      top,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      originX: "left",
      originY: "top",
      opacity: 1,
      layerLocked: false,
      layerHidden: false,
      text: block.text,
      // Approximate; the editor's auto-fit tightens this on load.
      fontSize: Math.max(8, Math.round(height)),
      fontFamily: rtl ? "Cairo" : "Roboto",
      fontWeight: "400",
      fill: colorHex,
      color: colorHex,
      textAlign: rtl ? "right" : "center",
      isRtl: rtl,
    };
  });
}
