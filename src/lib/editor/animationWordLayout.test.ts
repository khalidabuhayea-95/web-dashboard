import test from "node:test";
import assert from "node:assert/strict";
import { splitWordsForMotion, layoutWordsSingleLine } from "./animationGlyph";

test("splitWordsForMotion matches whitespace segmentation", () => {
  assert.deepEqual(splitWordsForMotion("one two three"), ["one", "two", "three"]);
  assert.deepEqual(splitWordsForMotion("  a   b  "), ["a", "b"]);
  assert.deepEqual(splitWordsForMotion("   "), []);
  assert.deepEqual(splitWordsForMotion("سعيد جداً بكم"), ["سعيد", "جداً", "بكم"]);
});

const W = (text: string, width: number) => ({ text, width });

test("left-aligned LTR packs words from x=0 with the space gap", () => {
  const boxes = layoutWordsSingleLine([W("a", 20), W("b", 30)], 10, 200, "left", false);
  assert.deepEqual(boxes.map((b) => b.x), [0, 30]); // a@0, b@ 20+10
});

test("centre alignment centres the whole content block", () => {
  const boxes = layoutWordsSingleLine([W("a", 20), W("b", 30)], 10, 200, "center", false);
  const total = 20 + 30 + 10; // 60
  assert.equal(boxes[0].x, (200 - total) / 2); // 70
  assert.equal(boxes[1].x, 70 + 30);
});

test("RTL puts the first logical word at the right edge", () => {
  const boxes = layoutWordsSingleLine([W("first", 40), W("second", 60)], 10, 200, "right", true);
  // content block width = 40+60+10 = 110, right-aligned so ends at 200.
  // word 0 (first) is rightmost: x = 200 - 40 = 160; word 1: 160 - 10 - 60 = 90.
  assert.equal(boxes[0].x, 160);
  assert.equal(boxes[1].x, 90);
});
