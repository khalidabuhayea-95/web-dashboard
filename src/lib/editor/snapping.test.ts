/**
 * Canvas snapping: edges and centre lines pull onto the page and onto other layers.
 *
 *   node --import tsx --test src/lib/editor/snapping.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildSnapTargets, snapMovingRect, snapResizedRect, snapResizedRotatedBox, unionRect } from "@/lib/editor/snapping";

const page = { width: 1080, height: 1920 };

test("a box dragged near the page centre snaps its centre onto it, with a full-height guide", () => {
  const targets = buildSnapTargets(page, []);
  const result = snapMovingRect({ x: 437, y: 300, width: 200, height: 100 }, targets, 6);
  assert.equal(result.dx, 3); // centre 537 → 540
  assert.equal(result.dy, 0);
  assert.deepEqual(result.guides, [{ orientation: "vertical", position: 540, start: 0, end: 1920 }]);
});

test("edges snap to another layer's edges, and the guide joins both objects", () => {
  const other = { x: 100, y: 800, width: 300, height: 200 };
  const targets = buildSnapTargets(page, [other]);
  // Left edge 104 is 4 px from the other's left edge 100; top 1203 is far from everything.
  const result = snapMovingRect({ x: 104, y: 1203, width: 160, height: 80 }, targets, 6);
  assert.equal(result.dx, -4);
  assert.equal(result.dy, 0);
  assert.deepEqual(result.guides, [{ orientation: "vertical", position: 100, start: 800, end: 1283 }]);
});

test("the nearest line wins, and nothing farther than the threshold snaps", () => {
  const targets = buildSnapTargets(page, [{ x: 500, y: 0, width: 10, height: 10 }]);
  // Right edge 497 → 500 (3 px) beats centre 537 → 540 (3 px)… a tie keeps the first found: right edge.
  assert.equal(snapMovingRect({ x: 437, y: 50, width: 60, height: 60 }, targets, 6).dx, 3);
  assert.deepEqual(snapMovingRect({ x: 620, y: 700, width: 60, height: 60 }, buildSnapTargets(page, []), 6), {
    dx: 0,
    dy: 0,
    guides: [],
    spacings: [],
  });
});

test("a box can snap on both axes at once", () => {
  const result = snapMovingRect({ x: 2, y: 1915, width: 100, height: 3 }, buildSnapTargets(page, []), 6);
  assert.equal(result.dx, -2); // left edge onto the page's left
  assert.equal(result.dy, 2); // bottom 1918 → 1920
  assert.equal(result.guides.length, 2);
});

test("resizing from the right edge snaps that edge and leaves the left alone", () => {
  const targets = buildSnapTargets(page, [{ x: 700, y: 100, width: 100, height: 100 }]);
  const previous = { x: 100, y: 500, width: 400, height: 200 };
  const next = { x: 100, y: 500, width: 597, height: 200 };
  const { rect, guides } = snapResizedRect(previous, next, targets, 6, false);
  assert.deepEqual(rect, { x: 100, y: 500, width: 600, height: 200 });
  assert.deepEqual(guides, [{ orientation: "vertical", position: 700, start: 100, end: 700 }]);
});

test("resizing from the left edge keeps the right edge pinned", () => {
  const previous = { x: 100, y: 500, width: 400, height: 200 };
  const next = { x: 4, y: 500, width: 496, height: 200 };
  const { rect } = snapResizedRect(previous, next, buildSnapTargets(page, []), 6, false);
  assert.deepEqual(rect, { x: 0, y: 500, width: 500, height: 200 });
});

test("a corner resize snaps the closer axis and keeps the aspect ratio from the fixed corner", () => {
  const previous = { x: 100, y: 100, width: 400, height: 200 };
  // Dragging the bottom-right corner: right edge 1078 is 2 px from the page edge, bottom 640 far.
  const next = { x: 100, y: 100, width: 978, height: 489 };
  const { rect, guides } = snapResizedRect(previous, next, buildSnapTargets(page, []), 6, true);
  assert.equal(rect.x, 100);
  assert.equal(rect.y, 100);
  assert.equal(rect.width, 980);
  assert.equal(rect.height, 490);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].position, 1080);
});

test("a centred resize (both sides moving) and a resize far from everything are left alone", () => {
  const targets = buildSnapTargets(page, []);
  const previous = { x: 400, y: 400, width: 200, height: 200 };
  const centred = { x: 398, y: 400, width: 204, height: 200 };
  assert.deepEqual(snapResizedRect(previous, centred, targets, 6, false), { rect: centred, guides: [] });
  const far = { x: 400, y: 400, width: 260, height: 200 };
  assert.deepEqual(snapResizedRect(previous, far, targets, 6, false), { rect: far, guides: [] });
});

test("junk never snaps or throws", () => {
  const targets = buildSnapTargets(page, [null, { x: Number.NaN, y: 0, width: 1, height: 1 }]);
  assert.equal(targets.vertical.length, 3);
  assert.deepEqual(snapMovingRect({ x: Number.NaN, y: 0, width: 1, height: 1 }, targets, 6), { dx: 0, dy: 0, guides: [], spacings: [] });
  assert.deepEqual(snapMovingRect({ x: 2, y: 0, width: 1, height: 1 }, targets, 0), { dx: 0, dy: 0, guides: [], spacings: [] });
});

test("a multi-selection snaps as one box", () => {
  assert.deepEqual(
    unionRect([
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 200, y: 5, width: 30, height: 30 },
    ]),
    { x: 10, y: 5, width: 220, height: 65 }
  );
  assert.equal(unionRect([]), null);
});

// ── equal spacing ───────────────────────────────────────────────────────────────────────────────
// A row of 100×100 cards at y 600; none of their edges or centres line up with the moving card's.
const card = (x: number, y = 600) => ({ x, y, width: 100, height: 100 });

test("a card dropped between two others centres itself, with a mark on each gap", () => {
  const targets = buildSnapTargets(page, [card(100), card(500)]);
  // Room 200..500 for a 100-wide card → centred at x 300 (100 px each side); dragged to 304.
  const result = snapMovingRect({ x: 304, y: 637, width: 100, height: 100 }, targets, 6);
  assert.equal(result.dx, -4);
  assert.deepEqual(result.spacings, [
    { orientation: "horizontal", from: 200, to: 300, at: 668.5 },
    { orientation: "horizontal", from: 400, to: 500, at: 668.5 },
  ]);
});

test("the next card in a row repeats the row's gap", () => {
  // Cards at 100 and 260 → a 60 px gap; the third dragged to x 423 lands at 360 + 60 = 420.
  const targets = buildSnapTargets(page, [card(100), card(260)]);
  const result = snapMovingRect({ x: 423, y: 610, width: 100, height: 100 }, targets, 6);
  assert.equal(result.dx, -3);
  assert.deepEqual(result.spacings, [
    { orientation: "horizontal", from: 200, to: 260, at: 650 },
    { orientation: "horizontal", from: 360, to: 420, at: 655 },
  ]);
});

test("spacing works down a column too, and only counts layers sharing the row", () => {
  // A column at x 300: cards at y 100 and 260 (gap 60); the third dragged to y 422.
  const column = [card(300, 100), card(300, 260)];
  const result = snapMovingRect({ x: 320, y: 422, width: 100, height: 100 }, buildSnapTargets(page, column), 6);
  assert.equal(result.dy, -2);
  assert.equal(result.spacings.length, 2);
  assert.ok(result.spacings.every((mark) => mark.orientation === "vertical" && mark.to - mark.from === 60));
  // Moved off to the side so it no longer overlaps the column across, nothing spaces.
  const away = snapMovingRect({ x: 640, y: 422, width: 100, height: 100 }, buildSnapTargets(page, column), 6);
  assert.deepEqual(away.spacings, []);
});

test("an edge line closer than the spacing position wins", () => {
  // Spacing would want x 420 (3 px away), but another layer's left edge sits at 424 (1 px away).
  const targets = buildSnapTargets(page, [card(100), card(260), { x: 424, y: 1500, width: 50, height: 50 }]);
  const result = snapMovingRect({ x: 423, y: 610, width: 100, height: 100 }, targets, 6);
  assert.equal(result.dx, 1);
  assert.deepEqual(result.spacings, []);
});

// ── resizing a turned box ───────────────────────────────────────────────────────────────────────

const deg = (value: number) => (value * Math.PI) / 180;
const cornersAt = (box: { x: number; y: number; width: number; height: number; rotation: number }) => {
  const u = { x: Math.cos(box.rotation), y: Math.sin(box.rotation) };
  const v = { x: -Math.sin(box.rotation), y: Math.cos(box.rotation) };
  return {
    tl: { x: box.x, y: box.y },
    tr: { x: box.x + box.width * u.x, y: box.y + box.width * u.y },
    bl: { x: box.x + box.height * v.x, y: box.y + box.height * v.y },
    br: { x: box.x + box.width * u.x + box.height * v.x, y: box.y + box.width * u.y + box.height * v.y },
  };
};
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} ≠ ${expected}`);

test("a turned box stretched from its right side lands its leading corner on the page edge", () => {
  const rotation = deg(20);
  const previous = { x: 300, y: 400, width: 400, height: 150, rotation };
  const next = { ...previous, width: 760 };
  const before = cornersAt(next);
  // A small layer whose left edge sits 4 px beyond the leading (top-right) corner.
  const targets = buildSnapTargets(page, [{ x: before.tr.x + 4, y: 100, width: 20, height: 20 }]);
  const { box, guides } = snapResizedRotatedBox(previous, next, targets, 6, false);
  const after = cornersAt(box);
  close(after.tr.x, before.tr.x + 4, "tr lands on the line");
  close(box.x, next.x, "left edge stays");
  close(box.y, next.y, "left edge stays");
  close(box.height, next.height, "height stays");
  assert.ok(box.width > next.width);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].orientation, "vertical");
});

test("a turned box stretched from its left side keeps its right side pinned", () => {
  const rotation = deg(-30);
  const previous = { x: 400, y: 900, width: 300, height: 120, rotation };
  // Konva moves the top-left corner back along the box's own x axis as the left edge grows.
  const grow = 50;
  const next = {
    ...previous,
    x: previous.x - grow * Math.cos(rotation),
    y: previous.y - grow * Math.sin(rotation),
    width: previous.width + grow,
  };
  const before = cornersAt(next);
  // A layer far to the left whose bottom edge runs 3 px above the leading (top-left) corner.
  const targets = buildSnapTargets(page, [{ x: 20, y: before.tl.y - 13, width: 30, height: 10 }]);
  const { box, guides } = snapResizedRotatedBox(previous, next, targets, 6, false);
  const pinned = cornersAt(previous).tr;
  const after = cornersAt(box);
  close(after.tl.y, before.tl.y - 3, "tl lands on the line");
  close(after.tr.x, pinned.x, "right side pinned (x)");
  close(after.tr.y, pinned.y, "right side pinned (y)");
  assert.equal(guides[0].orientation, "horizontal");
});

test("a turned box resized from a corner keeps its ratio, scaling about the fixed corner", () => {
  const rotation = deg(15);
  const previous = { x: 200, y: 300, width: 300, height: 200, rotation };
  const next = { ...previous, width: 600, height: 400 }; // bottom-right corner dragged, top-left fixed
  const before = cornersAt(next);
  // Lines at br.x − 23, − 13, − 3: only the last is within reach.
  const targets = buildSnapTargets(page, [{ x: before.br.x - 23, y: 1500, width: 20, height: 10 }]);
  const { box, guides } = snapResizedRotatedBox(previous, next, targets, 6, true);
  const after = cornersAt(box);
  close(after.br.x, before.br.x - 3, "br lands on the line");
  close(box.x, 200, "fixed corner x");
  close(box.y, 300, "fixed corner y");
  close(box.width / box.height, 1.5, "ratio kept");
  assert.equal(guides.length, 1);
});

test("turning, centred resizing and nothing near leave a turned box alone", () => {
  const targets = buildSnapTargets(page, []);
  const previous = { x: 400, y: 400, width: 200, height: 100, rotation: deg(10) };
  const turning = { ...previous, rotation: deg(12) };
  assert.deepEqual(snapResizedRotatedBox(previous, turning, targets, 6, false), { box: turning, guides: [] });
  const far = { ...previous, width: 230 };
  assert.deepEqual(snapResizedRotatedBox(previous, far, targets, 6, false), { box: far, guides: [] });
});
