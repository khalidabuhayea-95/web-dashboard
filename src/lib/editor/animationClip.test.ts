import test from "node:test";
import assert from "node:assert/strict";
import { drawRevealClip, type ClipMask } from "./animationClip";

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
