/**
 * Canva's tween machinery, ported (docs/canva-animation-parity.md §1, §2 "tween-list evaluation
 * rule", §8.3 and §8.4). Pure — no rendering — so the web and the app evaluate the same numbers.
 *
 * A Canva animation is a LIST of tweens per property. Canva evaluates a property at time `t` by
 * sorting the list by delay, DESCENDING, and taking the first tween that touches the property and
 * has started (`Xpf`); before the very first tween that touches it, that tween's START value shows,
 * and a tween that has ended returns its exact END value (`aqf`). So between tweens the previous
 * tween's end value holds. Per-unit text schedules are fitted to their window (`$qf`/`Yqf`/`Zqf`,
 * floors included) and Neon's are de-overlapped (`Gqf`/`Fqf`) exactly as Canva does it.
 *
 * Canva's own code is not reproduced here; the arithmetic is (same floors, same order).
 */

// ── Easings (§1), on u ∈ [0, 1] ─────────────────────────────────────────────────────────────────

export function easeInQuad(u: number) {
  return u * u;
}
export function easeOutQuad(u: number) {
  return u * (2 - u);
}
export function easeInOutQuad(u: number) {
  return u < 0.5 ? 2 * u * u : (4 - 2 * u) * u - 1;
}
export function easeInCubic(u: number) {
  return u * u * u;
}
export function easeOutCubic(u: number) {
  const v = u - 1;
  return v * v * v + 1;
}
export function easeInOutCubic(u: number) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
export function easeInQuart(u: number) {
  return u * u * u * u;
}
export function easeOutQuart(u: number) {
  return 1 - Math.pow(1 - u, 4);
}
/**
 * `1 − 2^(−10u)`, pinned to 1 at u = 1: the bare formula ends at 1 − 2⁻¹⁰, and a tween that has
 * ENDED returns its END value in Canva (§8.0), so BASELINE must land exactly home — the timeline
 * holds the entrance's last frame, and the 1/1024 it left behind was a permanent sub-pixel offset
 * plus a hairline of clipped content on every Baseline layer at rest.
 */
export function easeOutExpo(u: number) {
  if (u >= 1) return 1;
  return 1 - Math.pow(2, -10 * u);
}
export function easeInSine(u: number) {
  return 1 - Math.cos((u * Math.PI) / 2);
}
export function elasticIn(u: number, amplitude = 1) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return -Math.pow(2, (10 * (u - 1)) / amplitude) * Math.sin((u - 1.1) * 5 * Math.PI);
}
export function elasticOut(u: number, amplitude = 1) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return Math.pow(2, (-10 * u) / amplitude) * Math.sin((u - 0.1) * 5 * Math.PI) + 1;
}

/** Canva's easing ids (their `bv` table). 16..22 exist and are LINEAR; anything else is too. */
export const CANVA_EASE = {
  LINEAR: 1,
  IN_QUAD: 2,
  OUT_QUAD: 3,
  IN_OUT_QUAD: 4,
  IN_CUBIC: 5,
  OUT_CUBIC: 6,
  IN_QUART: 7,
  OUT_QUART: 8,
  OUT_EXPO: 9,
  IN_SINE: 10,
  ELASTIC_IN: 11,
  ELASTIC_OUT: 12,
  ELASTIC_IN_SOFT: 13,
  ELASTIC_OUT_SOFT: 14,
  IN_OUT_CUBIC: 15,
} as const;

/**
 * The eased fraction for Canva easing [id] at [u]. A tween whose time has reached its duration
 * returns its END value (§8.0), so u ≥ 1 is exactly 1 for every curve.
 */
export function canvaEase(id: number, u: number): number {
  if (u >= 1) return 1;
  if (u <= 0) return 0;
  switch (id) {
    case CANVA_EASE.IN_QUAD:
      return easeInQuad(u);
    case CANVA_EASE.OUT_QUAD:
      return easeOutQuad(u);
    case CANVA_EASE.IN_OUT_QUAD:
      return easeInOutQuad(u);
    case CANVA_EASE.IN_CUBIC:
      return easeInCubic(u);
    case CANVA_EASE.OUT_CUBIC:
      return easeOutCubic(u);
    case CANVA_EASE.IN_QUART:
      return easeInQuart(u);
    case CANVA_EASE.OUT_QUART:
      return easeOutQuart(u);
    case CANVA_EASE.OUT_EXPO:
      return easeOutExpo(u);
    case CANVA_EASE.IN_SINE:
      return easeInSine(u);
    case CANVA_EASE.ELASTIC_IN:
      return elasticIn(u, 1);
    case CANVA_EASE.ELASTIC_OUT:
      return elasticOut(u, 1);
    case CANVA_EASE.ELASTIC_IN_SOFT:
      return elasticIn(u, 0.7);
    case CANVA_EASE.ELASTIC_OUT_SOFT:
      return elasticOut(u, 0.7);
    case CANVA_EASE.IN_OUT_CUBIC:
      return easeInOutCubic(u);
    default:
      return u;
  }
}

/** Canva's `cv`: a plain lerp, unclamped. */
export function canvaLerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

/**
 * Canva's per-element random, `rqf`: `|cos(s)| · w · h · max(top, 1) · max(left, 1) mod 1`. The
 * importer stores the product as the `seed` param (§8.1), so the runtime computes
 * `abs(cos(s) · seed) mod 1`, in doubles, on both platforms.
 */
export function canvaSeededRandom(s: number, seed: number): number {
  return Math.abs(Math.cos(s) * seed) % 1;
}

// ── Tweens ──────────────────────────────────────────────────────────────────────────────────────

export type CanvaTweenProperty =
  | "opacity"
  | "blur"
  | "scale"
  | "rotate"
  | "translateX"
  | "translateY";

export interface CanvaTween {
  delay: number;
  duration: number;
  start: Partial<Record<CanvaTweenProperty, number>>;
  end: Partial<Record<CanvaTweenProperty, number>>;
  /** Canva easing id; absent = LINEAR (their `b.easing || bv.LINEAR`). */
  easing?: number;
}

/** Properties that compose by multiplication (Canva's `Vpf`); every other one adds. */
const MULTIPLICATIVE: ReadonlySet<CanvaTweenProperty> = new Set(["opacity", "scale"]);

/** The value a property has when no tween touches it: 1 for the multiplicative ones, else 0. */
export function canvaPropertyRest(property: CanvaTweenProperty): number {
  return MULTIPLICATIVE.has(property) ? 1 : 0;
}

/** Canva's `aqf`: one tween at time [t] — its start before its delay, its end once it has ended. */
export function canvaTweenValue(tween: CanvaTween, property: CanvaTweenProperty, t: number): number {
  const from = tween.start[property] ?? 0;
  const to = tween.end[property] ?? 0;
  if (t < tween.delay) return from;
  const local = t - tween.delay;
  if (local >= tween.duration) return to;
  return from + (to - from) * canvaEase(tween.easing ?? CANVA_EASE.LINEAR, local / tween.duration);
}

/** Canva's `Rpf` order: delay DESCENDING. The sort is stable, so ties keep the list's order. */
export function canvaSortTweens(tweens: CanvaTween[]): CanvaTween[] {
  return [...tweens].sort((a, b) => b.delay - a.delay);
}

/**
 * Canva's `Xpf` over a list ALREADY sorted by [canvaSortTweens]: the latest-started tween that
 * touches [property] decides; before the first one, its start value shows. A property no tween
 * touches rests at [canvaPropertyRest].
 */
export function canvaTweenListValue(
  sortedDescending: CanvaTween[],
  property: CanvaTweenProperty,
  t: number
): number {
  let earliest: CanvaTween | null = null;
  for (const tween of sortedDescending) {
    if (tween.start[property] == null) continue;
    earliest = tween;
    if (t >= tween.delay) return canvaTweenValue(tween, property, t);
  }
  return earliest ? canvaTweenValue(earliest, property, t) : canvaPropertyRest(property);
}

/** The latest end (delay + duration) in [tweens], or 0 for an empty list. */
export function canvaTweenListEnd(tweens: CanvaTween[]): number {
  return tweens.reduce((end, tween) => Math.max(end, tween.delay + tween.duration), 0);
}

/**
 * Canva's `Zqf`: rescales a tween about the window start [windowStart] by [factor], FLOORING the
 * new delay and duration (a duration never drops below 1 ms).
 */
export function canvaScaleTween(tween: CanvaTween, factor: number, windowStart = 0): CanvaTween {
  return {
    ...tween,
    delay: Math.max(0, Math.floor(windowStart + (tween.delay - windowStart) * factor)),
    duration: Math.max(1, Math.floor(tween.duration * factor)),
  };
}

/**
 * Canva's `$qf` + `Yqf` for ONE leg (intro or outro) of a per-unit schedule: the span is the
 * latest end over every unit's list minus the window start; `fit` only ever shrinks the schedule
 * into [windowDuration], `fill` stretches or shrinks it to exactly that. Every tween is floored
 * through [canvaScaleTween], even when the factor is 1.
 */
export function canvaFitUnitSchedule(
  lists: CanvaTween[][],
  windowDuration: number,
  mode: "fit" | "fill",
  windowStart = 0
): CanvaTween[][] {
  const span = lists.reduce((max, list) => Math.max(max, canvaTweenListEnd(list)), 0) - windowStart;
  let factor = windowDuration / span;
  if (mode === "fit") factor = Math.min(1, factor);
  return lists.map((list) => list.map((tween) => canvaScaleTween(tween, factor, windowStart)));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Canva's `Fqf`: two tweens overlap in time (open intervals, at 1 µs) AND share a property. */
export function canvaTweensOverlap(a: CanvaTween, b: CanvaTween): boolean {
  const bStart = round3(b.delay);
  const aEnd = round3(a.delay + a.duration);
  if (round3(a.delay) < round3(b.delay + b.duration) && bStart < aEnd) {
    const keys = Object.keys(b.start);
    return Object.keys(a.start).some((key) => keys.includes(key));
  }
  return false;
}

/**
 * Canva's `Gqf`: walks the list from its END and drops every tween that overlaps one already kept,
 * so the later tween wins. The result comes out reversed, as theirs does (only tie-breaks between
 * equal delays can tell).
 */
export function canvaDedupeTweens(tweens: CanvaTween[]): CanvaTween[] {
  return tweens.reduceRight<CanvaTween[]>((kept, tween) => {
    if (!kept.some((other) => canvaTweensOverlap(tween, other))) kept.push(tween);
    return kept;
  }, []);
}

// ── Ramps (§8.2) ────────────────────────────────────────────────────────────────────────────────

/**
 * A two-stage time ramp in layer-local ms (§8.1 `r1*`/`r2*` params): before `r1Start` it holds
 * `r1From`; stage 1 runs `r1From → r1To` over `r1Dur` on easing `r1Ease`; stage 2 (only with a
 * `r2Dur`) runs `r1To → r2To` from `r2Start`. A duration ≤ 0 jumps straight to its end value.
 */
export interface CanvaRamp {
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: number;
  to2?: number;
  start2?: number;
  duration2?: number;
  ease2?: number;
}

function rampStage(from: number, to: number, start: number, duration: number, ease: number, t: number) {
  const elapsed = t - start;
  if (!(duration > 0) || elapsed >= duration) return to;
  return from + (to - from) * canvaEase(ease, elapsed / duration);
}

export function canvaRampValue(ramp: CanvaRamp, t: number): number {
  if (t < ramp.start) return ramp.from;
  if (ramp.duration2 !== undefined && ramp.start2 !== undefined && t >= ramp.start2) {
    return rampStage(
      ramp.to,
      ramp.to2 ?? ramp.to,
      ramp.start2,
      ramp.duration2,
      ramp.ease2 ?? CANVA_EASE.LINEAR,
      t
    );
  }
  return rampStage(ramp.from, ramp.to, ramp.start, ramp.duration, ramp.ease, t);
}
