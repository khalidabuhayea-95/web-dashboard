import test from "node:test";
import assert from "node:assert/strict";
import { drawRevealClip, typewriterRevealRects, type ClipMask } from "./animationClip";

/** A recording stub for the canvas 2D subset drawRevealClip uses. */
function rec() {
  const calls: string[] = [];
  const ctx = {
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect(${x},${y},${w},${h})`),
    arc: (x: number, y: number, r: number) => calls.push(`arc(${x},${y},${r.toFixed(2)})`),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: () => {},
    closePath: () => calls.push("close"),
  };
  return { ctx, calls };
}

test("WIPE reveals nothing at 0, everything at 1; RTL uncovers from the right", () => {
  let r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0 }, 200, 80, false);
  assert.deepEqual(r.calls, ["rect(0,0,0,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 1 }, 200, 80, false);
  assert.deepEqual(r.calls, ["rect(0,0,200,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25 }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(150,0,50,80)"]); // right-anchored
});

// Canva's Wipe grows from the edge the motion starts at, its Baseline reveals the part of the
// content inside the home box and its Block hides the text behind a bar, so those masks pin their
// band to an edge AND mark it anchored — which wins over the text direction (§8.3 item 2).
test("an anchored WIPE is measured from its edge, whatever the text direction", () => {
  let r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "LEFT", anchored: true }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(0,0,50,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "RIGHT", anchored: true }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(150,0,50,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "RIGHT", anchored: true }, 200, 80, false);
  assert.deepEqual(r.calls, ["rect(150,0,50,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "TOP", anchored: true }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(0,0,200,20)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "BOTTOM", anchored: true }, 200, 80, false);
  assert.deepEqual(r.calls, ["rect(0,60,200,20)"]);
});

// The app's rule: only an UNanchored band mirrors for right-to-left text, and only on the
// horizontal axis — top and bottom are the same in every script.
test("an unanchored WIPE edge mirrors LEFT/RIGHT for RTL text only", () => {
  let r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "LEFT" }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(150,0,50,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "RIGHT" }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(0,0,50,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "RIGHT" }, 200, 80, false);
  assert.deepEqual(r.calls, ["rect(150,0,50,80)"]);
  r = rec();
  drawRevealClip(r.ctx, { kind: "WIPE", progress: 0.25, edge: "TOP" }, 200, 80, true);
  assert.deepEqual(r.calls, ["rect(0,0,200,20)"]);
});

test("CIRCLE grows from centre to cover the corners", () => {
  const r = rec();
  drawRevealClip(r.ctx, { kind: "CIRCLE", progress: 1 }, 200, 80, false);
  // radius at p=1 = hypot(200,80)/2 ≈ 107.7, centred at (100,40)
  assert.equal(r.calls[0], "arc(100,40,107.70)");
});

test("RADIAL sweeps a wedge from its start angle", () => {
  const r = rec();
  drawRevealClip(r.ctx, { kind: "RADIAL", progress: 0.5, startAngleDegrees: -90 }, 100, 100, false);
  assert.equal(r.calls[0], "moveTo(50,50)");
  assert.ok(r.calls.some((c) => c.startsWith("arc(50,50")));
  assert.equal(r.calls[r.calls.length - 1], "close");
});

test("the typewriter shows whole lines, then the typed part of the current one, nothing after", () => {
  const lines = [
    { text: "Aziza", width: 100, lastInParagraph: true },
    { text: "&", width: 20, lastInParagraph: true },
    { text: "Ammar", width: 120, lastInParagraph: true },
  ];
  const measure = (text: string) => text.length * 20;
  const options = { boxWidth: 200, lineHeightPx: 50, align: "center", rtl: false, measure };
  // 3 of "Aziza": one rect, starting at the centred line's left edge, 60 px of glyphs.
  assert.deepEqual(typewriterRevealRects(lines, 3, options), [{ x: 50 - 50, y: -50, width: 60 + 50, height: 50 + 10 + 50 }]);
  // "Aziza\n&\n" typed (8 chars) + "Am": two whole bands and 40 px of the last line.
  const rects = typewriterRevealRects(lines, 10, options);
  assert.equal(rects.length, 3);
  assert.deepEqual(rects[1], { x: -50, y: 50, width: 300, height: 50 });
  assert.deepEqual(rects[2], { x: 40 - 50, y: 100, width: 40 + 50, height: 100 });
  // Right-to-left: the typed part grows from the line's right end.
  const rtl = typewriterRevealRects([{ text: "سلام", width: 80 }], 2, { ...options, rtl: true });
  assert.deepEqual(rtl, [{ x: 60 + 80 - 40, y: -50, width: 40 + 50, height: 50 + 50 + 50 }]);
  assert.deepEqual(typewriterRevealRects(lines, 0, options), []);
});
