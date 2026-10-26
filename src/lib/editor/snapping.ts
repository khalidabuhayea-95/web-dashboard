/**
 * Smart snapping for the canvas: while a selection is dragged or resized, its edges and centre
 * lines pull onto the page's edges and centre lines and onto every other layer's edges and centre
 * lines that come within a few screen pixels, and a guide line shows what it snapped to.
 *
 * Pure geometry in PAGE px (the coordinate system the elements live in). Rects are axis-aligned
 * bounding boxes, so a turned layer snaps by the box it visibly occupies.
 */

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line something can snap to: its position on one axis and its extent along the other. */
export interface SnapLine {
  position: number;
  start: number;
  end: number;
}

export interface SnapTargets {
  /** x = position: lines a left / centre / right edge can snap to. */
  vertical: SnapLine[];
  /** y = position: lines a top / middle / bottom edge can snap to. */
  horizontal: SnapLine[];
  /** The other layers themselves, for equal-spacing snaps. */
  rects: SnapRect[];
}

export interface SnapGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

/**
 * One of the equal gaps an equal-spacing snap lines up: a "horizontal" gap runs along x from
 * [from] to [to] at height [at]; a "vertical" one along y at x = [at].
 */
export interface SpacingMark {
  orientation: "horizontal" | "vertical";
  from: number;
  to: number;
  at: number;
}

/** How close (in screen px) an edge has to come before it snaps; divide by the zoom for page px. */
export const SNAP_THRESHOLD_SCREEN_PX = 6;

const COINCIDE_PX = 0.5;
const MOVED_EPSILON = 0.01;

const finite = (value: number) => Number.isFinite(value);
const usable = (rect: SnapRect | null | undefined): rect is SnapRect =>
  Boolean(rect) &&
  finite(rect!.x) &&
  finite(rect!.y) &&
  finite(rect!.width) &&
  finite(rect!.height) &&
  rect!.width >= 0 &&
  rect!.height >= 0;

/** Every line the page and the other layers offer. */
export function buildSnapTargets(page: { width: number; height: number }, rects: Array<SnapRect | null | undefined>): SnapTargets {
  const vertical: SnapLine[] = [];
  const horizontal: SnapLine[] = [];
  const others: SnapRect[] = [];
  const width = Math.max(0, Number(page.width) || 0);
  const height = Math.max(0, Number(page.height) || 0);
  for (const x of [0, width / 2, width]) vertical.push({ position: x, start: 0, end: height });
  for (const y of [0, height / 2, height]) horizontal.push({ position: y, start: 0, end: width });
  for (const rect of rects) {
    if (!usable(rect)) continue;
    others.push(rect);
    for (const x of [rect.x, rect.x + rect.width / 2, rect.x + rect.width]) {
      vertical.push({ position: x, start: rect.y, end: rect.y + rect.height });
    }
    for (const y of [rect.y, rect.y + rect.height / 2, rect.y + rect.height]) {
      horizontal.push({ position: y, start: rect.x, end: rect.x + rect.width });
    }
  }
  return { vertical, horizontal, rects: others };
}

/** The smallest shift (within [threshold]) that puts one of [stops] on one of [lines], or null. */
function nearestShift(stops: number[], lines: SnapLine[], threshold: number): number | null {
  let best: number | null = null;
  for (const stop of stops) {
    for (const line of lines) {
      const shift = line.position - stop;
      if (Math.abs(shift) > threshold) continue;
      if (best === null || Math.abs(shift) < Math.abs(best)) best = shift;
    }
  }
  return best;
}

/**
 * Guides for every line a stop of [rect] now sits on, each running from the line's own extent
 * across to the rect so both objects are joined by it. One guide per position.
 */
function guidesFor(rect: SnapRect, targets: SnapTargets, snapX: boolean, snapY: boolean): SnapGuide[] {
  const guides: SnapGuide[] = [];
  const add = (orientation: SnapGuide["orientation"], stops: number[], lines: SnapLine[], from: number, to: number) => {
    const seen = new Map<number, SnapGuide>();
    for (const stop of stops) {
      for (const line of lines) {
        if (Math.abs(line.position - stop) > COINCIDE_PX) continue;
        const key = Math.round(line.position * 2) / 2;
        const existing = seen.get(key);
        const start = Math.min(line.start, from);
        const end = Math.max(line.end, to);
        if (existing) {
          existing.start = Math.min(existing.start, start);
          existing.end = Math.max(existing.end, end);
        } else {
          seen.set(key, { orientation, position: line.position, start, end });
        }
      }
    }
    guides.push(...seen.values());
  };
  if (snapX) {
    add("vertical", [rect.x, rect.x + rect.width / 2, rect.x + rect.width], targets.vertical, rect.y, rect.y + rect.height);
  }
  if (snapY) {
    add("horizontal", [rect.y, rect.y + rect.height / 2, rect.y + rect.height], targets.horizontal, rect.x, rect.x + rect.width);
  }
  return guides;
}

// ── Equal spacing ─────────────────────────────────────────────────────────────────────────────
// Worked on one axis at a time through an accessor, so x and y share the code: `lo`/`size` read
// the axis being snapped, `crossLo`/`crossSize` the other one.
interface Axis {
  lo: (rect: SnapRect) => number;
  size: (rect: SnapRect) => number;
  crossLo: (rect: SnapRect) => number;
  crossSize: (rect: SnapRect) => number;
  orientation: SpacingMark["orientation"];
}
const X_AXIS: Axis = {
  lo: (rect) => rect.x,
  size: (rect) => rect.width,
  crossLo: (rect) => rect.y,
  crossSize: (rect) => rect.height,
  orientation: "horizontal",
};
const Y_AXIS: Axis = {
  lo: (rect) => rect.y,
  size: (rect) => rect.height,
  crossLo: (rect) => rect.x,
  crossSize: (rect) => rect.width,
  orientation: "vertical",
};
const hi = (axis: Axis, rect: SnapRect) => axis.lo(rect) + axis.size(rect);
const crossOverlap = (axis: Axis, a: SnapRect, b: SnapRect) =>
  Math.min(axis.crossLo(a) + axis.crossSize(a), axis.crossLo(b) + axis.crossSize(b)) -
  Math.max(axis.crossLo(a), axis.crossLo(b));
/** Where a gap mark between [a] and [b] is drawn: the middle of the span they share across. */
const markAt = (axis: Axis, a: SnapRect, b: SnapRect) => {
  const lo = Math.max(axis.crossLo(a), axis.crossLo(b));
  const top = Math.min(axis.crossLo(a) + axis.crossSize(a), axis.crossLo(b) + axis.crossSize(b));
  return top >= lo ? (lo + top) / 2 : (axis.crossLo(a) + axis.crossSize(a) / 2 + axis.crossLo(b) + axis.crossSize(b) / 2) / 2;
};

/**
 * The equal-spacing snap nearest [rect] on one axis, among the layers that share its row (they
 * overlap it across the axis): centred between its nearest neighbours either side, or one of the
 * row's existing gaps repeated next to a neighbour. Null when none is within [threshold].
 */
function nearestSpacing(
  rect: SnapRect,
  rects: SnapRect[],
  threshold: number,
  axis: Axis
): { shift: number; marks: SpacingMark[] } | null {
  const row = rects.filter((other) => crossOverlap(axis, rect, other) > 0);
  if (row.length === 0) return null;
  const size = axis.size(rect);
  const lo = axis.lo(rect);
  // Neighbours on each side (the moving rect may already overlap them by up to the threshold).
  const before = row.filter((other) => hi(axis, other) <= lo + threshold);
  const after = row.filter((other) => axis.lo(other) >= lo + size - threshold);
  const nearestBefore = before.reduce<SnapRect | null>((best, other) => (!best || hi(axis, other) > hi(axis, best) ? other : best), null);
  const nearestAfter = after.reduce<SnapRect | null>((best, other) => (!best || axis.lo(other) < axis.lo(best) ? other : best), null);
  let best: { shift: number; marks: SpacingMark[] } | null = null;
  const consider = (target: number, marks: (placed: number) => SpacingMark[]) => {
    const shift = target - lo;
    if (Math.abs(shift) > threshold) return;
    if (best && Math.abs(shift) >= Math.abs(best.shift)) return;
    best = { shift, marks: marks(target) };
  };
  const mark = (from: number, to: number, at: number): SpacingMark => ({ orientation: axis.orientation, from, to, at });
  const placedRect = (placed: number): SnapRect =>
    axis === X_AXIS ? { ...rect, x: placed } : { ...rect, y: placed };

  // 1. Centred between the two neighbours.
  if (nearestBefore && nearestAfter) {
    const room = axis.lo(nearestAfter) - hi(axis, nearestBefore);
    if (room > size) {
      consider(hi(axis, nearestBefore) + (room - size) / 2, (placed) => {
        const moved = placedRect(placed);
        return [
          mark(hi(axis, nearestBefore), placed, markAt(axis, nearestBefore, moved)),
          mark(placed + size, axis.lo(nearestAfter), markAt(axis, moved, nearestAfter)),
        ];
      });
    }
  }
  // 2. A gap the row already has, repeated beside a neighbour.
  for (const a of row) {
    for (const b of row) {
      if (a === b) continue;
      const gap = axis.lo(b) - hi(axis, a);
      if (!(gap > 0)) continue;
      if (crossOverlap(axis, a, b) <= 0) continue;
      // The reference pair sits wholly on one side of the moving rect; a pair around it is the
      // centring case above.
      const bothBefore = hi(axis, b) <= lo + threshold;
      const bothAfter = axis.lo(a) >= lo + size - threshold;
      if (!bothBefore && !bothAfter) continue;
      const reference = mark(hi(axis, a), axis.lo(b), markAt(axis, a, b));
      if (nearestBefore) {
        consider(hi(axis, nearestBefore) + gap, (placed) => [
          reference,
          mark(hi(axis, nearestBefore), placed, markAt(axis, nearestBefore, placedRect(placed))),
        ]);
      }
      if (nearestAfter) {
        consider(axis.lo(nearestAfter) - gap - size, (placed) => [
          reference,
          mark(placed + size, axis.lo(nearestAfter), markAt(axis, placedRect(placed), nearestAfter)),
        ]);
      }
    }
  }
  return best;
}

/**
 * A rect being MOVED: per axis, the smaller of two pulls — its nearest edge or centre line onto a
 * target line, or an equal-spacing position among the layers in its row — plus the guides and gap
 * marks to draw once shifted. Zero shift and nothing to draw when nothing is near.
 */
export function snapMovingRect(
  rect: SnapRect,
  targets: SnapTargets,
  threshold: number
): { dx: number; dy: number; guides: SnapGuide[]; spacings: SpacingMark[] } {
  if (!usable(rect) || !(threshold > 0)) return { dx: 0, dy: 0, guides: [], spacings: [] };
  const rects = targets.rects || [];
  const edgeX = nearestShift([rect.x, rect.x + rect.width / 2, rect.x + rect.width], targets.vertical, threshold);
  const edgeY = nearestShift([rect.y, rect.y + rect.height / 2, rect.y + rect.height], targets.horizontal, threshold);
  const spaceX = nearestSpacing(rect, rects, threshold, X_AXIS);
  const spaceY = nearestSpacing(rect, rects, threshold, Y_AXIS);
  // An edge line wins a tie: it is the stronger, more common intent.
  const useSpaceX = spaceX !== null && (edgeX === null || Math.abs(spaceX.shift) < Math.abs(edgeX));
  const useSpaceY = spaceY !== null && (edgeY === null || Math.abs(spaceY.shift) < Math.abs(edgeY));
  const dx = useSpaceX ? spaceX!.shift : edgeX;
  const dy = useSpaceY ? spaceY!.shift : edgeY;
  const moved = { ...rect, x: rect.x + (dx ?? 0), y: rect.y + (dy ?? 0) };
  // Guides for whatever edges now line up (a spaced position can also land on a line).
  const guides = guidesFor(moved, targets, dx !== null, dy !== null);
  const spacings = [...(useSpaceX ? spaceX!.marks : []), ...(useSpaceY ? spaceY!.marks : [])];
  return { dx: dx ?? 0, dy: dy ?? 0, guides, spacings };
}

/**
 * A rect being RESIZED from [previous] to [next]: each edge that moved (one per axis — a centred
 * resize moves both and is left alone) snaps onto the nearest target. With [keepRatio] (a corner
 * handle) only the axis that is closer snaps and the other side follows the aspect ratio, pinned
 * at the edge that is not moving. Returns the rect to use and the guides to draw.
 */
export function snapResizedRect(
  previous: SnapRect,
  next: SnapRect,
  targets: SnapTargets,
  threshold: number,
  keepRatio: boolean
): { rect: SnapRect; guides: SnapGuide[] } {
  if (!usable(previous) || !usable(next) || !(threshold > 0)) return { rect: next, guides: [] };
  const leftMoved = Math.abs(next.x - previous.x) > MOVED_EPSILON;
  const rightMoved = Math.abs(next.x + next.width - (previous.x + previous.width)) > MOVED_EPSILON;
  const topMoved = Math.abs(next.y - previous.y) > MOVED_EPSILON;
  const bottomMoved = Math.abs(next.y + next.height - (previous.y + previous.height)) > MOVED_EPSILON;
  const xEdge = leftMoved !== rightMoved ? (leftMoved ? "left" : "right") : null;
  const yEdge = topMoved !== bottomMoved ? (topMoved ? "top" : "bottom") : null;
  const xShift = xEdge ? nearestShift([xEdge === "left" ? next.x : next.x + next.width], targets.vertical, threshold) : null;
  const yShift = yEdge ? nearestShift([yEdge === "top" ? next.y : next.y + next.height], targets.horizontal, threshold) : null;
  if (xShift === null && yShift === null) return { rect: next, guides: [] };

  let useX = xShift !== null;
  let useY = yShift !== null;
  const ratio = next.height > 0 ? next.width / next.height : 0;
  const proportional = keepRatio && xEdge !== null && yEdge !== null && ratio > 0;
  if (proportional && useX && useY) {
    if (Math.abs(xShift!) <= Math.abs(yShift!)) useY = false;
    else useX = false;
  }

  const rect = { ...next };
  if (useX) {
    if (xEdge === "left") {
      rect.x += xShift!;
      rect.width -= xShift!;
    } else {
      rect.width += xShift!;
    }
  }
  if (useY) {
    if (yEdge === "top") {
      rect.y += yShift!;
      rect.height -= yShift!;
    } else {
      rect.height += yShift!;
    }
  }
  if (proportional) {
    if (useX) {
      const height = rect.width / ratio;
      if (yEdge === "top") rect.y = rect.y + rect.height - height;
      rect.height = height;
    } else if (useY) {
      const width = rect.height * ratio;
      if (xEdge === "left") rect.x = rect.x + rect.width - width;
      rect.width = width;
    }
  }
  if (!(rect.width > 0) || !(rect.height > 0)) return { rect: next, guides: [] };

  // Only the edges that moved draw a guide; the fixed side is not "snapped".
  const edgeGuides = guidesFor(rect, targets, useX, useY).filter((guide) => {
    if (guide.orientation === "vertical") {
      const edge = xEdge === "left" ? rect.x : rect.x + rect.width;
      return Math.abs(guide.position - edge) <= COINCIDE_PX;
    }
    const edge = yEdge === "top" ? rect.y : rect.y + rect.height;
    return Math.abs(guide.position - edge) <= COINCIDE_PX;
  });
  return { rect, guides: edgeGuides };
}

/** The bounding box of several rects, or null when there are none. */
export function unionRect(rects: Array<SnapRect | null | undefined>): SnapRect | null {
  const usableRects = rects.filter(usable);
  if (usableRects.length === 0) return null;
  const left = Math.min(...usableRects.map((rect) => rect.x));
  const top = Math.min(...usableRects.map((rect) => rect.y));
  const right = Math.max(...usableRects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...usableRects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// ── Resizing a TURNED box ──────────────────────────────────────────────────────────────────────

/** A box as Konva's Transformer describes it: top-left corner (turned with it), size, rotation in radians. */
export interface RotatedSnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

type Point = { x: number; y: number };
const ROTATION_EPSILON = 1e-4;
// Below this, moving the edge barely moves the corner along that page axis: solving for it would
// fling the edge, so that axis is left to the other line orientation.
const MIN_AXIS_COMPONENT = 0.05;

function cornersOf(box: RotatedSnapBox) {
  const u = { x: Math.cos(box.rotation), y: Math.sin(box.rotation) };
  const v = { x: -Math.sin(box.rotation), y: Math.cos(box.rotation) };
  const tl = { x: box.x, y: box.y };
  const tr = { x: tl.x + box.width * u.x, y: tl.y + box.width * u.y };
  const bl = { x: tl.x + box.height * v.x, y: tl.y + box.height * v.y };
  const br = { x: tr.x + box.height * v.x, y: tr.y + box.height * v.y };
  return { u, v, tl, tr, bl, br };
}

interface CornerSnap {
  /** How far the corner is from the line now (page px) — the candidate with the least wins. */
  distance: number;
  /** The parameter that lands it there (an edge shift, or a scale factor). */
  value: number;
  corner: Point;
  line: SnapLine;
  orientation: SnapGuide["orientation"];
}

/**
 * The nearest line a corner can be carried onto, where `along(corner, line, orientation)` returns
 * the parameter that puts the corner on the line (or null when this motion cannot reach it).
 */
function nearestCornerSnap(
  corners: Point[],
  targets: SnapTargets,
  threshold: number,
  along: (corner: Point, line: SnapLine, orientation: SnapGuide["orientation"]) => number | null
): CornerSnap | null {
  let best: CornerSnap | null = null;
  for (const corner of corners) {
    for (const [orientation, lines] of [
      ["vertical", targets.vertical],
      ["horizontal", targets.horizontal],
    ] as const) {
      for (const line of lines) {
        const distance = Math.abs(line.position - (orientation === "vertical" ? corner.x : corner.y));
        if (distance > threshold) continue;
        if (best && distance >= best.distance) continue;
        const value = along(corner, line, orientation);
        if (value === null || !Number.isFinite(value)) continue;
        best = { distance, value, corner, line, orientation };
      }
    }
  }
  return best;
}

function cornerGuide(snap: CornerSnap, landed: Point): SnapGuide {
  const across = snap.orientation === "vertical" ? landed.y : landed.x;
  return {
    orientation: snap.orientation,
    position: snap.line.position,
    start: Math.min(snap.line.start, across),
    end: Math.max(snap.line.end, across),
  };
}

/**
 * A TURNED box being resized from [previous] to [next] (same rotation): its edges are slanted, so
 * what snaps is a CORNER that the resize moves landing on a target line. A side handle slides its
 * edge's two corners along the box's own axis; a corner handle with [keepRatio] scales every moving
 * corner about the fixed opposite corner. Each moving edge (one per box axis — a centred resize is
 * left alone) snaps on its own; with [keepRatio] one scale serves both.
 */
export function snapResizedRotatedBox(
  previous: RotatedSnapBox,
  next: RotatedSnapBox,
  targets: SnapTargets,
  threshold: number,
  keepRatio: boolean
): { box: RotatedSnapBox; guides: SnapGuide[] } {
  const unchanged = { box: next, guides: [] as SnapGuide[] };
  const valid = (box: RotatedSnapBox) =>
    [box.x, box.y, box.width, box.height, box.rotation].every(Number.isFinite) && box.width > 0 && box.height > 0;
  if (!valid(previous) || !valid(next) || !(threshold > 0)) return unchanged;
  if (Math.abs(previous.rotation - next.rotation) > ROTATION_EPSILON) return unchanged; // turning, not resizing

  const { u, v, tl, tr, bl, br } = cornersOf(next);
  // Which of the box's own edges moved, measured in its own axes.
  const shift = { x: next.x - previous.x, y: next.y - previous.y };
  const leftShift = shift.x * u.x + shift.y * u.y;
  const topShift = shift.x * v.x + shift.y * v.y;
  const leftMoved = Math.abs(leftShift) > MOVED_EPSILON;
  const rightMoved = Math.abs(leftShift + next.width - previous.width) > MOVED_EPSILON;
  const topMoved = Math.abs(topShift) > MOVED_EPSILON;
  const bottomMoved = Math.abs(topShift + next.height - previous.height) > MOVED_EPSILON;
  const xEdge = leftMoved !== rightMoved ? (leftMoved ? "left" : "right") : null;
  const yEdge = topMoved !== bottomMoved ? (topMoved ? "top" : "bottom") : null;
  if (!xEdge && !yEdge) return unchanged;

  if (keepRatio && xEdge && yEdge) {
    // Scale about the corner that is not moving.
    const fixed = xEdge === "right" ? (yEdge === "bottom" ? tl : bl) : yEdge === "bottom" ? tr : br;
    const moving = [tl, tr, bl, br].filter((corner) => corner !== fixed);
    const snap = nearestCornerSnap(moving, targets, threshold, (corner, line, orientation) => {
      const reach = orientation === "vertical" ? corner.x - fixed.x : corner.y - fixed.y;
      if (Math.abs(reach) < 1) return null;
      const scale = (line.position - (orientation === "vertical" ? fixed.x : fixed.y)) / reach;
      return scale > 0 ? scale : null;
    });
    if (!snap) return unchanged;
    const s = snap.value;
    const box = {
      ...next,
      x: fixed.x + s * (tl.x - fixed.x),
      y: fixed.y + s * (tl.y - fixed.y),
      width: next.width * s,
      height: next.height * s,
    };
    const landed = { x: fixed.x + s * (snap.corner.x - fixed.x), y: fixed.y + s * (snap.corner.y - fixed.y) };
    return { box, guides: [cornerGuide(snap, landed)] };
  }

  // Each moving edge slides along its own axis (u for left/right, v for top/bottom).
  const slide = (axis: Point) => (corner: Point, line: SnapLine, orientation: SnapGuide["orientation"]) => {
    const component = orientation === "vertical" ? axis.x : axis.y;
    if (Math.abs(component) < MIN_AXIS_COMPONENT) return null;
    return (line.position - (orientation === "vertical" ? corner.x : corner.y)) / component;
  };
  const xSnap = xEdge ? nearestCornerSnap(xEdge === "right" ? [tr, br] : [tl, bl], targets, threshold, slide(u)) : null;
  const ySnap = yEdge ? nearestCornerSnap(yEdge === "bottom" ? [bl, br] : [tl, tr], targets, threshold, slide(v)) : null;
  if (!xSnap && !ySnap) return unchanged;

  const box = { ...next };
  const guides: SnapGuide[] = [];
  if (xSnap) {
    const d = xSnap.value;
    if (xEdge === "right") box.width += d;
    else {
      box.x += d * u.x;
      box.y += d * u.y;
      box.width -= d;
    }
  }
  if (ySnap) {
    const d = ySnap.value;
    if (yEdge === "bottom") box.height += d;
    else {
      box.x += d * v.x;
      box.y += d * v.y;
      box.height -= d;
    }
  }
  if (!(box.width > 0) || !(box.height > 0)) return unchanged;
  // Report where the snapped corners ended up (both edges' shifts applied).
  const after = cornersOf(box);
  const landedOf = (corner: Point) =>
    corner === tl ? after.tl : corner === tr ? after.tr : corner === bl ? after.bl : after.br;
  if (xSnap) guides.push(cornerGuide(xSnap, landedOf(xSnap.corner)));
  if (ySnap) guides.push(cornerGuide(ySnap, landedOf(ySnap.corner)));
  return { box, guides };
}
