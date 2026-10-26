/**
 * Curved text, one geometry for the web canvas and the app.
 *
 * The app (PhotoEditor `CurvedTextLayout.kt`) lays curved text on a true circular ARC: the layer
 * carries `{ arcDegrees }`, the circle's radius is whatever makes the text's own advance fill that
 * arc exactly (radius = advance ÷ sweep), the arc is centred on the box's vertical axis and its
 * sag is centred in the box. The web editor used to bend along a quadratic Bézier whose bulge came
 * from the box width instead — a different shape at every amount, and wildly so at Canva's tight
 * arcs (DAHQBvX7oJU's "TRANSFORMATION" ring: a pointed parabola on the web, a near half circle in
 * the app and Canva). Both sides now go through here:
 *  - `resolveTextCurveConfig` is what the server sends the app (mobileProject.readCurveConfig);
 *  - `resolveCurvedTextArc` + `curvedTextArcPath` draw the app's arc on the web canvas.
 */

export interface TextCurveSource {
  textCurveEnabled?: unknown;
  textCurveAmount?: unknown;
  /** The arc Canva actually drew, measured by the importer; wins over the amount when present. */
  textCurveArcDegrees?: unknown;
  width?: unknown;
  scaleX?: unknown;
  fontSize?: unknown;
}

export interface TextCurveConfig {
  enabled: boolean;
  /** Signed: positive bows up (a dome ∩), negative down (a valley ∪). */
  arcDegrees: number;
  /** Informational for the app (its geometry derives the radius from the text advance). */
  radius: number;
}

const finiteOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * The layer's curve as the app's `{ enabled, arcDegrees, radius }`. A measured Canva arc
 * (`textCurveArcDegrees`) wins; otherwise the editor amount's sagitta — `amount`% of
 * clamp(width·0.42, fontSize, fontSize·6), halved because the Bézier's peak sits half-way to its
 * control point — over the box's chord is turned into the circle through the same three points.
 */
export function resolveTextCurveConfig(item: TextCurveSource | null | undefined): TextCurveConfig {
  const amount = clamp(finiteOr(item?.textCurveAmount, 0), -200, 200);
  const measuredArc = finiteOr(item?.textCurveArcDegrees, 0);
  // The app's test — enabled with more than half a degree; an arc alone (the curve slider writes
  // it directly, 100% = a full ring) is enough, the legacy amount still counts for old layers.
  const enabled = Boolean(item?.textCurveEnabled) && (Math.abs(measuredArc) > 0.5 || Math.abs(amount) > 0.5);
  if (!enabled) return { enabled: false, arcDegrees: 0, radius: 200 };
  const width = Math.max(2, finiteOr(item?.width, 2) * Math.abs(finiteOr(item?.scaleX, 1)));
  const fontSize = Math.max(1, finiteOr(item?.fontSize, 42));
  let arcDegrees: number;
  let radius: number;
  if (Math.abs(measuredArc) > 0.5) {
    arcDegrees = clamp(measuredArc, -360, 360);
    radius = width / (2 * Math.sin(Math.min(Math.PI / 2, (Math.abs(arcDegrees) * Math.PI) / 360)));
  } else {
    const maxCurveOffset = Math.max(Math.max(12, fontSize), Math.min(width * 0.42, Math.max(16, fontSize * 6)));
    const sagitta = Math.max(0.5, ((Math.abs(amount) / 100) * maxCurveOffset) / 2);
    radius = (width * width) / (8 * sagitta) + sagitta / 2;
    arcDegrees = Math.sign(amount) * ((2 * Math.asin(Math.min(1, width / (2 * radius))) * 180) / Math.PI);
  }
  return { enabled: true, arcDegrees: Math.round(arcDegrees * 10) / 10, radius: Math.round(radius) };
}

export interface CurvedTextArc {
  /** Box x the arc is centred on (width / 2). */
  axisX: number;
  /** Box y of the arc's apex (θ = 0), where glyph middles ride. */
  baselineY: number;
  radius: number;
  halfSweepRad: number;
  /** +1 dome (∩), -1 valley (∪). */
  bendDirection: number;
  totalAdvance: number;
}

/**
 * The app's `resolveCurvedTextArc`, line for line: the radius makes `totalAdvance` fill
 * `arcDegrees` exactly and the arc's sag is centred in the box. (The app also shifts the baseline
 * by half its ascent–descent so the INK, not the baseline, rides the arc; the web draws glyphs
 * with a middle baseline, which is the same thing.)
 */
export function resolveCurvedTextArc(
  totalAdvance: number,
  arcDegrees: number,
  containerWidth: number,
  containerHeight: number
): CurvedTextArc {
  const w = Math.max(1, finiteOr(containerWidth, 1));
  const h = Math.max(1, finiteOr(containerHeight, 1));
  const advance = Math.max(1, finiteOr(totalAdvance, 1));
  const bendDirection = finiteOr(arcDegrees, 0) >= 0 ? 1 : -1;
  const sweepRadians = (clamp(Math.abs(finiteOr(arcDegrees, 0)), 0.5, 360) * Math.PI) / 180;
  const radius = Math.max(1, advance / Math.max(0.001, sweepRadians));
  const halfSweep = sweepRadians / 2;
  const actualSag = radius * (1 - Math.cos(halfSweep));
  return {
    axisX: w / 2,
    baselineY: h / 2 - (bendDirection * actualSag) / 2,
    radius,
    halfSweepRad: halfSweep,
    bendDirection,
    totalAdvance: advance,
  };
}

/** The point the arc passes at angle θ from its apex (the app's `placeAtAdvance`). */
export function curvedTextArcPoint(arc: CurvedTextArc, theta: number) {
  return {
    x: arc.axisX + arc.radius * Math.sin(theta),
    y: arc.baselineY + arc.bendDirection * arc.radius * (1 - Math.cos(theta)),
  };
}

/**
 * SVG path data for the arc, starting exactly at its start (θ = −half sweep) so a TextPath laid
 * out from offset 0 puts every glyph's centre where the app puts it, and running `extraLength`
 * past the end: the canvas only draws a glyph whose END point is on the path, and the last glyph's
 * slot ends right at the arc's end. Drawn in ≤ 90° pieces, so no large-arc ambiguity, even for a
 * full ring.
 */
export function curvedTextArcPath(arc: CurvedTextArc, extraLength = 0): string {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const start = -arc.halfSweepRad;
  const end = arc.halfSweepRad + Math.max(0, finiteOr(extraLength, 0)) / arc.radius;
  const sweepFlag = arc.bendDirection > 0 ? 1 : 0;
  const pieces = Math.max(1, Math.ceil((end - start) / (Math.PI / 2)));
  const first = curvedTextArcPoint(arc, start);
  const parts = [`M ${round(first.x)} ${round(first.y)}`];
  for (let index = 1; index <= pieces; index += 1) {
    const point = curvedTextArcPoint(arc, start + ((end - start) * index) / pieces);
    parts.push(`A ${round(arc.radius)} ${round(arc.radius)} 0 0 ${sweepFlag} ${round(point.x)} ${round(point.y)}`);
  }
  return parts.join(" ");
}
