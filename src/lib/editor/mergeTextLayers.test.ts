/**
 * Merging a text-only selection into ONE editable text layer: the merged text keeps the first
 * line's style, every rendered line stays a line, and the block lands where the originals were.
 *
 *   node --import tsx --test src/lib/editor/mergeTextLayers.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { planTextLayerMerge, type TextMergeSource } from "@/lib/editor/mergeTextLayers";

const close = (actual: number, expected: number, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

function source(partial: Partial<TextMergeSource> & Pick<TextMergeSource, "id" | "lines">): TextMergeSource {
  return {
    x: 0,
    y: 0,
    width: 300,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    fontSize: 40,
    lineHeight: 1.2,
    align: "left",
    ...partial,
  };
}

// The measure the editor passes: here every line keeps the width it had in its own layer.
function measureFrom(sources: TextMergeSource[]) {
  const widths = new Map(sources.flatMap((item) => item.lines.map((line) => [line.text, line.width] as const)));
  return (text: string) => widths.get(text) ?? text.length * 10;
}

test("a paragraph imported one layer per line merges into one right-aligned text", () => {
  // Canva post: three right-aligned lines, 60 px apart, each in its own 300 px box.
  const sources = [
    source({ id: "top", x: 500, y: 100, align: "right", lines: [{ text: "بعض التفاصيل", width: 280 }] }),
    source({ id: "middle", x: 500, y: 160, align: "right", lines: [{ text: "الصغيرة تصنـــع", width: 300 }] }),
    source({ id: "bottom", x: 500, y: 220, align: "right", lines: [{ text: "يوماً جميلاً", width: 200 }] }),
  ];
  const plan = planTextLayerMerge([sources[2], sources[0], sources[1]], measureFrom(sources));
  assert.ok(plan);
  assert.equal(plan.primaryId, "top");
  assert.equal(plan.text, "بعض التفاصيل\nالصغيرة تصنـــع\nيوماً جميلاً");
  // The lines were 60 px apart at 40 px → line height 1.5, centred where each line was: the first
  // line's centre stays at 100 + 48/2 = 124, so the box starts half a pitch above it.
  close(plan.lineHeight, 1.5);
  close(plan.y, 124 - 30);
  close(plan.height, 180);
  // Right edges stay on 800; the box is the widest line plus the wrap slack.
  close(plan.width, 302);
  close(plan.x + plan.width, 800);
});

test("pieces side by side become one line in reading order", () => {
  const arabic = [
    source({ id: "right", x: 400, y: 50, lines: [{ text: "مسقط", width: 80 }] }),
    source({ id: "left", x: 280, y: 52, lines: [{ text: "٢٠٢٣ |", width: 90 }] }),
  ];
  const rtl = planTextLayerMerge(arabic, measureFrom(arabic));
  assert.ok(rtl);
  assert.equal(rtl.text, "مسقط ٢٠٢٣ |");
  assert.equal(rtl.primaryId, "right"); // read first in Arabic
  close(rtl.lineHeight, 1.2); // one row keeps the primary's own spacing
  close(rtl.x, 280); // left-aligned primary: the block starts at the leftmost ink

  const latin = [
    source({ id: "world", x: 200, y: 10, lines: [{ text: "World", width: 100 }] }),
    source({ id: "hello", x: 60, y: 10, lines: [{ text: "Hello", width: 100 }] }),
  ];
  const ltr = planTextLayerMerge(latin, measureFrom(latin));
  assert.ok(ltr);
  assert.equal(ltr.text, "Hello World");
  assert.equal(ltr.primaryId, "hello");
});

test("soft-wrapped lines stay where the original layer broke them", () => {
  const sources = [
    source({
      id: "wrapped",
      x: 0,
      y: 0,
      width: 200,
      lines: [
        { text: "one two", width: 150 },
        { text: "three", width: 100 },
      ],
    }),
    source({ id: "below", x: 0, y: 96, lines: [{ text: "four", width: 80 }] }),
  ];
  const plan = planTextLayerMerge(sources, measureFrom(sources));
  assert.ok(plan);
  assert.equal(plan.text, "one two\nthree\nfour");
  close(plan.lineHeight, 1.2); // 48 px apart, exactly the layers' own spacing
  close(plan.y, 0);
  close(plan.x, 0);
});

test("a turned paragraph merges in its own rotated frame", () => {
  const degrees = 30;
  const radians = (degrees * Math.PI) / 180;
  const down = { x: -Math.sin(radians), y: Math.cos(radians) };
  const origin = { x: 100, y: 200 };
  const sources = [0, 1].map((index) =>
    source({
      id: `line-${index}`,
      x: origin.x + down.x * 60 * index,
      y: origin.y + down.y * 60 * index,
      rotation: degrees,
      lines: [{ text: `line ${index}`, width: 120 }],
    })
  );
  const plan = planTextLayerMerge(sources, measureFrom(sources));
  assert.ok(plan);
  // Pitch 60 at 40 px → 1.5; the box starts 6 px "above" the first layer along the turned axis.
  close(plan.lineHeight, 1.5);
  close(plan.x, origin.x - down.x * 6);
  close(plan.y, origin.y - down.y * 6);
});

test("a scaled primary keeps its scale: the box is in its own px", () => {
  const sources = [
    source({ id: "scaled", x: 0, y: 0, fontSize: 20, scaleX: 2, scaleY: 2, lines: [{ text: "aaaa", width: 100 }] }),
    source({ id: "plain", x: 0, y: 48, lines: [{ text: "bbbb", width: 200 }] }),
  ];
  const plan = planTextLayerMerge(sources, () => 100);
  assert.ok(plan);
  assert.equal(plan.primaryId, "scaled");
  // Both lines span 200 page px = 100 of the primary's px; rows 48 page px apart = 1.2 × 2 × 20.
  close(plan.width, 102);
  close(plan.lineHeight, 1.2);
  close(plan.height, 48);
});

test("spacing a single box cannot express is clamped, the block stays centred", () => {
  const sources = [
    source({ id: "a", y: 0, lines: [{ text: "far", width: 50 }] }),
    source({ id: "b", y: 1000, lines: [{ text: "apart", width: 50 }] }),
  ];
  const plan = planTextLayerMerge(sources, () => null);
  assert.ok(plan);
  close(plan.lineHeight, 5);
  // Centres 24 and 1024 → midpoint 524; two 200 px rows centred on it.
  close(plan.y, 524 - 200);
  close(plan.width, 52); // no measure → the lines' own extent
});

test("what one text box cannot hold comes back null", () => {
  const level = source({ id: "a", lines: [{ text: "a", width: 10 }] });
  const turned = source({ id: "b", y: 50, rotation: 12, lines: [{ text: "b", width: 10 }] });
  assert.equal(planTextLayerMerge([level, turned], () => 10), null);

  const flipped = source({ id: "c", y: 50, scaleX: -1, lines: [{ text: "c", width: 10 }] });
  assert.equal(planTextLayerMerge([level, flipped], () => 10), null);

  const blank = source({ id: "d", y: 50, lines: [{ text: "   ", width: 0 }] });
  assert.equal(planTextLayerMerge([level, blank], () => 10), null);
  assert.equal(planTextLayerMerge([level], () => 10), null);

  // 359.8° and 0.1° are the same turn.
  const almost = source({ id: "e", y: 50, rotation: 359.8, lines: [{ text: "e", width: 10 }] });
  assert.ok(planTextLayerMerge([source({ ...level, rotation: 0.1 }), almost], () => 10));
});
