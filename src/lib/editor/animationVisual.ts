/**
 * Port of the mobile app's `LayerAnimationVisualRuntime.kt` — resolves an animation spec at a
 * playback progress into a visual state. Mirrors `LayerAnimationVisualState` field-for-field.
 *
 * Two evaluation paths, exactly as the spec describes:
 *  • authoredCurves != null → play the keyframes at RAW cycleProgress. These IGNORE spec.easing;
 *    their béziers are baked per keyframe.
 *  • otherwise → the analytic formula, which DOES honour spec.easing through `progress`.
 *
 * Time bases are not interchangeable (this is the easiest thing to get wrong):
 *   cycleProgress — raw 0..1 from the slot.
 *   progress      — eased, and ping-ponged when infinite.
 *   pingPong      — raised-cosine mirror, NOT eased, NOT a triangle wave.
 *   wave          — sin(2π·cycleProgress).
 *
 * THE CANVA FAMILY (docs/canva-animation-parity.md — read it before touching anything below).
 * Twenty of the types reproduce Canva's own element animations, transcribed from Canva's tween
 * builders rather than measured off exports. They run on THREE more time bases:
 *   p — the raw entrance progress (= cycleProgress on the way in),
 *   u — the raw exit progress (= 1 − cycleProgress: the exit slot hands the runtime a REVERSED
 *       progress, see animationSlots.resolveTimelinePlaybackState), and
 *   Canva's own easings (§1 of the document), computed inline because none of them is one of
 *   ours. `spec.easing` is therefore ignored on these paths, like the authored curves ignore it.
 * Only the ONE-SHOT path of the enter/exit family is Canva's; an INFINITE spec keeps the older
 * loop formula, since a loop that fades to nothing every cycle would blink. SHIFT and SKATE are
 * our mirrors of RISE and PAN (the same tween heading DOWN / LEFT), so their one-shot rides the
 * same tween and they stay exact mirrors.
 *
 * ROUND 2 (§8 of the document) adds the importer's exact values on top, all optional:
 *   • `spec.params` (§8.1) — Canva's own numbers where the runtime used to assume them (Tumble's
 *     start pose, Stomp's start scale, Scrapbook's poses, the sequence index `xh`, the hash
 *     `seed`, writing styles, ramps, stacked repeating effects);
 *   • a CONCURRENT loop (§8.2) that runs alongside the entrance/exit for the whole window and
 *     composes with them — see resolvePlaybackVisualState;
 *   • per-unit text writing styles (§8.4) handed to the text renderer through `glyphMotion`.
 * A spec without params (every picker-made one) resolves exactly as before.
 */
import { valueAtFrame } from "./animationCurves";
import type { RevealEdge } from "./animationClip";
import {
  CANVA_EASE,
  canvaRampValue,
  canvaSeededRandom,
  easeInCubic,
  easeInOutQuad,
  easeInQuad,
  easeInQuart,
  easeInSine,
  easeOutCubic,
  easeOutExpo,
  easeOutQuad,
  easeOutQuart,
  elasticIn,
  elasticOut,
  type CanvaRamp,
} from "./animationCanvaTweens";
import { canvaUnitMode, isCanvaUnitType } from "./animationCanvaUnits";
import type { PlaybackState } from "./animationSlots";
import {
  COMP_PX,
  getAnimationDefaults,
  getAuthoredCurves,
  type AnimationDirection,
  type AnimationEasing,
} from "./animationSpec";

export type TextRevealMode = "CHARS" | "WORDS" | "CURSOR";

/**
 * Mirrors LayerRevealMaskSpec. `featherFraction` is the ONLY thing separating each GRADIENT_*
 * family member from its hard-edged twin — drop it and GRADIENT_WIPE renders as WIPE.
 *
 * A WIPE may name the `edge` its band is anchored to (Canva's Wipe grows from the edge the
 * motion starts at; Baseline reveals the part of the content inside the home box). Without it
 * the band starts at the LEFT edge. `anchored` (§8.3 item 2) pins that edge: a text renderer
 * mirrors LEFT/RIGHT for right-to-left text ONLY when the mask is not anchored — the legacy
 * typewriter/word/line reveals keep their RTL mirroring, Canva's Wipe, Baseline and Block don't.
 */
export type RevealMaskSpec =
  | { kind: "WIPE"; progress: number; featherFraction: number; edge?: RevealEdge; anchored?: boolean }
  | { kind: "CIRCLE"; progress: number; featherFraction: number }
  | { kind: "RADIAL"; progress: number; startAngleDegrees: number };

export interface TextRevealSpec {
  progress: number;
  mode: TextRevealMode;
  durationMs: number;
}

/**
 * Per-glyph motion for a text renderer. The Nayroz character effects (CH_*, ONE_WORD, ASCEND)
 * carry `type`/`progress`/`durationMs` only. Canva's writing styles (§8.4 — FADE, BLUR, SUCCESSION
 * and NEON with a `unit` param) add the rest: a renderer that honours them ignores the
 * whole-element alpha/blur/scale of the state and plays animationCanvaUnits' schedule per unit
 * at `rawProgress` (p on the way in, u on the way out).
 */
export interface GlyphMotionSpec {
  type: string;
  progress: number;
  durationMs: number;
  /** Canva writing style: 1 character, 2 word, 3 line. */
  unit?: number;
  /** Stretch the unit schedule to fill the slot (an explicit Canva duration). */
  fill?: boolean;
  /** Raw slot progress for the unit schedule: p entering, u exiting. */
  rawProgress?: number;
  isExiting?: boolean;
  intensity?: number;
  /** Canva's hash product for Neon's per-unit offsets. */
  seed?: number;
  /**
   * With a concurrent loop (§8.2): what the LAYER keeps once a text renderer takes alpha, blur and
   * scale over per unit — the loop's and stack's own contribution (the app's `rest*`).
   */
  restAlpha?: number;
  restScale?: number;
  restBlurPx?: number;
}

/**
 * Mirrors LayerOverlayBarSpec — BLOCK's painted bar (§8.3 item 3): the FULL layer box offset along
 * the motion axis, as fractions of the layer's width and height, clipped to the layer box by the
 * renderer. `colorArgb` is the importer's `barColor` (ARGB 0xAARRGGBB); absent = the layer's own
 * text colour, which only the renderer knows.
 */
export interface OverlayBarSpec {
  leftFraction: number;
  topFraction: number;
  widthFraction: number;
  heightFraction: number;
  colorArgb?: number;
}

/** Mirrors LayerAnimationVisualState, including its defaults. */
export interface AnimationVisualState {
  scaleMultiplier: number;
  scaleXMultiplier: number;
  scaleYMultiplier: number;
  rotationDeltaDegrees: number;
  translationX: number;
  translationY: number;
  alphaMultiplier: number;
  blurRadiusPx: number;
  revealMask: RevealMaskSpec | null;
  textReveal: TextRevealSpec | null;
  glyphMotion: GlyphMotionSpec | null;
  overlayBar: OverlayBarSpec | null;
}

export interface AnimationSpecInput {
  type: string;
  infinite: boolean;
  durationMs: number;
  delayMs: number;
  direction: AnimationDirection;
  easing: AnimationEasing;
  intensity: number;
  /**
   * The importer's exact Canva values (docs/canva-animation-parity.md §8.1), finite numbers only.
   * Absent on every picker-made spec; unknown keys are ignored.
   */
  params?: Record<string, number>;
}

/** A finite numeric param of [spec], or undefined. */
export function specParam(spec: AnimationSpecInput, key: string): number | undefined {
  const value = spec.params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const PI = Math.PI;

/**
 * The intensity range both runtimes accept (spec §3). It used to be 0.4..2.4; the importer now
 * stores a Drift/Tectonic amplitude as `intensity = m / 120`, which needs the wider band.
 */
export const MIN_ANIMATION_INTENSITY = 0.1;
export const MAX_ANIMATION_INTENSITY = 4.0;

/**
 * How far a one-shot RISE (and PAN) travels, in design px — Canva's `urf(dir, rot, 80)` vector.
 * Confirmed earlier off an MP4 they exported: a 162px title and a 56px caption both travelled
 * the same 80px, so the distance is FLAT, not a share of the layer.
 */
const CANVA_RISE_TRAVEL_PX = 80;

/** Canva's Blur resolves out of a 32px Gaussian radius (spec §2 BLUR). */
const CANVA_BLUR_RADIUS_PX = 32;

/** Canva's Succession resolves out of a 24px Gaussian radius while it scales up (spec §2). */
const CANVA_SUCCESSION_BLUR_PX = 24;

/**
 * Tumble travels in from one full page extent away. The runtime has no page, so it assumes the
 * standard story height (spec §2 TUMBLE) — the layer is nearly transparent for that stretch.
 */
const CANVA_TUMBLE_TRAVEL_PX = 1920;

/** Stomp starts at `max(4, pageW·1.5 / w)`; without a page the standard story width stands in. */
const CANVA_STOMP_PAGE_SCALE_PX = 1620;

/** Drift's and Tectonic's amplitude rides on intensity: amplitude_px = 120 · intensity (spec §3). */
const CANVA_CONTINUOUS_AMPLITUDE_PX = 120;

/** The number of stamps a Scrapbook plays before it rests (spec §2: g = 3 without a page). */
const CANVA_SCRAPBOOK_STAMPS = 3;

/** Scrapbook's stamp offset, design px (Canva's `htf`). */
const CANVA_SCRAPBOOK_OFFSET_PX = 50;

/** Flicker holds its dim level for a flat 200 ms in the middle of every cycle (spec §4). */
const CANVA_FLICKER_HOLD_MS = 200;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

export function identityVisualState(): AnimationVisualState {
  return {
    scaleMultiplier: 1,
    scaleXMultiplier: 1,
    scaleYMultiplier: 1,
    rotationDeltaDegrees: 0,
    translationX: 0,
    translationY: 0,
    alphaMultiplier: 1,
    blurRadiusPx: 0,
    revealMask: null,
    textReveal: null,
    glyphMotion: null,
    overlayBar: null,
  };
}

/** runtime.helpers.resolveAnimationVector */
export function resolveAnimationVector(direction: AnimationDirection): { x: number; y: number } {
  switch (direction) {
    case "LEFT":
      return { x: -1, y: 0 };
    case "RIGHT":
      return { x: 1, y: 0 };
    case "DOWN":
      return { x: 0, y: 1 };
    case "UP":
      return { x: 0, y: -1 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * runtime.helpers.rotationSpin — note this is NOT the vector: only COUNTERCLOCKWISE and LEFT
 * spin negative, everything else (including UP) spins positive.
 */
export function rotationSpin(direction: AnimationDirection): number {
  switch (direction) {
    case "COUNTERCLOCKWISE":
    case "LEFT":
      return -1;
    default:
      return 1;
  }
}

/** runtime.helpers.pingPongProgress — a raised cosine, not a triangle wave. */
export function pingPongProgress(progress: number): number {
  const clamped = clamp(progress, 0, 1);
  return clamp(0.5 - Math.cos(clamped * PI * 2) / 2, 0, 1);
}

/** runtime.helpers.applyLayerAnimationEasing */
export function applyAnimationEasing(progress: number, easing: AnimationEasing): number {
  const clamped = clamp(progress, 0, 1);
  switch (easing) {
    case "LINEAR":
    case "DEFAULT":
      return clamped;
    case "SOFT_OUT": {
      const inverse = 1 - clamped;
      return 1 - inverse * inverse * inverse * inverse;
    }
    case "EASE_OUT": {
      const inverse = 1 - clamped;
      return 1 - inverse * inverse * inverse;
    }
    case "EASE_IN":
      return clamped * clamped;
    case "EASE_IN_OUT": {
      if (clamped < 0.5) return 4 * clamped * clamped * clamped;
      const inverse = -2 * clamped + 2;
      return 1 - (inverse * inverse * inverse) / 2;
    }
    case "SOFT_IN_OUT":
      return 0.5 - Math.cos(PI * clamped) / 2;
    default:
      return clamped;
  }
}

/** Which matte each authored reveal family uses (verbatim from andalusiRevealMask). */
function authoredRevealMask(type: string, progress: number): RevealMaskSpec | null {
  switch (type) {
    // Rect stroke, trim-path — a linear wipe.
    case "GRADIENT_WIPE":
      return { kind: "WIPE", progress, featherFraction: 0.35 };
    // Ellipse stroke, trim-path — a clock sweep.
    case "RADIAL":
    case "RADIAL_GRADIENT":
      return { kind: "RADIAL", progress, startAngleDegrees: -90 };
    // Scaling ellipse matte — a growing circle.
    case "CIRCUAL":
      return { kind: "CIRCLE", progress, featherFraction: 0 };
    case "CIRCUAL_GRADIENT":
      return { kind: "CIRCLE", progress, featherFraction: 0.4 };
    default:
      return null;
  }
}

/**
 * The authored-curve path. Translations are authored as a fraction of a COMP_PX-wide comp,
 * so they scale to the real layer here.
 */
function evaluateAuthoredSpec(
  type: string,
  progress: number,
  width: number,
  height: number
): AnimationVisualState {
  const curves = getAuthoredCurves(type);
  if (!curves) return identityVisualState();
  const frame = clamp(progress, 0, 1) * curves.durationFrames;
  const channel = (name: keyof typeof curves.channels) => {
    const keyframes = curves.channels[name];
    return keyframes ? valueAtFrame(keyframes, frame) : null;
  };

  const maskProgress = channel("maskProgress");
  return {
    scaleMultiplier: channel("scale") ?? 1,
    scaleXMultiplier: channel("scaleX") ?? 1,
    scaleYMultiplier: channel("scaleY") ?? 1,
    rotationDeltaDegrees: channel("rotation") ?? 0,
    translationX: (channel("translateX") ?? 0) * width,
    translationY: (channel("translateY") ?? 0) * height,
    alphaMultiplier: clamp(channel("opacity") ?? 1, 0, 1),
    blurRadiusPx: 0,
    revealMask: maskProgress === null ? null : authoredRevealMask(type, clamp(maskProgress, 0, 1)),
    textReveal: null,
    glyphMotion: null,
    overlayBar: null,
  };
}

/**
 * The one channel the authored curves cannot carry: a real blur.
 *
 * The art describes transform, opacity and a matte — nothing else — so DISSOLVE comes out of
 * [evaluateAuthoredSpec] as a plain opacity fade, visually identical to FADE, when resolving out of
 * a haze is its whole identity. Mobile layers this blur back on top of the authored curves
 * (LayerAnimationVisualRuntime.withNayrozAnimationBlur), so the motion and timing still come from
 * the art and only the haze is added — this is the same formula, kept in step with it.
 */
function withAuthoredBlur(
  state: AnimationVisualState,
  type: string,
  progress: number,
  width: number,
  intensity: number
): AnimationVisualState {
  if (type !== "DISSOLVE") return state;
  const blurRadiusPx = Math.max(
    0,
    (1 - clamp(progress, 0, 1)) * Math.max(6, width * 0.03) * intensity
  );
  return { ...state, blurRadiusPx };
}

/** The typewriter family: the fade + Wipe mask are the fallback for surfaces without glyphs. */
function typewriterVisualState(
  progress: number,
  mode: TextRevealMode,
  durationMs: number
): AnimationVisualState {
  return {
    ...identityVisualState(),
    alphaMultiplier: clamp(0.12 + progress * 0.88, 0, 1),
    revealMask: { kind: "WIPE", progress, featherFraction: 0 },
    textReveal: { progress, mode, durationMs },
  };
}

// ── The Canva enter/exit family (spec §2) ───────────────────────────────────────────────────────

/**
 * The twelve presets Canva offers as enter / exit / both, plus SHIFT and SKATE — our mirrors of
 * RISE and PAN (the same tween, direction DOWN / LEFT), which stay exact mirrors this way. Their
 * one-shot path is Canva's own intro and outro tween; the exit is computed from
 * `u = 1 − cycleProgress` INSIDE the formula, so the generic "alpha × cycleProgress" exit fade
 * below must not be layered on top of it.
 */
const CANVA_ENTER_EXIT_FAMILY = new Set([
  "RISE",
  "SHIFT",
  "PAN",
  "SKATE",
  "FADE",
  "POP",
  "WIPE",
  "BLUR",
  "SUCCESSION",
  "BASELINE",
  "TUMBLE",
  "NEON",
  "SCRAPBOOK",
  "STOMP",
]);

/** Everything a Canva formula can ask about the layer it is animating. */
interface CanvaLayer {
  width: number;
  height: number;
  intensity: number;
  /** The slot's own direction, untouched (Tumble reads RIGHT / LEFT off it; anything else = auto). */
  direction: AnimationDirection;
  /**
   * Unit vector of the direction the element MOVES. An axis direction is taken as is; anything
   * else (DEFAULT, a spin) resolves to the type's own preset axis, as the app does — so a Rise
   * never sits motionless on a zero vector.
   */
  vector: { x: number; y: number };
  /** The slot's duration, ms — Scrapbook spaces its stamps and Flicker/Wiggle shape their cycle by it. */
  durationMs: number;
  /** Index of the layer in its page, 0 = bottom — Canva's element index (parity + hash seed). */
  layerIndex: number;
  /**
   * Canva's sequence index for Neon, Scrapbook and Tumble: the importer's `xh` param when present
   * (§8.1 — it replaces the layer index), else [layerIndex].
   */
  sequenceIndex: number;
  /** The spec, for its params. */
  spec: AnimationSpecInput;
}

/** What Canva's `p` / `u` and the two-way flag look like from inside one formula. */
interface CanvaPhase {
  /** Entrance progress 0→1 (only meaningful while `exiting` is false). */
  p: number;
  /** Exit progress 0→1 (only meaningful while `exiting` is true). */
  u: number;
  exiting: boolean;
}

/**
 * Canva's intensity slider (`Vd`, 0..1, default 0.5) — the importer stores it as
 * `intensity = 0.5 + Vd`, so our default 1 is their default 0.5.
 */
function canvaIntensitySlider(intensity: number) {
  return clamp(intensity - 0.5, 0, 1);
}

/** The slot's direction when it is an axis, else the type's own preset axis (the app's rule). */
function canvaAxisDirection(type: string, direction: AnimationDirection): AnimationDirection {
  switch (direction) {
    case "UP":
    case "DOWN":
    case "LEFT":
    case "RIGHT":
      return direction;
    default:
      return getAnimationDefaults(type).direction;
  }
}

/**
 * Canva's `urf(dir, rot, c)`: where the element STARTS, which is the opposite of where it moves —
 * dir up starts `c` px BELOW and rises. Our vector points the way the element moves, so negate.
 */
function canvaStartOffset(vector: { x: number; y: number }, distance: number) {
  return { x: -vector.x * distance, y: -vector.y * distance };
}

/** The edge of the layer the motion heads towards (TOP for UP …); RIGHT for a zero vector. */
function leadingEdge(vector: { x: number; y: number }): RevealEdge {
  if (vector.y < 0) return "TOP";
  if (vector.y > 0) return "BOTTOM";
  if (vector.x < 0) return "LEFT";
  return "RIGHT";
}

function oppositeEdge(edge: RevealEdge): RevealEdge {
  switch (edge) {
    case "TOP":
      return "BOTTOM";
    case "BOTTOM":
      return "TOP";
    case "LEFT":
      return "RIGHT";
    case "RIGHT":
      return "LEFT";
  }
}

/**
 * RISE and PAN (and their mirrors SHIFT and SKATE): the same 80 px slide-and-fade on quadratic
 * eases, on different axes. A flat 80 px whatever the layer's size or slider — Canva's Rise
 * never reads Vd.
 */
function canvaRiseState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const start = canvaStartOffset(layer.vector, CANVA_RISE_TRAVEL_PX);
  if (!phase.exiting) {
    const e = easeOutQuad(phase.p);
    state.alphaMultiplier = clamp(e, 0, 1);
    state.translationX = start.x * (1 - e);
    state.translationY = start.y * (1 - e);
    return state;
  }
  // Keeps moving the same way, out of the frame (a reversed exit arrives as the opposite direction).
  const e = easeInQuad(phase.u);
  state.alphaMultiplier = clamp(1 - e, 0, 1);
  state.translationX = -start.x * e;
  state.translationY = -start.y * e;
  return state;
}

/**
 * FADE: opacity alone, on quadratic eases — or LINEAR both ways when the importer sets
 * `fadeEase = 1` (§8.3 item 12: Canva's Tectonic fades and Drift on video pages).
 */
function canvaFadeState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const linear = specParam(layer.spec, "fadeEase") === 1;
  const alpha = phase.exiting
    ? 1 - (linear ? phase.u : easeInQuad(phase.u))
    : linear
      ? phase.p
      : easeOutQuad(phase.p);
  state.alphaMultiplier = clamp(alpha, 0, 1);
  return state;
}

/** POP: an elastic scale that overshoots to ~1.27 on the way in; no opacity, no rotation. */
function canvaPopState(phase: CanvaPhase): AnimationVisualState {
  const state = identityVisualState();
  state.scaleMultiplier = phase.exiting ? 1 - elasticIn(phase.u) : elasticOut(phase.p);
  return state;
}

/**
 * WIPE: a pure clip reveal — the content never moves. The band grows from the edge the motion
 * starts at over the WHOLE slot (§8.3 item 1: Canva caps only its default window, which the
 * importer computes, never an explicit duration), and on the way out keeps sweeping the same way,
 * so the part revealed first is the part that disappears first. The mask is anchored: right-to-left
 * text does not mirror it.
 */
function canvaWipeState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const leading = leadingEdge(layer.vector);
  if (!phase.exiting) {
    const e = easeOutCubic(phase.p);
    state.revealMask = {
      kind: "WIPE",
      progress: clamp(e, 0, 1),
      featherFraction: 0,
      edge: oppositeEdge(leading),
      anchored: true,
    };
    return state;
  }
  const e = easeInCubic(phase.u);
  state.revealMask = {
    kind: "WIPE",
    progress: clamp(1 - e, 0, 1),
    featherFraction: 0,
    edge: leading,
    anchored: true,
  };
  // Opacity drops to 0 only at the very end; the empty band has hidden the layer by then anyway.
  state.alphaMultiplier = phase.u >= 1 ? 0 : 1;
  return state;
}

/** BLUR: a 32 px Gaussian haze resolving while the opacity rises. */
function canvaBlurState(phase: CanvaPhase): AnimationVisualState {
  const state = identityVisualState();
  if (!phase.exiting) {
    const e = easeOutQuad(phase.p);
    state.alphaMultiplier = clamp(e, 0, 1);
    state.blurRadiusPx = Math.max(0, CANVA_BLUR_RADIUS_PX * (1 - e));
    return state;
  }
  const e = easeInQuad(phase.u);
  state.alphaMultiplier = clamp(1 - e, 0, 1);
  state.blurRadiusPx = Math.max(0, CANVA_BLUR_RADIUS_PX * e);
  return state;
}

/** SUCCESSION: Blur plus a scale from `s0 = 0.9 − 0.3·Vd` (0.75 at the default slider). */
function canvaSuccessionState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const s0 = 0.9 - 0.3 * canvaIntensitySlider(layer.intensity);
  if (!phase.exiting) {
    const e = easeOutQuad(phase.p);
    state.alphaMultiplier = clamp(e, 0, 1);
    state.blurRadiusPx = Math.max(0, CANVA_SUCCESSION_BLUR_PX * (1 - e));
    state.scaleMultiplier = s0 + (1 - s0) * e;
    return state;
  }
  const e = easeInQuad(phase.u);
  state.alphaMultiplier = clamp(1 - e, 0, 1);
  state.blurRadiusPx = Math.max(0, CANVA_SUCCESSION_BLUR_PX * e);
  state.scaleMultiplier = 1 - (1 - s0) * e;
  return state;
}

/**
 * BASELINE: the content slides into its own box while the box clips it. The reveal band is
 * expressed in CONTENT space because our matte travels with the layer's pose: on the way in the
 * part of the content that has crossed into the home box is the band behind the LEADING edge,
 * on the way out it is the band behind the TRAILING edge. Only the first 60 % of the outro moves.
 */
function canvaBaselineState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const vertical = layer.vector.y !== 0;
  const size = vertical ? layer.height : layer.width;
  const start = canvaStartOffset(layer.vector, size);
  const leading = leadingEdge(layer.vector);
  if (!phase.exiting) {
    const e = easeOutExpo(phase.p);
    state.translationX = start.x * (1 - e);
    state.translationY = start.y * (1 - e);
    state.revealMask = {
      kind: "WIPE",
      progress: clamp(e, 0, 1),
      featherFraction: 0,
      edge: leading,
      anchored: true,
    };
    return state;
  }
  // Past 60 % the content is fully out of its box and held invisible (easeInSine(1) is a hair
  // under 1 in floating point, so the hold is decided on u, not on e).
  const held = phase.u >= 0.6;
  const e = held ? 1 : easeInSine(phase.u / 0.6);
  state.translationX = -start.x * e;
  state.translationY = -start.y * e;
  state.revealMask = {
    kind: "WIPE",
    progress: clamp(1 - e, 0, 1),
    featherFraction: 0,
    edge: oppositeEdge(leading),
    anchored: true,
  };
  state.alphaMultiplier = held ? 0 : 1;
  return state;
}

/**
 * TUMBLE: spins in from a full page away. With the importer's `startRotation`/`travelX`/`travelY`
 * (§8.3 item 8 — Canva's own start pose on the way in, its own end pose on the way out) those are
 * animated exactly; without them the start angle is about −180° plus a per-element hash, and the
 * side it comes from is the slot's direction (auto = the sequence index's parity).
 */
function canvaTumbleState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const startRotation = specParam(layer.spec, "startRotation");
  const travelXParam = specParam(layer.spec, "travelX");
  const travelYParam = specParam(layer.spec, "travelY");
  if (startRotation !== undefined || travelXParam !== undefined || travelYParam !== undefined) {
    const rotation = startRotation ?? 0;
    const tx = travelXParam ?? 0;
    const ty = travelYParam ?? 0;
    if (!phase.exiting) {
      const e = easeOutCubic(phase.p);
      state.alphaMultiplier = clamp(e, 0, 1);
      state.rotationDeltaDegrees = rotation * (1 - e);
      state.translationX = tx * (1 - e);
      state.translationY = ty * (1 - e);
      return state;
    }
    const e = easeInCubic(phase.u);
    state.alphaMultiplier = clamp(1 - e, 0, 1);
    state.rotationDeltaDegrees = rotation * e;
    state.translationX = tx * e;
    state.translationY = ty * e;
    return state;
  }
  const vd = canvaIntensitySlider(layer.intensity);
  const index = layer.sequenceIndex;
  const even = index % 2 === 0;
  const hash = Math.abs(Math.cos(index) * layer.width * layer.height) % 360;
  const k = (even ? lerp(-90, -270, vd) : lerp(-270, -90, vd)) + hash;
  const fromLeft =
    layer.direction === "RIGHT" ? true : layer.direction === "LEFT" ? false : even;
  const travelX = fromLeft ? -CANVA_TUMBLE_TRAVEL_PX : CANVA_TUMBLE_TRAVEL_PX;
  if (!phase.exiting) {
    const e = easeOutCubic(phase.p);
    state.alphaMultiplier = clamp(e, 0, 1);
    state.rotationDeltaDegrees = k * (1 - e);
    state.translationX = travelX * (1 - e);
    return state;
  }
  const e = easeInCubic(phase.u);
  state.alphaMultiplier = clamp(1 - e, 0, 1);
  state.rotationDeltaDegrees = -k * e;
  state.translationX = -travelX * e;
  return state;
}

/** STOMP: slams down from several times its size, fading in over the first 40 %. */
function canvaStompState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  if (!phase.exiting) {
    // Canva's own s0 = max(pageW / w · 1.5, 4) when the importer stored it (§8.3 item 9).
    const s0 =
      specParam(layer.spec, "startScale") ?? Math.max(4, CANVA_STOMP_PAGE_SCALE_PX / layer.width);
    state.scaleMultiplier = s0 + (1 - s0) * easeInQuart(phase.p);
    state.alphaMultiplier = clamp(easeInQuart(Math.min(1, phase.p / 0.4)), 0, 1);
    return state;
  }
  state.alphaMultiplier = clamp(1 - easeOutQuad(phase.u), 0, 1);
  return state;
}

/** Even/odd of a Canva index, negative-safe (Kotlin's `mod`). */
function isEvenIndex(index: number) {
  return ((index % 2) + 2) % 2 === 0;
}

/**
 * SCRAPBOOK (`jtf`, §8.3 item 10): discrete stamps. The layer is opaque from the first frame and
 * holds `g` poses (the importer's `poses`, else 3), then rests; nothing tweens. Pose c is
 * `(b.x/2^c + (c even ? 50 : 0), b.y/2^c + (c even ? 0 : 50))` tilted `(5+c)(1−.25c)` degrees,
 * alternating, with b = (`poseX`, `poseY`) and the tilt's sign from the sequence index's parity;
 * c = g is the rest pose. With h = floor(D/g), pose c shows from max(0, floor(h·c) − 1) ms and the
 * pose at τ = p·D is the last one that has started.
 */
function canvaScrapbookState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  if (phase.exiting) {
    // Opacity jumps to 0 at outro start (the very first frame still shows the start value).
    state.alphaMultiplier = phase.u > 0 ? 0 : 1;
    return state;
  }
  const g = Math.max(1, Math.floor(specParam(layer.spec, "poses") ?? CANVA_SCRAPBOOK_STAMPS));
  const bx = specParam(layer.spec, "poseX") ?? 0;
  const by = specParam(layer.spec, "poseY") ?? 0;
  const sign = isEvenIndex(layer.sequenceIndex) ? 1 : -1;
  const durationMs = Math.max(1, layer.durationMs);
  const h = Math.floor(durationMs / g);
  const t = clamp(phase.p, 0, 1) * durationMs;
  // Canva's `Xpf` pick: the latest start ≤ τ; among poses sharing a start (only when D < 2g) the
  // first one.
  let pose = 0;
  let poseStart = Number.NEGATIVE_INFINITY;
  for (let c = 0; c <= g; c += 1) {
    const start = Math.max(0, Math.floor(h * c) - 1);
    if (start <= t && start > poseStart) {
      pose = c;
      poseStart = start;
    }
  }
  if (pose >= g) return state;
  const even = pose % 2 === 0;
  const scale = Math.pow(2, pose);
  state.translationX = bx / scale + (even ? CANVA_SCRAPBOOK_OFFSET_PX : 0);
  state.translationY = by / scale + (even ? 0 : CANVA_SCRAPBOOK_OFFSET_PX);
  state.rotationDeltaDegrees = (5 + pose) * (1 - pose * 0.25) * (even ? 1 : -1) * sign;
  return state;
}

/** One of Canva's linear opacity tweens, in the caller's time unit. */
interface LinearTween {
  delay: number;
  duration: number;
  from: number;
  to: number;
}

/**
 * Canva's tween-list rule (spec §2): the LAST tween (by delay) whose delay ≤ t decides — before
 * its end it eases from its start, after it its end value HOLDS, and before the very first tween
 * that tween's start value shows.
 */
function evaluateTweenList(tweens: LinearTween[], t: number): number {
  const sorted = [...tweens].sort((a, b) => a.delay - b.delay);
  let active: LinearTween | null = null;
  for (const tween of sorted) {
    if (tween.delay <= t) active = tween;
  }
  if (!active) return sorted[0]?.from ?? 1;
  if (t >= active.delay + active.duration) return active.to;
  return active.from + (active.to - active.from) * ((t - active.delay) / active.duration);
}

/** The Neon intro's tween list, in units of `c` (spec §2 NEON). */
function neonIntroTweens(flashes: number, parityEven: boolean): LinearTween[] {
  const tweens: LinearTween[] = [];
  let f = 0;
  for (let i = 0; i < flashes; i += 1) {
    if (i % 2 === 0) {
      tweens.push({ delay: f, duration: 3, from: 0, to: 1 });
      tweens.push({ delay: f + 4, duration: 1, from: parityEven ? 1 : 0, to: 0 });
      f += 5;
    } else {
      const hold = parityEven ? 1 : 0.75;
      tweens.push({ delay: f + 1, duration: 1, from: hold, to: hold });
      tweens.push({ delay: f + 3, duration: 1, from: 0, to: 0 });
      f += 4;
    }
  }
  if (parityEven) tweens.push({ delay: f + 4, duration: 3, from: 0, to: 1 });
  else tweens.push({ delay: f + 5, duration: 4, from: 0, to: 1 });
  return tweens;
}

/** The Neon outro, in units of `d` (spec §2 NEON). */
function neonOutroOpacity(t: number, parityEven: boolean): number {
  if (parityEven) {
    if (t < 1.1) return 1;
    if (t < 3) return 0;
    if (t < 5) return 0.5;
    return 0;
  }
  if (t < 1) return 1;
  if (t <= 3) return 1 - 0.5 * ((t - 1) / 2);
  if (t < 4) return 0.5;
  if (t < 4.1) return 0.5 - 0.5 * ((t - 4) / 0.1);
  return 0;
}

/**
 * NEON: a sign flickering on — every tween is LINEAR on opacity and the hold rule applies. The
 * intro is `lerp(10, 26, Vd)` units of `c` long with `floor(lerp(1, 4, Vd))` flashes; the outro
 * is `lerp(4, 8, Vd)` units of `d` — each stretched to its schedule's own end when that is
 * longer. Parity comes from the sequence index — the importer's `xh`, else the layer index — on
 * both platforms (§8.3 item 11).
 */
function canvaNeonState(phase: CanvaPhase, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const vd = canvaIntensitySlider(layer.intensity);
  const parityEven = isEvenIndex(layer.sequenceIndex);
  if (!phase.exiting) {
    // Off the default slider the list can end past the intro (it does at the slider's low end),
    // so the whole list is fitted to the intro: the layer is always fully lit at p = 1.
    const units = lerp(10, 26, vd);
    const tweens = neonIntroTweens(Math.floor(lerp(1, 4, vd)), parityEven);
    const span = Math.max(units, ...tweens.map((tween) => tween.delay + tween.duration));
    state.alphaMultiplier = clamp(evaluateTweenList(tweens, phase.p * span), 0, 1);
    return state;
  }
  // The outro schedule is fitted the same way (it runs 5d even / 4.1d odd), so u = 1 is always off.
  const span = Math.max(lerp(4, 8, vd), parityEven ? 5 : 4.1);
  state.alphaMultiplier = clamp(neonOutroOpacity(phase.u * span, parityEven), 0, 1);
  return state;
}

// ── The repeating effects (spec §4) ─────────────────────────────────────────────────────────────

/**
 * Canva's repeating-effect slider `t = (Vd + 1) / 2`, carried on the spec as `intensity = 0.5 + t`
 * (§8.3 item 5); the picker's intensity 1 is Canva's default t = 0.5.
 */
function canvaRepeatingSlider(intensity: number) {
  return clamp(intensity - 0.5, 0, 1);
}

/**
 * FLICKER (`owf`, §8.3 item 5) at [ms] into a [cycleMs] cycle: opacity 1 → b LINEAR over [0, a],
 * hold b over [a, a + 200], b → 1 LINEAR over [a + 200, 2a + 200], with `b = lerp(.6, .1, t)` from
 * the slider and `a = max(0, (cycle − 200) / 2)` from the cycle. A tween that has ended holds its
 * end value, so a cycle of 200 ms or less is a plain dim-then-restore.
 */
export function canvaFlickerOpacity(ms: number, cycleMs: number, t: number): number {
  const b = lerp(0.6, 0.1, clamp(t, 0, 1));
  const a = Math.max(0, (cycleMs - CANVA_FLICKER_HOLD_MS) / 2);
  const back = a + CANVA_FLICKER_HOLD_MS;
  if (ms >= back) {
    const local = ms - back;
    return local >= a ? 1 : lerp(b, 1, local / a);
  }
  return ms >= a ? b : lerp(1, b, ms / a);
}

function canvaFlickerState(cycleProgress: number, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const cycle = Math.max(1, layer.durationMs);
  const alpha = canvaFlickerOpacity(
    clamp(cycleProgress, 0, 1) * cycle,
    cycle,
    canvaRepeatingSlider(layer.intensity)
  );
  state.alphaMultiplier = clamp(alpha, 0, 1);
  return state;
}

/**
 * PULSE: scale 1 → 1.15 over a quarter of `a` (LINEAR), 1.15 → 0.85 over `a` (easeOutQuad),
 * 0.85 → 1 over another quarter (LINEAR). The cycle is 1.5a, so the shape is fixed in sixths.
 */
function canvaPulseState(cycleProgress: number): AnimationVisualState {
  const state = identityVisualState();
  const sixth = 1 / 6;
  let scale: number;
  if (cycleProgress < sixth) scale = lerp(1, 1.15, cycleProgress / sixth);
  else if (cycleProgress < 5 * sixth) {
    scale = lerp(1.15, 0.85, easeOutQuad((cycleProgress - sixth) / (4 * sixth)));
  } else scale = lerp(0.85, 1, (cycleProgress - 5 * sixth) / sixth);
  state.scaleMultiplier = scale;
  return state;
}

export interface CanvaWigglePose {
  translationX: number;
  translationY: number;
  rotationDegrees: number;
}

/**
 * WIGGLE (`rwf`, §8.3 item 7) at [ms] into a [cycleMs] cycle, slider [t]: `n = floor(lerp(10, 100,
 * t))` steps of `g = cycle / (n + 1)`, amplitude `lerp(.5, 1.8, t)`. Step l eases (easeInOutQuad)
 * the offset from the previous target to `(lerp(−20, 20, r(l+2)), lerp(−20, 20, r(l+3))) · amp`
 * over [g·l, g·(l+1)]; the tilt tweens to `lerp(−10, 15, r(l+1)) · amp` half a step late, and only
 * for l < n − 1 — so the last step keeps the previous tilt; then one closing tween returns all
 * three to rest over [g·n, g·(n+1)]. Between tweens the previous end value holds (Canva's list
 * rule), before the first tilt tween the tilt is 0.
 */
export function canvaWigglePose(
  ms: number,
  cycleMs: number,
  t: number,
  random: (s: number) => number
): CanvaWigglePose {
  const slider = clamp(t, 0, 1);
  const n = Math.floor(lerp(10, 100, slider));
  const amp = lerp(0.5, 1.8, slider);
  const g = Math.max(1e-9, cycleMs) / (n + 1);
  const targetX = (l: number) => (l < 0 ? 0 : lerp(-20, 20, random(l + 2)) * amp);
  const targetY = (l: number) => (l < 0 ? 0 : lerp(-20, 20, random(l + 3)) * amp);
  const targetRot = (l: number) => (l < 0 ? 0 : lerp(-10, 15, random(l + 1)) * amp);
  const lastTilt = n - 2;

  // The closing tween owns every channel from g·n on.
  if (ms >= g * n) {
    const local = ms - g * n;
    const e = local >= g ? 1 : easeInOutQuad(local / g);
    return {
      translationX: lerp(targetX(n - 1), 0, e),
      translationY: lerp(targetY(n - 1), 0, e),
      rotationDegrees: lerp(targetRot(lastTilt), 0, e),
    };
  }

  const step = Math.max(0, Math.floor(ms / g));
  const moveLocal = ms - g * step;
  const moveEase = moveLocal >= g ? 1 : easeInOutQuad(moveLocal / g);
  let rotationDegrees = 0;
  if (lastTilt >= 0 && ms >= g / 2) {
    const tilt = Math.min(lastTilt, Math.floor((ms - g / 2) / g));
    const local = ms - (g / 2 + g * tilt);
    rotationDegrees =
      local >= g
        ? targetRot(tilt)
        : lerp(targetRot(tilt - 1), targetRot(tilt), easeInOutQuad(local / g));
  }
  return {
    translationX: lerp(targetX(step - 1), targetX(step), moveEase),
    translationY: lerp(targetY(step - 1), targetY(step), moveEase),
    rotationDegrees,
  };
}

/**
 * The random a wiggle walks by: Canva's seeded `rqf` when the importer stored the element's hash
 * product as `seed`, else the layer-size hash both platforms have always used.
 */
function canvaWiggleRandom(seed: number | undefined, width: number, height: number) {
  if (seed !== undefined) return (s: number) => canvaSeededRandom(s, seed);
  return (s: number) => Math.abs(Math.cos(s) * width * height) % 1;
}

function canvaWiggleState(cycleProgress: number, layer: CanvaLayer): AnimationVisualState {
  const state = identityVisualState();
  const cycle = Math.max(1, layer.durationMs);
  const pose = canvaWigglePose(
    clamp(cycleProgress, 0, 1) * cycle,
    cycle,
    canvaRepeatingSlider(layer.intensity),
    canvaWiggleRandom(specParam(layer.spec, "seed"), layer.width, layer.height)
  );
  state.translationX = pose.translationX;
  state.translationY = pose.translationY;
  state.rotationDeltaDegrees = pose.rotationDegrees;
  return state;
}

/** The low 32 bits of an ARGB number, unsigned — the app's `toLong() and 0xFFFFFFFF`. */
function unsignedArgb(value: number): number {
  const word = 0x100000000;
  return ((Math.trunc(value) % word) + word) % word;
}

/**
 * BLOCK (`esf`, §8.3 item 3): a solid bar — the FULL layer box — sweeps across along the motion
 * axis in `2d`: in from the far side on easeInQuart until it covers the box, out on easeOutQuart.
 * With x the raw progress (p entering, u exiting — a loop plays the entrance every cycle), the bar
 * sits at `s = x < .5 ? −1 + easeInQuart(2x) : easeOutQuart(2x − 1)` box-lengths: RIGHT (s, 0),
 * LEFT (−s, 0), DOWN (0, s), UP (0, −s), visible while x < 1. The text switches ON behind it at
 * x = .5 on the way in and OFF at x = .5 on the way out — through an anchored Wipe at 0 or 1, so
 * the bar itself is never masked; the opacity stays 1 and no exit fade applies.
 */
function canvaBlockState(
  cycleProgress: number,
  exiting: boolean,
  layer: CanvaLayer
): AnimationVisualState {
  const state = identityVisualState();
  const x = clamp(exiting ? 1 - cycleProgress : cycleProgress, 0, 1);
  const shown = exiting ? x < 0.5 : x >= 0.5;
  state.revealMask = {
    kind: "WIPE",
    progress: shown ? 1 : 0,
    featherFraction: 0,
    edge: "LEFT",
    anchored: true,
  };
  if (x < 1) {
    const s = x < 0.5 ? -1 + easeInQuart(2 * x) : easeOutQuart(2 * x - 1);
    const axis = canvaAxisDirection("BLOCK", layer.direction);
    const color = specParam(layer.spec, "barColor");
    state.overlayBar = {
      leftFraction: axis === "RIGHT" ? s : axis === "LEFT" ? -s : 0,
      topFraction: axis === "DOWN" ? s : axis === "UP" ? -s : 0,
      widthFraction: 1,
      heightFraction: 1,
      ...(color !== undefined ? { colorArgb: unsignedArgb(color) } : {}),
    };
  }
  return state;
}

/**
 * Resolves [spec] at [cycleProgress] (the raw 0..1 from the slot) for a layer of
 * [width]x[height] design px. [isExiting] marks the exit slot, whose progress runs 1 → 0.
 * [layerIndex] is the layer's index in its page (0 = bottom): Canva's Tumble, Scrapbook and Neon
 * differ by element parity and a size hash, and both platforms read the same index for it.
 */
export function resolveAnimationVisualState(
  spec: AnimationSpecInput,
  cycleProgressInput: number,
  widthInput: number,
  heightInput: number,
  isExiting = false,
  layerIndex = 0
): AnimationVisualState {
  const type = spec.type;
  const intensity = clamp(
    Number.isFinite(spec.intensity) ? spec.intensity : 1,
    MIN_ANIMATION_INTENSITY,
    MAX_ANIMATION_INTENSITY
  );
  const width = Math.max(1, widthInput);
  const height = Math.max(1, heightInput);
  // A DEFAULT direction means "the type's own default", exactly as the app resolves it — a
  // zero vector would leave Drift, Wipe or Baseline motionless.
  const direction: AnimationDirection =
    spec.direction === "DEFAULT" ? getAnimationDefaults(type).direction : spec.direction;
  const vector = resolveAnimationVector(direction);
  const cycleProgress = clamp(cycleProgressInput, 0, 1);
  const oneShotProgress = applyAnimationEasing(cycleProgress, spec.easing);
  const cycleWave = applyAnimationEasing(pingPongProgress(cycleProgress), spec.easing);
  const progress = spec.infinite ? cycleWave : oneShotProgress;
  const wave = Math.sin(cycleProgress * 2 * PI);
  const pingPong = pingPongProgress(cycleProgress);
  const driftX = Math.max(14, width * 0.18);
  const driftY = Math.max(8, height * 0.12);

  const safeLayerIndex = Math.max(0, Math.floor(Number.isFinite(layerIndex) ? layerIndex : 0));
  const xh = specParam(spec, "xh");
  const layer: CanvaLayer = {
    width,
    height,
    intensity,
    direction: spec.direction,
    vector: resolveAnimationVector(canvaAxisDirection(type, spec.direction)),
    durationMs: spec.durationMs,
    layerIndex: safeLayerIndex,
    sequenceIndex: xh !== undefined ? Math.floor(xh) : safeLayerIndex,
    spec,
  };
  // The exit slot hands the runtime a REVERSED progress (1 → 0): Canva's outro runs on u = 1 − it.
  const phase: CanvaPhase = { p: cycleProgress, u: 1 - cycleProgress, exiting: isExiting };
  // The Canva family plays its own intro/outro when one-shot; a loop keeps the older formula.
  const canvaOneShot = !spec.infinite && CANVA_ENTER_EXIT_FAMILY.has(type);
  // The continuous three ramp A → B LINEARLY: over the whole cycle when one-shot, and there and
  // back (a triangle, not the raised cosine) when looping so a picked loop cycles seamlessly.
  const ramp = spec.infinite
    ? cycleProgress < 0.5
      ? cycleProgress * 2
      : (1 - cycleProgress) * 2
    : cycleProgress;

  // The authored art carries its own per-keyframe béziers and is read at RAW cycleProgress.
  const base: AnimationVisualState = getAuthoredCurves(type)
    ? withAuthoredBlur(
        evaluateAuthoredSpec(type, cycleProgress, width, height),
        type,
        cycleProgress,
        width,
        intensity
      )
    : resolveFormulaState();

  function resolveFormulaState(): AnimationVisualState {
    const state = identityVisualState();
    switch (type) {
      case "NONE":
      case "STATIC":
        return state;
      // RISE settles upward, SHIFT downward — the same reveal mirrored, which is what the
      // direction vector expresses. The `|| fallback` matters: a DEFAULT direction gives a ZERO
      // vector, and multiplying by it would leave the effect motionless. RISE historically
      // ignored direction and always rose, so UP is its fallback and its rendering is unchanged.
      case "RISE":
      case "SHIFT": {
        // A one-shot RISE is Canva's ارتقاء: 80 px of travel while the opacity runs 0 -> 1, both
        // on a quadratic ease-out (spec §2); a one-shot SHIFT is the same tween heading DOWN. An
        // infinite RISE or SHIFT keeps the older bob.
        if (canvaOneShot) return canvaRiseState(phase, layer);
        const riseY = vector.y !== 0 ? vector.y : type === "SHIFT" ? 1 : -1;
        state.translationY = -riseY * (1 - progress) * Math.max(16, height * 0.22) * intensity;
        state.alphaMultiplier = clamp(0.12 + progress * 0.88, 0, 1);
        return state;
      }
      case "PAN":
      case "SKATE": {
        // A one-shot PAN is Canva's تأرجح: Rise on the horizontal axis (spec §2); a one-shot SKATE
        // is the same tween heading LEFT. An infinite PAN or SKATE keeps the older slide.
        if (canvaOneShot) return canvaRiseState(phase, layer);
        const panX = vector.x !== 0 ? vector.x : type === "SKATE" ? -1 : 1;
        state.translationX = panX * (1 - progress) * Math.max(22, width * 0.28) * intensity;
        state.alphaMultiplier = clamp(0.16 + progress * 0.84, 0, 1);
        return state;
      }
      case "FADE":
        // A one-shot FADE is Canva's تلاشي (spec §2); a loop keeps the app's older ramp.
        if (canvaOneShot) return withCanvaUnits(canvaFadeState(phase, layer));
        state.alphaMultiplier = clamp(0.04 + progress * 0.96, 0, 1);
        return state;
      case "POP":
        // A one-shot POP is Canva's انبثاق, an elastic overshoot (spec §2); a loop keeps the
        // app's older scale-and-fade.
        if (canvaOneShot) return canvaPopState(phase);
        state.scaleMultiplier = 0.7 + progress * 0.3;
        state.alphaMultiplier = clamp(0.12 + progress * 0.88, 0, 1);
        return state;
      case "WIPE": {
        // A one-shot WIPE is Canva's المسح, a pure clip reveal (spec §2); a loop keeps the
        // app's older scale-plus-matte formula.
        if (canvaOneShot) return canvaWipeState(phase, layer);
        if (Math.abs(vector.x) > 0) {
          state.scaleXMultiplier = Math.max(0.001, progress);
          state.translationX = vector.x < 0 ? width * (1 - progress) : 0;
        } else {
          state.scaleYMultiplier = Math.max(0.001, progress);
          state.translationY = vector.y < 0 ? height * (1 - progress) : 0;
        }
        state.revealMask = { kind: "WIPE", progress, featherFraction: 0 };
        return state;
      }
      case "BLUR":
        // A one-shot BLUR is Canva's تمويه (spec §2); a loop keeps the older soften.
        if (canvaOneShot) return withCanvaUnits(canvaBlurState(phase));
        state.alphaMultiplier = clamp(0.05 + progress * 0.95, 0, 1);
        state.scaleXMultiplier = 0.92 + progress * 0.08;
        state.scaleYMultiplier = 0.92 + progress * 0.08;
        return state;
      case "SUCCESSION": {
        // A one-shot SUCCESSION is Canva's التتابع (spec §2); a loop keeps the older
        // scale-and-fade pulse, which is what a loop of it should be.
        if (canvaOneShot) return withCanvaUnits(canvaSuccessionState(phase, layer));
        state.scaleMultiplier = 0.82 + progress * 0.18;
        state.alphaMultiplier = clamp(0.06 + progress * 0.94, 0, 1);
        return state;
      }
      // The continuous three (spec §3): Canva runs them for the element's whole window with the
      // fades on the intro/outro windows, which our importer maps to FADE entrance/exit slots.
      // The loop formula is the ping-pong of Canva's untimed ramp, LINEAR, ignoring spec.easing;
      // the importer sets durationMs = 2 × the window so exactly the A → B half plays.
      case "BREATHE": {
        // Canva's scale slider becomes an A/B pair around 1: 0.90 → 1.03 at the default.
        const from = 1 - 0.1 * intensity;
        const to = 1 + 0.03 * intensity;
        state.scaleMultiplier = lerp(from, to, ramp);
        return state;
      }
      case "DRIFT": {
        // −vec → +vec across the ramp (Canva's untimed Drift ends at +vec, NOT at home).
        const amplitude = CANVA_CONTINUOUS_AMPLITUDE_PX * intensity;
        state.translationX = vector.x * amplitude * (2 * ramp - 1);
        state.translationY = vector.y * amplitude * (2 * ramp - 1);
        return state;
      }
      case "TECTONIC": {
        // −d → +d/2 across the ramp; the sign flips for a LEFT direction (Canva alternates by
        // page position, which the runtime cannot see).
        const amplitude = CANVA_CONTINUOUS_AMPLITUDE_PX * intensity * (vector.x < 0 ? -1 : 1);
        state.translationX = lerp(-amplitude, amplitude / 2, ramp);
        return state;
      }
      case "BASELINE": {
        // A one-shot BASELINE is Canva's rise-from-the-baseline with the box clipping the
        // content (spec §2); a loop keeps the older bounce.
        if (canvaOneShot) return canvaBaselineState(phase, layer);
        const bounceWave = Math.abs(Math.sin(cycleProgress * PI * 2));
        state.translationY = -bounceWave * Math.max(10, height * 0.1) * intensity;
        state.scaleYMultiplier = 1 - bounceWave * 0.06 * intensity;
        state.scaleXMultiplier = 1 + bounceWave * 0.04 * intensity;
        return state;
      }
      case "TUMBLE":
        // A one-shot TUMBLE is Canva's دوران (spec §2); a loop keeps the older sway.
        if (canvaOneShot) return canvaTumbleState(phase, layer);
        state.rotationDeltaDegrees = (1 - progress) * 26 * rotationSpin(spec.direction) * intensity;
        state.translationX =
          rotationSpin(spec.direction) * (1 - progress) * Math.max(18, width * 0.18) * intensity;
        state.translationY = -(1 - progress) * Math.max(18, height * 0.22) * intensity;
        state.alphaMultiplier = clamp(0.08 + progress * 0.92, 0, 1);
        return state;
      case "NEON":
        // A one-shot NEON is Canva's sign flickering on (spec §2); a loop keeps the older glow.
        if (canvaOneShot) return withCanvaUnits(canvaNeonState(phase, layer));
        state.scaleMultiplier = 1 + pingPong * 0.05 * intensity;
        state.alphaMultiplier = clamp(
          0.8 + pingPong * 0.2 + Math.sin(cycleProgress * PI * 6) * 0.04,
          0.72,
          1
        );
        return state;
      case "SCRAPBOOK":
        // A one-shot SCRAPBOOK is Canva's stamped poses (spec §2); a loop keeps the older sway.
        if (canvaOneShot) return canvaScrapbookState(phase, layer);
        state.rotationDeltaDegrees = wave * 6.5 * intensity;
        state.translationX = wave * Math.max(5, width * 0.024) * intensity;
        state.translationY =
          Math.cos(cycleProgress * PI * 2) * Math.max(3, height * 0.018) * intensity;
        return state;
      case "STOMP":
        // A one-shot STOMP is Canva's سقوط هوائي (spec §2); a loop keeps the older stamp.
        if (canvaOneShot) return canvaStompState(phase, layer);
        state.scaleMultiplier = 0.78 + progress * 0.22;
        state.rotationDeltaDegrees = (1 - progress) * 18 * rotationSpin(spec.direction) * intensity;
        state.alphaMultiplier = clamp(0.1 + progress * 0.9, 0, 1);
        return state;
      // The repeating effects (spec §4): Canva's loops, shaped by the cycle length alone.
      case "ROTATE":
        state.rotationDeltaDegrees = cycleProgress * 360 * rotationSpin(spec.direction) * intensity;
        return state;
      case "FLICKER":
        return canvaFlickerState(cycleProgress, layer);
      case "PULSE":
        return canvaPulseState(cycleProgress);
      case "WIGGLE":
        return canvaWiggleState(cycleProgress, layer);
      case "DROP":
        state.translationY = -(1 - progress) * Math.max(34, height * 0.5) * intensity;
        state.alphaMultiplier = clamp(progress * 2, 0, 1);
        return state;
      case "DIAGONAL":
        state.translationX = (1 - progress) * Math.max(18, width * 0.3) * intensity;
        state.translationY = -(1 - progress) * Math.max(18, height * 0.3) * intensity;
        state.alphaMultiplier = clamp(0.08 + progress * 0.92, 0, 1);
        state.revealMask = { kind: "RADIAL", progress, startAngleDegrees: -135 };
        return state;
      case "DIAGONAL_GRADIENT":
        state.translationX = (1 - progress) * Math.max(18, width * 0.3) * intensity;
        state.translationY = -(1 - progress) * Math.max(18, height * 0.3) * intensity;
        state.alphaMultiplier = clamp(0.05 + progress * 0.95, 0, 1);
        state.revealMask = { kind: "RADIAL", progress, startAngleDegrees: -135 };
        return state;
      case "RANDOM": {
        // Incommensurate sinusoids — deliberately never repeats within a cycle.
        const rx =
          Math.sin(cycleProgress * PI * 6.6) + 0.5 * Math.sin(cycleProgress * PI * 15.4);
        const ry =
          Math.cos(cycleProgress * PI * 8.2) + 0.5 * Math.sin(cycleProgress * PI * 18.6);
        state.translationX = rx * Math.max(4, width * 0.02) * intensity;
        state.translationY = ry * Math.max(4, height * 0.02) * intensity;
        state.rotationDeltaDegrees = rx * 3 * intensity;
        return state;
      }
      case "ONE_WORD":
        state.revealMask = { kind: "WIPE", progress, featherFraction: 0 };
        state.glyphMotion = { type, progress, durationMs: spec.durationMs };
        return state;
      case "CH_POSITION_FADE":
      case "CH_SCALE_FADE":
      // ASCEND rides the same path: the glyph motion is the effect on text, and the Wipe is the
      // fallback for surfaces with no glyphs to move (which the Phase-1 preview currently is).
      case "ASCEND":
        state.revealMask = { kind: "WIPE", progress, featherFraction: 0 };
        state.glyphMotion = { type, progress, durationMs: spec.durationMs };
        return state;
      // Canva's Block (`esf`): a full-box bar sweeps across and the text switches on behind it
      // halfway (§8.3 item 3). A loop plays the entrance every cycle.
      case "BLOCK":
        return canvaBlockState(cycleProgress, isExiting, layer);
      case "CH_WIGGLE_Y":
        state.glyphMotion = { type, progress: cycleProgress, durationMs: spec.durationMs };
        return state;
      case "TYPEWRITER_CHARS":
        return typewriterVisualState(progress, "CHARS", spec.durationMs);
      case "TYPEWRITER_CURSOR":
        return typewriterVisualState(progress, "CURSOR", spec.durationMs);
      case "TYPEWRITER_WORDS":
        return typewriterVisualState(progress, "WORDS", spec.durationMs);
      default:
        return state;
    }
  }

  /**
   * Canva's writing styles (§8.4): with a `unit` param the whole-element state stays as Canva's
   * own fallback (media layers, curved text, a too-short Succession) and the text renderer gets
   * the unit schedule's inputs through `glyphMotion`.
   */
  function withCanvaUnits(state: AnimationVisualState): AnimationVisualState {
    const unit = canvaUnitMode(specParam(spec, "unit"));
    if (unit === null || !isCanvaUnitType(type)) return state;
    const rawProgress = phase.exiting ? phase.u : phase.p;
    const seed = specParam(spec, "seed");
    state.glyphMotion = {
      type,
      progress: rawProgress,
      durationMs: spec.durationMs,
      unit,
      fill: specParam(spec, "fill") === 1,
      rawProgress,
      isExiting: phase.exiting,
      intensity,
      ...(seed !== undefined ? { seed } : {}),
    };
    return state;
  }

  // Exit: fade the whole layer out with the reverse progress so it fully disappears once the
  // exit finishes (on top of its motion) — EXCEPT for the matte reveals and the Canva family. A
  // mask already hides the layer completely as it closes, so fading on top would make it fade
  // AND close, which the art doesn't. Mobile guards this with `spec.maskProgress == null`; the
  // web equivalent is "this authored effect has a maskProgress channel", i.e. it's one of the
  // reveal family. The Canva family computed its own outro from u above, opacity included, and
  // Canva's Block hides its text behind its own bar (§8.3 item 3: no generic exit fade).
  if (isExiting && !canvaOneShot && type !== "BLOCK") {
    const hidesViaMatte = getAuthoredCurves(type)?.channels.maskProgress != null;
    if (!hidesViaMatte) {
      return { ...base, alphaMultiplier: clamp(base.alphaMultiplier * cycleProgress, 0, 1) };
    }
  }
  return base;
}

// ── Concurrent loops, stacked repeating effects and composition (§8.2) ────────────────────────────

/** True for a loop slot the importer marked `concurrent: 1` — it runs alongside entrance/exit. */
export function isConcurrentLoop(spec: AnimationSpecInput | null | undefined): boolean {
  return Boolean(spec && spec.type !== "NONE" && specParam(spec, "concurrent") === 1);
}

/**
 * The two-stage ramp a concurrent BREATHE/DRIFT/TECTONIC carries (§8.1 `r1*`/`r2*`), on the
 * values [from] → [to] → [to2]; the timing keys are shared by the value ramp and Breathe's `y` one.
 * Missing keys read as the app reads them: stage-1 start/duration 0, stage-2 start 0, eases LINEAR,
 * and stage 2 exists only when `r2Dur` does.
 */
function rampFromParams(spec: AnimationSpecInput, from: number, to: number, to2: number): CanvaRamp {
  const r2Dur = specParam(spec, "r2Dur");
  const ramp: CanvaRamp = {
    from,
    to,
    start: specParam(spec, "r1Start") ?? 0,
    duration: specParam(spec, "r1Dur") ?? 0,
    ease: Math.trunc(specParam(spec, "r1Ease") ?? CANVA_EASE.LINEAR),
  };
  if (r2Dur !== undefined) {
    ramp.to2 = to2;
    ramp.start2 = specParam(spec, "r2Start") ?? 0;
    ramp.duration2 = r2Dur;
    ramp.ease2 = Math.trunc(specParam(spec, "r2Ease") ?? CANVA_EASE.LINEAR);
  }
  return ramp;
}

/**
 * A concurrent loop's own visual at loop clock [loopMs] (§8.2): with ramp params, BREATHE ramps
 * the scale (plus its vertical drift from the `y` ramp), DRIFT the translation along its axis
 * (x for LEFT/RIGHT/DEFAULT, y for UP/DOWN) and TECTONIC the x translation, all in layer-local
 * ms; without them the type's loop formula plays at `(loopMs mod durationMs) / durationMs`.
 */
export function resolveConcurrentLoopVisualState(
  loop: AnimationSpecInput,
  loopMs: number,
  width: number,
  height: number,
  layerIndex = 0
): AnimationVisualState {
  const to = specParam(loop, "r1To");
  if (to !== undefined && (loop.type === "BREATHE" || loop.type === "DRIFT" || loop.type === "TECTONIC")) {
    const state = identityVisualState();
    const value = canvaRampValue(
      rampFromParams(loop, specParam(loop, "r1From") ?? to, to, specParam(loop, "r2To") ?? to),
      loopMs
    );
    if (loop.type === "BREATHE") {
      state.scaleMultiplier = value;
      const yTo = specParam(loop, "y1To");
      const yFrom = specParam(loop, "y1From");
      if (yTo !== undefined || yFrom !== undefined) {
        const end = yTo ?? 0;
        state.translationY = canvaRampValue(
          rampFromParams(loop, yFrom ?? 0, end, specParam(loop, "y2To") ?? end),
          loopMs
        );
      }
    } else if (loop.type === "DRIFT" && (loop.direction === "UP" || loop.direction === "DOWN")) {
      state.translationY = value;
    } else {
      state.translationX = value;
    }
    return state;
  }
  // Without a ramp the type's LOOP formula plays (as a loop, whatever the stored flag says).
  const cycle = Math.max(1, loop.durationMs);
  const local = canvaFloorMod(loopMs, cycle);
  return resolveAnimationVisualState(
    { ...loop, infinite: true },
    local / cycle,
    width,
    height,
    false,
    layerIndex
  );
}

/** `value mod modulus`, never negative (a phase can put the clock before 0). */
function canvaFloorMod(value: number, modulus: number): number {
  if (!(modulus > 0)) return 0;
  const rest = value - modulus * Math.floor(value / modulus);
  return rest >= modulus ? 0 : rest;
}

/**
 * The extra repeating effects a concurrent loop stacks (`stackRotate`, `stackFlicker`,
 * `stackPulse`, `stackWiggle` — each value its cycle ms, a negative `stackRotate` turning
 * counter-clockwise), at stack clock [stackMs]. Identity when there are none.
 */
export function resolveStackedEffectsVisualState(
  loop: AnimationSpecInput,
  stackMs: number,
  width: number,
  height: number
): AnimationVisualState {
  const state = identityVisualState();
  const phaseOf = (cycle: number) => {
    const length = Math.abs(cycle);
    return length > 0 ? clamp(canvaFloorMod(stackMs, length) / length, 0, 1) : 0;
  };
  const rotate = specParam(loop, "stackRotate");
  if (rotate !== undefined && rotate !== 0) {
    state.rotationDeltaDegrees += phaseOf(rotate) * 360 * (rotate < 0 ? -1 : 1);
  }
  const flicker = specParam(loop, "stackFlicker");
  if (flicker !== undefined && flicker > 0) {
    state.alphaMultiplier *= clamp(
      canvaFlickerOpacity(phaseOf(flicker) * flicker, flicker, specParam(loop, "stackFlickerT") ?? 0.5),
      0,
      1
    );
  }
  const pulse = specParam(loop, "stackPulse");
  if (pulse !== undefined && pulse > 0) {
    state.scaleMultiplier *= canvaPulseState(phaseOf(pulse)).scaleMultiplier;
  }
  const wiggle = specParam(loop, "stackWiggle");
  if (wiggle !== undefined && wiggle > 0) {
    const pose = canvaWigglePose(
      phaseOf(wiggle) * wiggle,
      wiggle,
      specParam(loop, "stackWiggleT") ?? 0.5,
      canvaWiggleRandom(specParam(loop, "seed"), Math.max(1, width), Math.max(1, height))
    );
    state.translationX += pose.translationX;
    state.translationY += pose.translationY;
    state.rotationDeltaDegrees += pose.rotationDegrees;
  }
  return state;
}

/**
 * Canva's property composition (`$pf`): alpha and the scales multiply; translations, rotation and
 * blur add; the reveal mask, text reveal, glyph motion and BLOCK's bar come from [primary] alone.
 */
export function composeVisualStates(
  primary: AnimationVisualState,
  other: AnimationVisualState
): AnimationVisualState {
  return {
    ...primary,
    scaleMultiplier: primary.scaleMultiplier * other.scaleMultiplier,
    scaleXMultiplier: primary.scaleXMultiplier * other.scaleXMultiplier,
    scaleYMultiplier: primary.scaleYMultiplier * other.scaleYMultiplier,
    rotationDeltaDegrees: primary.rotationDeltaDegrees + other.rotationDeltaDegrees,
    translationX: primary.translationX + other.translationX,
    translationY: primary.translationY + other.translationY,
    alphaMultiplier: primary.alphaMultiplier * other.alphaMultiplier,
    blurRadiusPx: primary.blurRadiusPx + other.blurRadiusPx,
  };
}

/**
 * The two halves of a playback state's visual: the active slot's state, and — when the timeline
 * attached a concurrent loop — that loop composed with its stacked effects (§8.2), each on its own
 * clock: the loop at `windowMs + phaseMs`, the stack at `windowMs + stackPhaseMs`.
 */
export function resolvePlaybackVisualParts(
  playback: PlaybackState,
  width: number,
  height: number,
  layerIndex = 0
): { primary: AnimationVisualState; concurrent: AnimationVisualState | null } {
  const primary = playback.animation
    ? resolveAnimationVisualState(
        playback.animation,
        playback.progress,
        width,
        height,
        playback.isExiting,
        layerIndex
      )
    : identityVisualState();
  const loop = playback.isVisible ? playback.concurrentLoop ?? null : null;
  if (!loop) return { primary, concurrent: null };
  const windowMs = playback.windowMs ?? playback.localMs;
  const loopState = resolveConcurrentLoopVisualState(
    loop,
    windowMs + (specParam(loop, "phaseMs") ?? 0),
    width,
    height,
    layerIndex
  );
  const stacked = resolveStackedEffectsVisualState(
    loop,
    windowMs + (specParam(loop, "stackPhaseMs") ?? 0),
    width,
    height
  );
  return { primary, concurrent: composeVisualStates(loopState, stacked) };
}

/**
 * The visual of a whole playback state (the app's `resolveLayerAnimationVisualState(playback, …)`):
 * the active slot, composed with the concurrent loop and its stacked effects when the timeline
 * attached one (§8.2). Without a concurrent loop this is exactly resolveAnimationVisualState.
 */
export function resolvePlaybackVisualState(
  playback: PlaybackState,
  width: number,
  height: number,
  layerIndex = 0
): AnimationVisualState {
  const { primary, concurrent } = resolvePlaybackVisualParts(playback, width, height, layerIndex);
  if (!concurrent) return primary;
  const composed = composeVisualStates(primary, concurrent);
  const glyph = primary.glyphMotion;
  if (!glyph || glyph.unit === undefined) return composed;
  return {
    ...composed,
    glyphMotion: {
      ...glyph,
      restAlpha: concurrent.alphaMultiplier,
      restScale: concurrent.scaleMultiplier,
      restBlurPx: concurrent.blurRadiusPx,
    },
  };
}

export { COMP_PX };
