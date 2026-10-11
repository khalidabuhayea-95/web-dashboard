// Canva reports a text box's width rounded to whole pixels, and an auto-width box is exactly as
// wide as its text: "التخرج" measured 537.04 px and arrived in a 537 px box. Konva (and the app's text
// layout) break a word that overflows its box between characters, so the ج dropped onto a second
// line. Every imported text box gets a little slack — the editor's own snug-fit epsilon, or 1% for
// the big display sizes where another text engine's metrics drift further — and moves back along
// its own x axis by the alignment rule, so the glyphs stay exactly where Canva drew them.
//
// A paragraph Canva SOFT-wrapped is different: its width is the wrap width, and every px of slack
// is room for the next line's first word. 1% of an 819 px body (8 px) let "ثمرة" (7.8 px over in
// Canva) climb onto the line above, so the whole paragraph re-flowed. Even Canva's exact width is
// not enough — Canva measures without kerning and with its own fallback font, so "القهوة." (1.7 px
// over in Canva) still fit at 819 px in the editor. Extension builds that measure Canva's breaks
// send the range of widths that reproduce them (`importWrapEm`), and the box lands inside it;
// older payloads keep only the rounding epsilon for wrapped text.
export const IMPORTED_TEXT_BOX_SLACK_PX = 2;
const DISPLAY_TEXT_SLACK_RATIO = 0.01;

const isTextObject = (object) => {
  const type = String(object?.type || "").toLowerCase();
  return type === "text" || type === "textbox" || type === "i-text";
};

/**
 * How many lines Canva laid the text out on, read from the box: Canva's text box is the line boxes
 * stacked (the last one a little shorter), so height ÷ line pitch rounds to the line count.
 * @param {Record<string, unknown>} object
 */
export function estimateRenderedLineCount(object) {
  const fontSize = Number(object?.fontSize);
  const lineHeight = Number(object?.lineHeight) || 1;
  const height = Number(object?.height);
  if (!(fontSize > 0) || !(height > 0)) return 1;
  return Math.max(1, Math.round(height / (fontSize * lineHeight)));
}

/** @param {Record<string, unknown>} object */
export function isSoftWrappedText(object) {
  const hardLines = String(object?.text ?? "").split(/\r\n|\r|\n/).length;
  return estimateRenderedLineCount(object) > hardLines;
}

/**
 * The box widths that reproduce Canva's own line breaks in our renderers, measured by the
 * extension's scraper (`importWrapEm`: [widest line, narrowest line + next word], in em of the
 * font size, so a canvas rescale of the text keeps it valid). Canva lays text out with kerning off
 * and its own fallback font for missing glyphs; Konva and the app keep kerning on and draw the
 * stored family — so Canva's box width alone does not wrap the same way.
 * @param {Record<string, unknown>} object
 * @returns {{ min: number, max: number } | null}
 */
export function readImportedWrapRange(object) {
  const em = Array.isArray(object?.importWrapEm) ? object.importWrapEm : null;
  const fontSize = Number(object?.fontSize);
  if (!em || !(fontSize > 0)) return null;
  const min = Number(em[0]) * fontSize;
  const max = Number(em[1]) * fontSize;
  if (!(min > 0) || !(max > min)) return null;
  return { min, max };
}

/**
 * The width an imported text box should have.
 * @param {Record<string, unknown>} object
 */
export function chooseImportedTextBoxWidth(object) {
  const width = Number(object?.width);
  const wrap = readImportedWrapRange(object);
  if (wrap) {
    // Any width inside the range breaks where Canva did. Keep Canva's own box (plus the rounding
    // epsilon) when it sits comfortably inside; otherwise take the middle, the most room either
    // way for a renderer whose metrics drift a little from the canvas the range was measured on.
    const canvaBox = width + IMPORTED_TEXT_BOX_SLACK_PX;
    const margin = Math.min(4, (wrap.max - wrap.min) / 4);
    return canvaBox >= wrap.min + margin && canvaBox <= wrap.max - margin ? canvaBox : (wrap.min + wrap.max) / 2;
  }
  return isSoftWrappedText(object)
    ? width + IMPORTED_TEXT_BOX_SLACK_PX
    : width + Math.max(IMPORTED_TEXT_BOX_SLACK_PX, width * DISPLAY_TEXT_SLACK_RATIO);
}

/**
 * Widen every imported text box (groups included) by the slack its layout can take.
 * @param {unknown} objects fabric objects, mutated in place
 * @returns {number} how many boxes changed
 */
export function widenImportedTextBoxes(objects) {
  if (!Array.isArray(objects)) return 0;
  let changed = 0;
  objects.forEach((object) => {
    if (!object || typeof object !== "object") return;
    if (Array.isArray(object.objects)) {
      changed += widenImportedTextBoxes(object.objects);
      return;
    }
    if (!isTextObject(object)) return;
    const width = Number(object.width);
    if (!Number.isFinite(width) || width <= 0) return;
    const align = String(object.textAlign || "").toLowerCase();
    // Justified text is stretched to the box, so a wider box would respace it.
    if (align === "justify") return;
    const nextWidth = chooseImportedTextBoxWidth(object);
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
    // Usually wider; narrower when Canva's breaks need it — either way the glyphs stay put.
    const delta = nextWidth - width;
    const scaleX = Number(object.scaleX) || 1;
    const anchorShift = align === "center" ? delta / 2 : align === "right" ? delta : 0;
    // The box grows along its own x axis (mirrored by a flip), in page space through its rotation.
    const localShift = anchorShift * scaleX * (object.flipX ? -1 : 1);
    const radians = ((Number(object.angle) || 0) * Math.PI) / 180;
    object.left = (Number(object.left) || 0) - localShift * Math.cos(radians);
    object.top = (Number(object.top) || 0) - localShift * Math.sin(radians);
    object.width = nextWidth;
    changed += 1;
  });
  return changed;
}
