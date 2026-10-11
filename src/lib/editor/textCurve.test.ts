/**
 * Curved text: the app's payload stays exactly what it was, and the web draws the app's arc.
 *
 *   node --import tsx --test src/lib/editor/textCurve.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  curvedTextArcPath,
  curvedTextArcPoint,
  resolveCurvedTextArc,
  resolveTextCurveConfig,
} from "@/lib/editor/textCurve";

const close = (actual: number, expected: number, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

// Outputs of mobileProject.readCurveConfig before it moved here (captured 2026-10-11).
const GOLDEN = [
  [{ textCurveEnabled: true, textCurveAmount: 200, width: 261.8666762077307, fontSize: 18.13795159880386, scaleX: 1 }, { enabled: true, arcDegrees: 158.9, radius: 133 }],
  [{ textCurveEnabled: true, textCurveAmount: 40, width: 500, fontSize: 60 }, { enabled: true, arcDegrees: 38.1, radius: 765 }],
  [{ textCurveEnabled: true, textCurveAmount: -75, width: 320, fontSize: 30, scaleX: -1.5 }, { enabled: true, arcDegrees: -62.8, radius: 460 }],
  [{ textCurveEnabled: true, textCurveAmount: 120, width: 300, fontSize: 40, textCurveArcDegrees: 182.6 }, { enabled: true, arcDegrees: 182.6, radius: 150 }],
  [{ textCurveEnabled: true, textCurveAmount: -30, width: 400, fontSize: 20, textCurveArcDegrees: -45 }, { enabled: true, arcDegrees: -45, radius: 523 }],
  [{ textCurveEnabled: false, textCurveAmount: 80, width: 300, fontSize: 40 }, { enabled: false, arcDegrees: 0, radius: 200 }],
  [{ textCurveEnabled: true, textCurveAmount: 0.3, width: 300, fontSize: 40 }, { enabled: false, arcDegrees: 0, radius: 200 }],
] as const;

test("the app's curve config is unchanged by the move", () => {
  GOLDEN.forEach(([input, expected]) => assert.deepEqual(resolveTextCurveConfig(input), expected));
});

test("a measured Canva arc wins over the amount", () => {
  const base = { textCurveEnabled: true, textCurveAmount: 200, width: 261.87, fontSize: 18.14 };
  assert.equal(resolveTextCurveConfig(base).arcDegrees, 158.9);
  assert.equal(resolveTextCurveConfig({ ...base, textCurveArcDegrees: 182.6 }).arcDegrees, 182.6);
  // Below a degree is no measurement.
  assert.equal(resolveTextCurveConfig({ ...base, textCurveArcDegrees: 0.4 }).arcDegrees, 158.9);
});

const W = 300;
const H = 200;
const arc = (advance: number, degrees: number) => resolveCurvedTextArc(advance, degrees, W, H);
const at = (a: ReturnType<typeof arc>, advance: number) => curvedTextArcPoint(a, (advance - a.totalAdvance / 2) / a.radius);

test("the text fills the requested sweep exactly (radius = advance ÷ sweep)", () => {
  const a = arc(336.6, 182.6);
  close(a.radius, 336.6 / ((182.6 * Math.PI) / 180), 1e-9);
  close(a.halfSweepRad, (91.3 * Math.PI) / 180, 1e-9);
});

test("the apex sits on the axis and the sag is centred in the box (the app's geometry)", () => {
  const a = arc(200, 90);
  const apex = at(a, 100);
  close(apex.x, W / 2);
  close(apex.y, a.baselineY);
  const end = at(a, 200);
  // Apex and ends straddle the box's middle by the same amount.
  close((apex.y + end.y) / 2, H / 2, 1e-9);
});

test("dome and valley, mirrored about the axis", () => {
  const dome = arc(200, 120);
  const valley = arc(200, -120);
  assert.ok(at(dome, 200).y > at(dome, 100).y, "a dome's ends sag below its apex");
  assert.ok(at(valley, 200).y < at(valley, 100).y, "a valley's ends rise above its apex");
  const left = at(dome, 60);
  const right = at(dome, 140);
  close(W / 2 - left.x, right.x - W / 2, 1e-9);
  close(left.y, right.y, 1e-9);
});

test("the path starts at the arc's start and its pieces stay on the circle, past 180° too", () => {
  const a = arc(336.6, 182.6);
  const path = curvedTextArcPath(a, 30);
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const start = curvedTextArcPoint(a, -a.halfSweepRad);
  close(numbers[0], start.x, 1e-3);
  close(numbers[1], start.y, 1e-3);
  // Every piece is a ≤ 90° small arc, clockwise for a dome.
  const pieces = path.split("A").slice(1);
  assert.ok(pieces.length >= 3);
  pieces.forEach((piece) => {
    const [rx, ry, , large, sweep, x, y] = piece.trim().split(/\s+/).map(Number);
    close(rx, a.radius, 1e-3);
    close(ry, a.radius, 1e-3);
    assert.equal(large, 0);
    assert.equal(sweep, 1);
    const centerY = a.baselineY + a.bendDirection * a.radius;
    close(Math.hypot(x - a.axisX, y - centerY), a.radius, 2e-3);
  });
  // The extra length runs past the end along the same circle.
  const [, , , , , endX] = pieces[pieces.length - 1].trim().split(/\s+/).map(Number);
  const arcEnd = curvedTextArcPoint(a, a.halfSweepRad);
  assert.ok(endX < arcEnd.x, "past 180° the circle turns back inwards");
  assert.match(curvedTextArcPath(arc(200, -60)), / 0 0 0 /, "a valley runs counter-clockwise");
});
