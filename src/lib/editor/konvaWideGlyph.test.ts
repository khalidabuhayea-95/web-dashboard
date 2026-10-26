/**
 * A letter wider than its box stays, overflowing from the box's start edge, like the browser
 * (and Canva) draw it — Konva dropped it. DAHMphBrpuo: "س" 340 px wide in a 48 px box.
 *
 *   node --import tsx --test src/lib/editor/konvaWideGlyph.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { overflowLineShift, wrapLinesKeepingWideGlyphs } from "@/lib/editor/konvaTextPatches";
import { textBoxStartAnchorDeltaX } from "@/lib/editor/textBox";

// Every grapheme 10 px, spaces 4 px — except "W", 100 px.
const measure = (text: string) => Array.from(text).reduce((sum, ch) => sum + (ch === "W" ? 100 : ch === " " ? 4 : 10), 0);

test("a letter wider than the box keeps its own line and is marked overflowing", () => {
  const { lines, textWidth } = wrapLinesKeepingWideGlyphs({ text: "W", maxWidth: 55, wrapAtWord: true, measure });
  assert.deepEqual(lines, [{ text: "W", width: 100, lastInParagraph: true, overflow: true }]);
  assert.equal(textWidth, 100);
});

test("text around a wide letter wraps the way Konva does", () => {
  const { lines } = wrapLinesKeepingWideGlyphs({ text: "ab W cd", maxWidth: 55, wrapAtWord: true, measure });
  assert.deepEqual(
    lines.map((line) => [line.text, line.overflow]),
    [
      ["ab", false],
      ["W", true],
      ["cd", false],
    ]
  );
});

test("ordinary text is laid out exactly as before: words, then characters", () => {
  const { lines } = wrapLinesKeepingWideGlyphs({ text: "aaa bbb\ncccccccc", maxWidth: 55, wrapAtWord: true, measure });
  assert.deepEqual(
    lines.map((line) => [line.text, line.width, line.lastInParagraph, line.overflow]),
    [
      ["aaa", 30, false, false],
      ["bbb", 30, true, false],
      ["ccccc", 50, false, false],
      ["ccc", 30, true, false],
    ]
  );
});

test("a fixed height stops before the paragraph that would overflow it", () => {
  const { lines } = wrapLinesKeepingWideGlyphs({ text: "W\nab\ncd", maxWidth: 55, wrapAtWord: true, measure, maxHeight: 25, lineHeightPx: 10 });
  assert.deepEqual(lines.map((line) => line.text), ["W", "ab"]);
});

test("an overflowing line starts at the start edge: right for Arabic, left for Latin", () => {
  // Centred: Konva would put the 340 px line at (48 − 340) / 2; the browser at 48 − 340.
  assert.equal(overflowLineShift({ align: "center", direction: "rtl", width: 340, available: 48 }), -146);
  assert.equal(overflowLineShift({ align: "right", direction: "rtl", width: 340, available: 48 }), 0);
  assert.equal(overflowLineShift({ align: "center", direction: "ltr", width: 340, available: 48 }), 146);
  assert.equal(overflowLineShift({ align: "left", direction: "ltr", width: 340, available: 48 }), 0);
});

test("growing an overflowed box keeps its start edge", () => {
  assert.equal(textBoxStartAnchorDeltaX("rtl", 48, 342), -294);
  assert.equal(textBoxStartAnchorDeltaX("ltr", 48, 342), 0);
});
