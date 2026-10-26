/**
 * Letter spacing on Arabic, the way Chrome draws it — which is what Canva shows and what the web
 * editor draws (Konva hands RTL text to the canvas whole, with native `ctx.letterSpacing`).
 *
 * Chrome never spaces the letters of a cursive script apart: in Arabic only the spaces, Latin
 * letters, digits and free-standing symbols take the tracking. Measured on DAHP7rbsCzc's
 * "RTL-Adam Script" 700 at 45 px with 20 px of spacing (extra width ÷ 20):
 *   كيك 0 · دار 0 · كيـك 0 · كيك، كيك 1 (the space) · آيس كريم 1 · كيك 55 3 · كيكabc 3 ·
 *   • كيك 2 (bullet + space) · •كيك 0 (a symbol glued to an Arabic letter) · ab cd 5.
 * The app (Compose / CoreText / Android text) instead adds it after EVERY glyph, which pulls
 * joined letters apart — «الكيك» on the phone came out as separated letters. The app already
 * draws per-range letter spacing (the multi-style `spans`), so the payload sends Chrome's rule as
 * ranges: the layer's spacing becomes 0 and the ranges that Chrome spaces carry it.
 */

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࡰ-࢟ࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;

export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(String(text || ""));
}

/**
 * Per UTF-16 unit: whether Chrome adds letter spacing after that character. Both units of a
 * surrogate pair share the answer.
 */
export function chromeLetterSpacingMask(text: string): boolean[] {
  const source = String(text || "");
  const chars = Array.from(source);
  const isArabic = chars.map((char) => ARABIC_SCRIPT.test(char));
  const answers = chars.map((char, index) => {
    if (WHITESPACE.test(char)) return true;
    if (isArabic[index]) return false;
    if (LETTER_OR_DIGIT.test(char)) return true;
    // A symbol joins the Arabic run it touches directly (•كيك), and stays free beside a space.
    const touchesArabic = Boolean(isArabic[index - 1]) || Boolean(isArabic[index + 1]);
    return !touchesArabic;
  });
  const mask: boolean[] = [];
  chars.forEach((char, index) => {
    for (let unit = 0; unit < char.length; unit += 1) mask.push(answers[index]);
  });
  return mask;
}

export interface SpacedTextSpan {
  start: number;
  end: number;
  letterSpacing?: number;
  [key: string]: unknown;
}

/**
 * The layer's spacing and its ranges with Chrome's Arabic rule baked in. Untouched (returned as
 * given) unless the text holds Arabic and some spacing is in play. Existing ranges keep every
 * other style; their own `letterSpacing` follows the same rule.
 */
export function applyChromeArabicLetterSpacing(
  text: string,
  layerLetterSpacing: number,
  spans: SpacedTextSpan[]
): { letterSpacing: number; spans: SpacedTextSpan[] } {
  const source = String(text || "");
  const base = Number.isFinite(Number(layerLetterSpacing)) ? Number(layerLetterSpacing) : 0;
  const list = Array.isArray(spans) ? spans : [];
  const anySpacing = base !== 0 || list.some((span) => Number(span.letterSpacing) || 0);
  if (!source || !anySpacing || !containsArabicScript(source)) {
    return { letterSpacing: base, spans: list };
  }
  const mask = chromeLetterSpacingMask(source);
  const styles: Array<Record<string, unknown>> = [];
  const keys: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const covering = list.find((span) => index >= span.start && index < span.end);
    const { start: _start, end: _end, letterSpacing: spanSpacing, ...overrides } = covering || ({} as SpacedTextSpan);
    const spacing = mask[index] ? (spanSpacing !== undefined ? Number(spanSpacing) || 0 : base) : 0;
    const style = spacing !== 0 ? { ...overrides, letterSpacing: spacing } : overrides;
    styles.push(style);
    keys.push(JSON.stringify(style));
  }
  const out: SpacedTextSpan[] = [];
  let runStart = 0;
  for (let index = 1; index <= source.length; index += 1) {
    if (index < source.length && keys[index] === keys[runStart]) continue;
    if (keys[runStart] !== "{}") out.push({ start: runStart, end: index, ...styles[runStart] });
    runStart = index;
  }
  return { letterSpacing: 0, spans: out };
}
