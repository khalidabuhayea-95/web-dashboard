/**
 * A text layer's background box — the highlight/pill drawn behind the glyphs.
 *
 * The model is the mobile app's, field for field, so a template looks the same in both places:
 *   - `textBackgroundAngleSize` 0..1 → corner radius = angle × 28 project px
 *     (resolveTextBackgroundCornerRadiusPx in the app's TextExportLayout.kt);
 *   - `textBackgroundPaddingX/Y` 0..1 → padding = fontSize × ratio × 0.5
 *     (resolveTextBackgroundPaddingPx, TEXT_BACKGROUND_PADDING_MAX_TO_FONT_RATIO = 0.5). A ratio of
 *     the font size rather than px, so the box keeps its proportions when the text is resized;
 *   - one box around the whole text frame, outset by the padding (the app draws a single rounded
 *     box, not one per line).
 * Canva's own "Background" text effect is per-line; for single-line text the two are identical.
 */
export const TEXT_BACKGROUND_MAX_RADIUS_PX = 28;
export const TEXT_BACKGROUND_PADDING_MAX_TO_FONT_RATIO = 0.5;

export type TextBackgroundFields = {
  width?: number;
  height?: number;
  fontSize?: number;
  textBackgroundEnabled?: boolean;
  textBackgroundColor?: string;
  textBackgroundOpacity?: number;
  textBackgroundAngleSize?: number;
  textBackgroundPaddingX?: number;
  textBackgroundPaddingY?: number;
};

export type TextBackgroundBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fill: string;
  opacity: number;
};

function clamp01(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export function textBackgroundPaddingPx(ratio: unknown, fontSize: unknown) {
  const size = Math.max(1, Number(fontSize) || 1);
  return size * clamp01(ratio, 0) * TEXT_BACKGROUND_PADDING_MAX_TO_FONT_RATIO;
}

export function textBackgroundRadiusPx(angleSize: unknown) {
  return clamp01(angleSize, 0) * TEXT_BACKGROUND_MAX_RADIUS_PX;
}

/**
 * The box to draw in the text node's LOCAL coordinates (0,0 = the text frame's top-left), or null
 * when there is nothing to draw. Opacity and colour are kept apart so a translucent box never
 * dims the glyphs painted on top of it.
 */
export function resolveTextBackgroundBox(element: TextBackgroundFields): TextBackgroundBox | null {
  if (!element?.textBackgroundEnabled) return null;
  const fill = String(element.textBackgroundColor || "").trim();
  if (!fill) return null;
  const opacity = clamp01(element.textBackgroundOpacity, 1);
  if (opacity <= 0.001) return null;
  const width = Math.max(1, Number(element.width) || 1);
  const height = Math.max(1, Number(element.height) || 1);
  const padX = textBackgroundPaddingPx(element.textBackgroundPaddingX, element.fontSize);
  const padY = textBackgroundPaddingPx(element.textBackgroundPaddingY, element.fontSize);
  const boxWidth = width + padX * 2;
  const boxHeight = height + padY * 2;
  const radius = Math.min(textBackgroundRadiusPx(element.textBackgroundAngleSize), boxWidth / 2, boxHeight / 2);
  return { x: -padX, y: -padY, width: boxWidth, height: boxHeight, radius, fill, opacity };
}

/** Paint [box] on a raw 2D context — used from inside Konva scene functions. */
export function drawTextBackground(ctx: CanvasRenderingContext2D, box: TextBackgroundBox) {
  const { x, y, width, height } = box;
  const r = Math.max(0, box.radius);
  ctx.save();
  ctx.globalAlpha *= box.opacity;
  ctx.fillStyle = box.fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Canva's "Background" text effect → our fields. Canva measures in design px: a corner radius,
 * and how far the box reaches past the text (spread) horizontally and vertically.
 */
export function textBackgroundFieldsFromPx(input: {
  color: string;
  opacity?: number;
  radiusPx?: number;
  padXPx?: number;
  padYPx?: number;
  fontSize: number;
}) {
  const fontSize = Math.max(1, Number(input.fontSize) || 1);
  const perRatio = fontSize * TEXT_BACKGROUND_PADDING_MAX_TO_FONT_RATIO;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    textBackgroundEnabled: true,
    textBackgroundColor: input.color,
    textBackgroundOpacity: round(clamp01(input.opacity, 1)),
    textBackgroundAngleSize: round(clamp01((Number(input.radiusPx) || 0) / TEXT_BACKGROUND_MAX_RADIUS_PX, 0)),
    textBackgroundPaddingX: round(clamp01((Number(input.padXPx) || 0) / perRatio, 0)),
    textBackgroundPaddingY: round(clamp01((Number(input.padYPx) || 0) / perRatio, 0)),
  };
}
