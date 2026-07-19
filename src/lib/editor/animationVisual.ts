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
 */
import { valueAtFrame } from "./animationCurves";
import {
  COMP_PX,
  getAuthoredCurves,
  type AnimationDirection,
  type AnimationEasing,
} from "./animationSpec";

export type TextRevealMode = "CHARS" | "WORDS" | "CURSOR";

/**
 * Mirrors LayerRevealMaskSpec. `featherFraction` is the ONLY thing separating each GRADIENT_*
 * family member from its hard-edged twin — drop it and GRADIENT_WIPE renders as WIPE.
 */
export type RevealMaskSpec =
  | { kind: "WIPE"; progress: number; featherFraction: number }
  | { kind: "CIRCLE"; progress: number; featherFraction: number }
  | { kind: "RADIAL"; progress: number; startAngleDegrees: number };

export interface TextRevealSpec {
  progress: number;
  mode: TextRevealMode;
  durationMs: number;
}

export interface GlyphMotionSpec {
  type: string;
  progress: number;
  durationMs: number;
}

/**
 * Mirrors LayerOverlayBarSpec — BLOCK's painted bar, as fractions of the layer WIDTH. The colour
 * is absent by design: the renderer paints it in the layer's own text colour. Like revealMask and
 * glyphMotion, the Phase-1 preview surface does not draw it yet.
 */
export interface OverlayBarSpec {
  leftFraction: number;
  widthFraction: number;
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

/** BLOCK's bar width, as a fraction of layer width — verbatim from BLOCK_WIDTH_FRACTION. */
const BLOCK_WIDTH_FRACTION = 0.34;

export interface AnimationSpecInput {
  type: string;
  infinite: boolean;
  durationMs: number;
  delayMs: number;
  direction: AnimationDirection;
  easing: AnimationEasing;
  intensity: number;
}

const PI = Math.PI;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
    case "WIPE":
      return { kind: "WIPE", progress, featherFraction: 0 };
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

/**
 * Resolves [spec] at [cycleProgress] (the raw 0..1 from the slot) for a layer of
 * [width]x[height] design px. [isExiting] fades the layer fully out as an exit reverses.
 */
export function resolveAnimationVisualState(
  spec: AnimationSpecInput,
  cycleProgressInput: number,
  width: number,
  height: number,
  isExiting = false
): AnimationVisualState {
  const type = spec.type;
  const intensity = spec.intensity;
  const vector = resolveAnimationVector(spec.direction);
  const cycleProgress = clamp(cycleProgressInput, 0, 1);
  const oneShotProgress = applyAnimationEasing(cycleProgress, spec.easing);
  const cycleWave = applyAnimationEasing(pingPongProgress(cycleProgress), spec.easing);
  const progress = spec.infinite ? cycleWave : oneShotProgress;
  const wave = Math.sin(cycleProgress * 2 * PI);
  const pingPong = pingPongProgress(cycleProgress);
  const driftX = Math.max(14, width * 0.18);
  const driftY = Math.max(8, height * 0.12);

  // The authored art carries its own per-keyframe béziers and is read at RAW cycleProgress.
  const base: AnimationVisualState = getAuthoredCurves(type)
    ? evaluateAuthoredSpec(type, cycleProgress, width, height)
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
        const riseY = vector.y !== 0 ? vector.y : type === "SHIFT" ? 1 : -1;
        state.translationY = -riseY * (1 - progress) * Math.max(16, height * 0.22) * intensity;
        state.alphaMultiplier = clamp(0.12 + progress * 0.88, 0, 1);
        return state;
      }
      case "PAN":
      case "SKATE": {
        const panX = vector.x !== 0 ? vector.x : type === "SKATE" ? -1 : 1;
        state.translationX = panX * (1 - progress) * Math.max(22, width * 0.28) * intensity;
        state.alphaMultiplier = clamp(0.16 + progress * 0.84, 0, 1);
        return state;
      }
      case "BLUR":
        state.alphaMultiplier = clamp(0.05 + progress * 0.95, 0, 1);
        state.scaleXMultiplier = 0.92 + progress * 0.08;
        state.scaleYMultiplier = 0.92 + progress * 0.08;
        return state;
      case "SUCCESSION":
        state.scaleMultiplier = 0.82 + progress * 0.18;
        state.alphaMultiplier = clamp(0.06 + progress * 0.94, 0, 1);
        return state;
      case "BREATHE":
        state.scaleMultiplier = 1 + pingPong * 0.06 * intensity;
        state.alphaMultiplier = clamp(0.86 + pingPong * 0.14, 0, 1);
        return state;
      case "BASELINE": {
        const bounceWave = Math.abs(Math.sin(cycleProgress * PI * 2));
        state.translationY = -bounceWave * Math.max(10, height * 0.1) * intensity;
        state.scaleYMultiplier = 1 - bounceWave * 0.06 * intensity;
        state.scaleXMultiplier = 1 + bounceWave * 0.04 * intensity;
        return state;
      }
      case "DRIFT":
        state.translationX = vector.x * (1 - progress) * driftX * intensity;
        state.translationY = vector.y * (1 - progress) * driftY * intensity;
        state.alphaMultiplier = clamp(0.1 + progress * 0.9, 0, 1);
        return state;
      case "TECTONIC":
        state.translationX = vector.x * (1 - progress) * Math.max(28, width * 0.34) * intensity;
        state.scaleXMultiplier = 0.9 + progress * 0.1;
        state.alphaMultiplier = clamp(0.08 + progress * 0.92, 0, 1);
        return state;
      case "TUMBLE":
        state.rotationDeltaDegrees = (1 - progress) * 26 * rotationSpin(spec.direction) * intensity;
        state.translationX =
          rotationSpin(spec.direction) * (1 - progress) * Math.max(18, width * 0.18) * intensity;
        state.translationY = -(1 - progress) * Math.max(18, height * 0.22) * intensity;
        state.alphaMultiplier = clamp(0.08 + progress * 0.92, 0, 1);
        return state;
      case "NEON":
        state.scaleMultiplier = 1 + pingPong * 0.05 * intensity;
        state.alphaMultiplier = clamp(
          0.8 + pingPong * 0.2 + Math.sin(cycleProgress * PI * 6) * 0.04,
          0.72,
          1
        );
        return state;
      case "SCRAPBOOK":
        state.rotationDeltaDegrees = wave * 6.5 * intensity;
        state.translationX = wave * Math.max(5, width * 0.024) * intensity;
        state.translationY =
          Math.cos(cycleProgress * PI * 2) * Math.max(3, height * 0.018) * intensity;
        return state;
      case "STOMP":
        state.scaleMultiplier = 0.78 + progress * 0.22;
        state.rotationDeltaDegrees = (1 - progress) * 18 * rotationSpin(spec.direction) * intensity;
        state.alphaMultiplier = clamp(0.1 + progress * 0.9, 0, 1);
        return state;
      case "ROTATE":
        state.rotationDeltaDegrees = cycleProgress * 360 * rotationSpin(spec.direction) * intensity;
        return state;
      case "WIGGLE":
        state.rotationDeltaDegrees = wave * 4.5 * intensity;
        state.translationX = wave * Math.max(3, width * 0.018) * intensity;
        return state;
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
      // A bar sweeps across and the text appears behind its TRAILING (left) edge. The reveal is
      // pinned to the bar's left edge so one number drives both and they can't drift apart. The
      // Phase-1 preview honours neither channel yet, so BLOCK renders static until a bar-aware
      // surface exists — the documented reveal/glyph fallback.
      case "BLOCK": {
        const travel = 1 + BLOCK_WIDTH_FRACTION;
        const left = -BLOCK_WIDTH_FRACTION + progress * travel;
        const swept = clamp(left, 0, 1);
        state.revealMask = { kind: "WIPE", progress: swept, featherFraction: 0 };
        state.overlayBar = { leftFraction: left, widthFraction: BLOCK_WIDTH_FRACTION };
        return state;
      }
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

  // Exit: fade the whole layer out with the reverse progress so it fully disappears once the
  // exit finishes (on top of its motion) — EXCEPT for the matte reveals. A mask already hides
  // the layer completely as it closes, so fading on top would make it fade AND close, which the
  // art doesn't. Mobile guards this with `spec.maskProgress == null`; the web equivalent is
  // "this authored effect has a maskProgress channel", i.e. it's one of the reveal family.
  if (isExiting) {
    const hidesViaMatte = getAuthoredCurves(type)?.channels.maskProgress != null;
    if (!hidesViaMatte) {
      return { ...base, alphaMultiplier: clamp(base.alphaMultiplier * cycleProgress, 0, 1) };
    }
  }
  return base;
}

export { COMP_PX };
