/**
 * TEXT layer outline sizing, kept in one place because its unit is easy to get wrong.
 *
 * A text layer's `strokeWidth` is NOT a pixel width (unlike a media/shape border). It is a 0–100
 * percentage that ships to mobile verbatim as the text layer's `stroke.width`, and both mobile
 * renderers turn it into pixels relative to the font size:
 *
 *     strokeWidthPx = fontSize × (width / 100) × 0.22
 *
 * (Compose: `scaledTextSizePx * widthRatio * 0.22f`; iOS uses the same 22 factor.) The web canvas
 * mirrors the formula so an outline authored here has the same weight on the phone, and the Stroke
 * control shows the raw 0–100 value as a percentage exactly like the mobile Stroke sheet.
 */
export const TEXT_STROKE_MAX_PERCENT = 100;

/** Fraction of the font size an outline reaches at 100% — the mobile renderers' 0.22 factor. */
export const TEXT_STROKE_FONT_SIZE_RATIO = 0.22;

/** Rendered outline thickness in px for a text layer, or 0 when it has no outline. */
export function resolveTextStrokeWidthPx(strokeWidth: unknown, fontSize: unknown) {
  const raw = Number(strokeWidth);
  const percent = Math.max(0, Math.min(TEXT_STROKE_MAX_PERCENT, Number.isFinite(raw) ? raw : 0));
  if (percent <= 0) return 0;
  const size = Math.max(0, Number(fontSize) || 0);
  return size * (percent / TEXT_STROKE_MAX_PERCENT) * TEXT_STROKE_FONT_SIZE_RATIO;
}
