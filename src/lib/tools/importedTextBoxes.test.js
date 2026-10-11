/**
 * Imported text boxes get slack so Konva/the app never break a word Canva kept whole — but a
 * paragraph Canva soft-wrapped must keep its wrap width, or the next line's first word climbs up.
 * Regression: the coffee "هل تعلم" post (DAHPQGZn2Tw) — an 819 px body grew 1% to 827 px and
 * "ثمرة" (7.8 px over the box in Canva) joined line 3, re-flowing the whole paragraph.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORTED_TEXT_BOX_SLACK_PX,
  chooseImportedTextBoxWidth,
  estimateRenderedLineCount,
  isSoftWrappedText,
  readImportedWrapRange,
  widenImportedTextBoxes,
} from "@/lib/tools/importedTextBoxes";

const body = () => ({
  type: "textbox",
  text: "بالرغم من أنها تُدعى 'حبوب'، إلا أن القهوة فاكهة. تنمو هذه 'الحبوب' على الشجيرات ونجدها في مركز ثمرة التوت، وتعرف باسم كرز القهوة.",
  left: 113.28,
  top: 361.92,
  width: 819,
  height: 398,
  fontSize: 58.6658,
  lineHeight: 1.39774792127611,
  textAlign: "center",
});

const title = () => ({
  type: "textbox",
  text: "هل تعلم",
  left: 304,
  top: 317.79,
  width: 636,
  height: 181,
  fontSize: 150.994,
  lineHeight: 1.39740651946435,
  textAlign: "center",
});

test("reads Canva's rendered line count from the box height", () => {
  assert.equal(estimateRenderedLineCount(body()), 5);
  assert.equal(estimateRenderedLineCount(title()), 1);
  assert.equal(estimateRenderedLineCount({ fontSize: 0, height: 100 }), 1);
});

test("a soft-wrapped paragraph keeps its wrap width (only the rounding epsilon)", () => {
  const object = body();
  assert.equal(isSoftWrappedText(object), true);
  assert.equal(widenImportedTextBoxes([object]), 1);
  assert.equal(object.width, 819 + IMPORTED_TEXT_BOX_SLACK_PX);
  // Centered: the box grows both ways, so the glyphs stay put.
  assert.ok(Math.abs(object.left - (113.28 - IMPORTED_TEXT_BOX_SLACK_PX / 2)) < 1e-9);
});

test("display text that Canva did not wrap still gets 1% slack", () => {
  const object = title();
  assert.equal(isSoftWrappedText(object), false);
  widenImportedTextBoxes([object]);
  assert.ok(Math.abs(object.width - 636 * 1.01) < 1e-9);
  assert.ok(Math.abs(object.left - (304 - 6.36 / 2)) < 1e-9);
});

test("hard line breaks alone are not a soft wrap", () => {
  const object = { ...title(), text: "هل\nتعلم", height: 181 + 211 };
  assert.equal(estimateRenderedLineCount(object), 2);
  assert.equal(isSoftWrappedText(object), false);
});

// Measured live: Konva with the library's Noto Sans Arabic at 58.6658 px draws Canva's widest line
// at 783.4 px and "ثمرة التوت، وتعرف باسم كرز القهوة." at 818.0 px — so any box in between
// reproduces Canva's five lines, while Canva's own 819 px (+2) joins the last word up.
const FONT = 58.6658;
const measuredBody = () => ({ ...body(), importWrapEm: [783.4 / FONT, 818.0 / FONT] });

test("reads the scraper's wrap range in em of the final font size", () => {
  const range = readImportedWrapRange(measuredBody());
  assert.ok(Math.abs(range.min - 783.4) < 1e-9 && Math.abs(range.max - 818.0) < 1e-9);
  // A rescaled import (font size halved) halves the range with it.
  const half = readImportedWrapRange({ ...measuredBody(), fontSize: FONT / 2 });
  assert.ok(Math.abs(half.max - 409) < 1e-9);
  assert.equal(readImportedWrapRange({ ...body(), importWrapEm: [14, 13] }), null);
  assert.equal(readImportedWrapRange({ ...body(), importWrapEm: "nope" }), null);
  assert.equal(readImportedWrapRange(body()), null);
});

test("a box Canva's breaks cannot fit moves to the middle of the measured range, glyphs in place", () => {
  const object = measuredBody();
  const center = object.left + object.width / 2;
  assert.equal(widenImportedTextBoxes([object]), 1);
  assert.ok(Math.abs(object.width - (783.4 + 818.0) / 2) < 1e-9);
  assert.ok(object.width < 819, "narrower than Canva's box this time");
  assert.ok(Math.abs(object.left + object.width / 2 - center) < 1e-9, "centered text keeps its center");
});

test("Canva's own box is kept when it already sits inside the range", () => {
  const object = { ...body(), importWrapEm: [700 / FONT, 900 / FONT] };
  assert.equal(chooseImportedTextBoxWidth(object), 819 + IMPORTED_TEXT_BOX_SLACK_PX);
});

test("right-aligned text keeps its right edge when the box changes", () => {
  const object = { ...measuredBody(), textAlign: "right" };
  const right = object.left + object.width;
  widenImportedTextBoxes([object]);
  assert.ok(Math.abs(object.left + object.width - right) < 1e-9);
});

test("groups are walked and justified text is left alone", () => {
  const justified = { ...body(), textAlign: "justify" };
  const group = { type: "group", objects: [body(), justified] };
  assert.equal(widenImportedTextBoxes([group]), 1);
  assert.equal(group.objects[0].width, 819 + IMPORTED_TEXT_BOX_SLACK_PX);
  assert.equal(justified.width, 819);
});
