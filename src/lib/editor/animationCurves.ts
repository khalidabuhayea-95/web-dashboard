/**
 * Keyframe player for the animation spec's `authoredCurves` — the 19 effects ported from
 * After Effects art (see docs/specs/animation-spec.md in the mobile repo).
 *
 * Contract, per the spec:
 *  • Keyframes are FRAME-based at the channel's `fps` (25 for all current art).
 *  • `easing` is a cubic-bézier [x1,y1,x2,y2] applied to the segment that STARTS at that
 *    keyframe. A null easing on the last keyframe simply has no segment after it.
 *  • `hold: true` makes the segment a step — the value jumps at the next keyframe.
 *  • Outside the authored range, channels CLAMP to the first/last value (no extrapolation).
 *  • These effects ignore spec.easing entirely: their béziers are baked per keyframe.
 */

export interface AuthoredKeyframe {
  frame: number;
  value: number;
  /** Cubic-bézier control points [x1, y1, x2, y2] for the segment starting here, or null. */
  easing: [number, number, number, number] | null;
  hold: boolean;
}

/** Solve a CSS-style cubic-bézier for y at a given x, both in 0..1. */
export function cubicBezierEase(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // A cubic bézier with endpoints (0,0) and (1,1) reduces to these coefficients.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDerivativeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  // Newton-Raphson first: converges in a few iterations for well-formed curves.
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const error = sampleX(t) - x;
    if (Math.abs(error) < 1e-6) return sampleY(t);
    const derivative = sampleDerivativeX(t);
    if (Math.abs(derivative) < 1e-6) break;
    t -= error / derivative;
  }
  // Bisection fallback — handles the authored curves whose control points sit outside
  // 0..1 (e.g. PULSE's [0.6, 0, 0.48, 1.178], BOUNCE's negative y), where the derivative
  // can vanish and Newton stalls.
  let low = 0;
  let high = 1;
  t = x;
  while (low < high) {
    const value = sampleX(t);
    if (Math.abs(value - x) < 1e-6) break;
    if (value > x) high = t;
    else low = t;
    const next = (high + low) / 2;
    if (Math.abs(next - t) < 1e-9) break;
    t = next;
  }
  return sampleY(t);
}

/**
 * Value of one authored channel at [frame]. Keyframes must be sorted by frame
 * (the exported spec always is).
 */
export function valueAtFrame(keyframes: AuthoredKeyframe[], frame: number): number {
  if (!keyframes.length) return 0;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  // Clamp outside the authored range rather than extrapolating.
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const from = keyframes[i];
    const to = keyframes[i + 1];
    if (frame > to.frame) continue;
    // `hold` freezes the segment at the start value until the next keyframe.
    if (from.hold) return from.value;
    const span = to.frame - from.frame;
    if (span <= 0) return to.value;
    const linear = (frame - from.frame) / span;
    const eased = from.easing
      ? cubicBezierEase(linear, from.easing[0], from.easing[1], from.easing[2], from.easing[3])
      : linear;
    return from.value + (to.value - from.value) * eased;
  }
  return last.value;
}
