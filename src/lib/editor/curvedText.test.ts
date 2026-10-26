/**
 * Curved text on the web follows the app's model (PhotoEditor CurvedTextArcGeometryTest,
 * CurvedTextAabbTest, TextJustificationMath) — these mirror the app's own expectations.
 *
 *   node --import tsx --test src/lib/editor/curvedText.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurvedRingStretch,
  canStretchCurvedRun,
  containsArabic,
  curvedTextArcAabb,
  curvedTextArcDegrees,
  curvedTextFrame,
  curvePatchFromPercent,
  curvePercentFromArc,
  isClosedRingArc,
  kashidaInsertionPoints,
  placeAtAdvance,
  resolveCurvedArc,
  ringGrowthFactor,
  warpPoint,
} from "@/lib/editor/curvedText";

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const DEG = 180 / Math.PI;

// ── geometry ────────────────────────────────────────────────────────────────────────────────────

test("the middle of the run sits on the apex, upright", () => {
  const arc = resolveCurvedArc(400, 90, 300, 200);
  const middle = placeAtAdvance(arc, 200);
  near(middle.x, arc.axisX);
  near(middle.y, arc.baselineY);
  near(middle.rotation, 0);
});

test("placement is symmetric about the axis, with opposite rotations", () => {
  const arc = resolveCurvedArc(400, 120, 300, 200);
  const left = placeAtAdvance(arc, 50);
  const right = placeAtAdvance(arc, 350);
  near(left.x - arc.axisX, -(right.x - arc.axisX));
  near(left.y, right.y);
  near(left.rotation, -right.rotation);
});

test("a positive arc is a dome, a negative one a valley", () => {
  const dome = resolveCurvedArc(400, 90, 300, 200);
  assert.ok(placeAtAdvance(dome, 0).y > placeAtAdvance(dome, 200).y);
  const valley = resolveCurvedArc(400, -90, 300, 200);
  assert.equal(valley.bend, -1);
  assert.ok(placeAtAdvance(valley, 0).y < placeAtAdvance(valley, 200).y);
});

test("the end of the run turns by half the arc", () => {
  const arc = resolveCurvedArc(400, 120, 300, 200);
  near(placeAtAdvance(arc, 400).rotation * DEG, 60, 0.5);
});

test("the text exactly fills the arc: arc length equals advance", () => {
  const arc = resolveCurvedArc(600, 90, 300, 200);
  near(arc.radius * arc.halfSweep * 2, 600, 1e-6);
  // Ten times the advance → ten times the radius, same rotations.
  const big = resolveCurvedArc(6000, 90, 300, 200);
  near(big.radius, arc.radius * 10);
  near(placeAtAdvance(big, 6000).rotation, placeAtAdvance(arc, 600).rotation);
});

test("a full circle closes: start and end meet", () => {
  const arc = resolveCurvedArc(500, 360, 300, 200);
  const start = placeAtAdvance(arc, 0);
  const end = placeAtAdvance(arc, 500);
  near(start.x, end.x, 1e-6);
  near(start.y, end.y, 1e-6);
});

test("the baseline shift centres the ink, not the baseline", () => {
  const plain = resolveCurvedArc(400, 60, 300, 200);
  const shifted = resolveCurvedArc(400, 60, 300, 200, 12);
  near(shifted.baselineY - plain.baselineY, 12);
});

test("a point above the baseline is carried out along the glyph's own normal", () => {
  const arc = resolveCurvedArc(400, 120, 300, 200);
  const p = placeAtAdvance(arc, 400);
  const lifted = warpPoint(arc, 400, -10); // 10 px above the baseline
  near(lifted.x, p.x + 10 * Math.sin(p.rotation));
  near(lifted.y, p.y - 10 * Math.cos(p.rotation));
});

test("the arc box: nearly flat at a hair's curve, taller and narrower at a deep one", () => {
  const flat = curvedTextArcAabb(500, 60, 0.6);
  assert.ok(flat.height >= 60 && flat.height < 60 * 1.15);
  assert.ok(curvedTextArcAabb(500, 60, 1).width >= 500 * 0.98);
  const deep = curvedTextArcAabb(500, 60, 160);
  assert.ok(deep.height > curvedTextArcAabb(500, 60, 5).height);
  assert.ok(deep.width < 500);
});

test("the frame is the arc box per line plus 0.45 em padding on every side", () => {
  const frame = curvedTextFrame({ widestLineAdvance: 500, lineCount: 2, fontSize: 40, lineHeight: 1.4, arcDegrees: 90 });
  const perLine = curvedTextArcAabb(500, 40 * 1.35, 90);
  near(frame.width, perLine.width + 36);
  near(frame.height, perLine.height * 2 + 36);
  // A tight line height caps the glyph band.
  const tight = curvedTextFrame({ widestLineAdvance: 500, lineCount: 1, fontSize: 40, lineHeight: 1, arcDegrees: 90 });
  near(tight.height, curvedTextArcAabb(500, 40, 90).height + 36);
});

// ── the curve control ───────────────────────────────────────────────────────────────────────────

test("the curve slider is a percentage of a full circle", () => {
  assert.deepEqual(curvePatchFromPercent(50), { textCurveEnabled: true, textCurveArcDegrees: 180, textCurveAmount: 50 });
  assert.deepEqual(curvePatchFromPercent(-100), { textCurveEnabled: true, textCurveArcDegrees: -360, textCurveAmount: -100 });
  assert.deepEqual(curvePatchFromPercent(0), { textCurveEnabled: false, textCurveArcDegrees: undefined, textCurveAmount: 0 });
  assert.equal(curvePercentFromArc(180), 50);
  assert.equal(curvePercentFromArc(-20.2), -6);
  assert.equal(curvePercentFromArc(900), 100);
});

test("a curve is active when enabled with more than half a degree", () => {
  assert.equal(curvedTextArcDegrees({ textCurveEnabled: true, textCurveArcDegrees: -20.2 }), -20.2);
  assert.equal(curvedTextArcDegrees({ textCurveEnabled: true, textCurveArcDegrees: 0.4 }), 0);
  assert.equal(curvedTextArcDegrees({ textCurveEnabled: false, textCurveArcDegrees: 90 }), 0);
});

// ── the Size slider (ring stretch) ──────────────────────────────────────────────────────────────

test("ring growth: 1 at no spread, 3× at full, junk is 1", () => {
  assert.equal(ringGrowthFactor(0), 1);
  assert.equal(ringGrowthFactor(1), 3);
  assert.equal(ringGrowthFactor(Number.NaN), 1);
  assert.equal(ringGrowthFactor(-1), 1);
});

test("a closed ring is ±360°, not 327.6°", () => {
  assert.equal(isClosedRingArc(327.6), false);
  assert.equal(isClosedRingArc(360), true);
  assert.equal(isClosedRingArc(-360), true);
});

test("kashida goes after dual-joining letters, after their marks, never inside لا", () => {
  // محمد: م(join)ح(join)م(join)د → after م, ح, م.
  assert.deepEqual(kashidaInsertionPoints("محمد", 0, 4), [0, 1, 2]);
  // سلام: س→ل yes; ل→ا is لا, no; ا is right-joining.
  assert.deepEqual(kashidaInsertionPoints("سلام", 0, 4), [0]);
  // A harakah rides its letter: بَت → after the fatha.
  assert.deepEqual(kashidaInsertionPoints("بَت", 0, 3), [1]);
});

test("Arabic stretches with tatweel, Latin with word gaps, one Latin word not at all", () => {
  const arabic = buildCurvedRingStretch("محمد", 0.5, 100, 10);
  assert.ok(arabic.text.includes("ـ"), arabic.text);
  assert.equal(arabic.extraWordSpacing, 0);
  // 100 → column 200, deficit 99.5 → 9 tatweels over 3 points (3 each), 9.5 px left, no spaces.
  assert.equal(arabic.text, "مـــحـــمـــد");
  const latin = buildCurvedRingStretch("Hello world", 0.5, 100, 10);
  assert.equal(latin.text, "Hello world");
  near(latin.extraWordSpacing, 99.5);
  assert.equal(canStretchCurvedRun(" Nayroz "), false);
  assert.deepEqual(buildCurvedRingStretch("Nayroz", 1, 100, 10), { text: "Nayroz", extraWordSpacing: 0, insertedAfter: [0, 0, 0, 0, 0, 0] });
});

test("a closed ring gets a seam space even with no spread", () => {
  assert.equal(buildCurvedRingStretch("Hello world", 0, 100, 10, true).text, "Hello world ");
  const spread = buildCurvedRingStretch("Hello world", 0.5, 100, 10, true);
  assert.equal(spread.text, "Hello world ");
  assert.ok(spread.extraWordSpacing > 0);
});

test("direction is decided by content", () => {
  assert.equal(containsArabic("Hello"), false);
  assert.equal(containsArabic("عروسه"), true);
  assert.equal(containsArabic("ﷺ"), true);
  assert.equal(containsArabic("😀"), false);
});
