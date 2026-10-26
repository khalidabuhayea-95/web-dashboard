/**
 * Arabic letter spacing as Chrome draws it, sent to the app as ranges.
 *
 *   node --import tsx --test src/lib/editor/arabicLetterSpacing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { applyChromeArabicLetterSpacing, chromeLetterSpacingMask } from "@/lib/editor/arabicLetterSpacing";

const count = (text: string) => chromeLetterSpacingMask(text).filter(Boolean).length;

test("matches Chrome's measured spacing counts", () => {
  // Extra width ÷ letter spacing, measured in Chrome on "RTL-Adam Script" 700.
  const measured: Array<[string, number]> = [
    ["كيك", 0], ["دار", 0], ["الكيك", 0], ["كيـك", 0], ["كيك، كيك", 1], ["آيس كريم", 1],
    ["كيك 55", 3], ["كيك55", 2], ["كيك abc", 4], ["كيكabc", 3], ["• كيك", 2], ["•كيك", 0],
    ["ab cd", 5], ["كيك  كيك", 2],
  ];
  measured.forEach(([text, expected]) => assert.equal(count(text), expected, text));
});

test("a heading: the layer's spacing becomes ranges on the space only", () => {
  const { letterSpacing, spans } = applyChromeArabicLetterSpacing("آيس كريم", 8.74, []);
  assert.equal(letterSpacing, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(spans)), [{ start: 3, end: 4, letterSpacing: 8.74 }]);
});

test("a joined word gets no spacing at all", () => {
  const { letterSpacing, spans } = applyChromeArabicLetterSpacing("الكيك", 8.74, []);
  assert.equal(letterSpacing, 0);
  assert.deepEqual(spans, []);
});

test("Latin-only text and texts without spacing are untouched", () => {
  const latin = applyChromeArabicLetterSpacing("$5\n$5", 0.98, []);
  assert.equal(latin.letterSpacing, 0.98);
  assert.deepEqual(latin.spans, []);
  const plain = applyChromeArabicLetterSpacing("كيك الشوكولاتة", 0, [{ start: 0, end: 3, colorHex: "#FF0000" }]);
  assert.equal(plain.letterSpacing, 0);
  assert.deepEqual(plain.spans, [{ start: 0, end: 3, colorHex: "#FF0000" }]);
});

test("existing ranges keep their styles and their own spacing follows the rule", () => {
  // "كيك abc": a red range over the whole text, and a 4 px range over "abc".
  const { letterSpacing, spans } = applyChromeArabicLetterSpacing("كيك abc", 2, [
    { start: 0, end: 4, colorHex: "#FF0000" },
    { start: 4, end: 7, letterSpacing: 4 },
  ]);
  assert.equal(letterSpacing, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(spans)), [
    { start: 0, end: 3, colorHex: "#FF0000" },
    { start: 3, end: 4, colorHex: "#FF0000", letterSpacing: 2 },
    { start: 4, end: 7, letterSpacing: 4 },
  ]);
});

test("a bullet list: bullets and spaces keep their spacing, letters none", () => {
  const { spans } = applyChromeArabicLetterSpacing("• كيك\n• فانيلا", 1, []);
  const spaced = spans.flatMap((span) => Array.from({ length: span.end - span.start }, (_, i) => span.start + i));
  assert.deepEqual(spaced, [0, 1, 5, 6, 7]);
});
