"use client";

import { resolveTimelineWindow } from "@/lib/editor/animationTimeline";
import {
  resolveElementAnimations,
  resolveTimelinePlaybackState,
} from "@/lib/editor/animationSlots";
import {
  applyAnimationEasing,
  pingPongProgress,
  resolveAnimationVisualState,
  type AnimationSpecInput,
} from "@/lib/editor/animationVisual";
import type { EditorElement } from "@/store/editorStore";

export const PREVIEW_RENDER_FPS = 60;

/**
 * How many frames a second the template preview RECORDER actually captures.
 *
 * ★Deliberately half [PREVIEW_RENDER_FPS], which is the timeline's frame grid and stays at 60.
 *
 * Capturing at 60 does not buy a smoother preview, it buys a worse one. Template clips are 30fps
 * sources, so half the captured frames can never be distinct — and redrawing the Konva stage and
 * encoding those duplicates 60 times a second starves the `<video>` element that is decoding
 * alongside it. Measured on a 13.2s 1080p clip, the capture loop held 60fps for the whole
 * recording while the decoder fell from ~34 new frames a second to 7, so the preview started
 * smooth and ended a slideshow. Capturing at 30 leaves the decoder the headroom to keep up.
 *
 * 30 is also what the mobile editor's own timeline runs at, so a recorded preview and the app
 * play the same design at the same cadence.
 */
export const PREVIEW_CAPTURE_FPS = 30;

export interface ElementRenderPose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  /** Gaussian blur radius in design px (Canva-parity BLUR); 0 = no blur. */
  blurRadius: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function resolvePreviewRenderFps(_input?: unknown) {
  return PREVIEW_RENDER_FPS;
}

export function frameToMs(frame: number, fps: number) {
  const safeFrame = Math.max(0, Math.round(Number(frame) || 0));
  const safeFps = Math.max(1, Math.round(Number(fps) || PREVIEW_RENDER_FPS));
  return Math.round((safeFrame * 1000) / safeFps);
}

export function frameToSampleTimeMs(frame: number, fps: number) {
  const safeFrame = Math.max(0, Math.round(Number(frame) || 0));
  const safeFps = Math.max(1, Math.round(Number(fps) || PREVIEW_RENDER_FPS));
  return (safeFrame * 1000) / safeFps;
}

export function msToDurationFrames(ms: number, fps: number) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const safeFps = Math.max(1, Math.round(Number(fps) || PREVIEW_RENDER_FPS));
  return Math.max(1, Math.ceil((safeMs / 1000) * safeFps));
}

export function msToOffsetFrames(ms: number, fps: number) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const safeFps = Math.max(1, Math.round(Number(fps) || PREVIEW_RENDER_FPS));
  return Math.max(0, Math.round((safeMs / 1000) * safeFps));
}

export function elapsedMsToFrame(elapsedMs: number, fps: number) {
  const safeElapsedMs = Math.max(0, Number(elapsedMs) || 0);
  const safeFps = Math.max(1, Math.round(Number(fps) || PREVIEW_RENDER_FPS));
  return Math.max(0, Math.floor((safeElapsedMs / 1000) * safeFps));
}

export function alignPlayheadMsToFrame(playheadMs: number, fps: number, durationMs?: number) {
  const nextMs = frameToMs(msToOffsetFrames(playheadMs, fps), fps);
  if (!Number.isFinite(Number(durationMs)) || Number(durationMs) <= 0) {
    return nextMs;
  }
  return Math.min(Math.max(0, Number(durationMs)), nextMs);
}

export function getDurationFrames(durationMs: number, fps: number) {
  return msToDurationFrames(durationMs, fps);
}

export function getPlayheadMsForFrame(frame: number, fps: number, durationMs: number) {
  const totalFrames = getDurationFrames(durationMs, fps);
  if (frame >= totalFrames) return Math.max(0, Math.round(Number(durationMs) || 0));
  return Math.round(
    Math.min(
      Math.max(0, Number(durationMs) || 0),
      frameToSampleTimeMs(frame, fps)
    )
  );
}

export function getFrameAlignedPlayheadFrame(playheadMs: number, fps: number, durationMs: number) {
  const totalFrames = getDurationFrames(durationMs, fps);
  return Math.min(totalFrames, msToOffsetFrames(playheadMs, fps));
}

/**
 * The animation active at [currentFrame], resolved from the element's three slots.
 *
 * `progress` keeps the historical meaning: EASED, and ping-ponged when infinite — i.e. what the
 * analytic formulas consume. `cycleProgress` is the raw 0..1 the authored keyframes are read at.
 */
export interface AnimationState {
  spec: AnimationSpecInput;
  progress: number;
  cycleProgress: number;
  isExiting: boolean;
}

/**
 * `settled: true` asks for the design AT REST: the pose a layer holds once its entrance has
 * finished and before any exit has begun. It exists because frame 0 is NOT the design — a page
 * whose every layer carries a fade-in is fully transparent there, so the editor opened on a blank
 * canvas and the thumbnail/poster captured from it were saved pure white. Canva never shows that:
 * its editing canvas draws the settled design and only the player animates.
 *
 * For every family the settled visual IS the authored pose — an entrance has arrived, an exit has
 * not started, a loop sits at its base phase — so the honest answer is to apply no animation at
 * all. The recorder, the filmstrip and a scrubbed playhead must never pass it.
 */
export interface RenderPoseOptions {
  settled?: boolean;
}

export function resolveAnimationStateAtFrame(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number,
  options?: RenderPoseOptions
): AnimationState | null {
  if (options?.settled) return null;
  const slots = resolveElementAnimations(element);
  const timelineWindow = resolveTimelineWindow(element, pageDurationMs);
  const sampleTimeMs = Math.min(
    Math.max(0, Number(pageDurationMs) || 0),
    frameToSampleTimeMs(currentFrame, fps)
  );
  const playback = resolveTimelinePlaybackState(
    false,
    timelineWindow.startMs,
    timelineWindow.endMs,
    slots,
    sampleTimeMs,
    pageDurationMs
  );
  const spec = playback.animation;
  if (!playback.isVisible || !spec || spec.type === "NONE") return null;

  const cycleProgress = clamp(playback.progress, 0, 1);
  const progress = spec.infinite
    ? applyAnimationEasing(pingPongProgress(cycleProgress), spec.easing)
    : applyAnimationEasing(cycleProgress, spec.easing);
  return { spec, progress, cycleProgress, isExiting: playback.isExiting };
}

// Keyframed position offset (Canva custom "create an animation" motion paths). The element's
// mediaMotionPath is [{t, x, y}] — t in ms from the element's timeline-window start, x/y cumulative
// design-px offsets from the element's base position. Before the first point → first offset; after
// the last point → HOLD the last offset (e.g. doors slide apart over ~3s then stay parted). Linear
// interpolation between points (the path is densely sampled at capture time).
function resolveMotionPathOffset(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number
): { x: number; y: number } | null {
  const path = (element as { mediaMotionPath?: Array<{ t: number; x: number; y: number }> })
    .mediaMotionPath;
  if (!Array.isArray(path) || path.length < 2) return null;
  const timelineWindow = resolveTimelineWindow(element, pageDurationMs);
  const sampleTimeMs = Math.min(
    Math.max(0, Number(pageDurationMs) || 0),
    frameToSampleTimeMs(currentFrame, fps)
  );
  const elapsed = sampleTimeMs - timelineWindow.startMs;
  const first = path[0];
  const last = path[path.length - 1];
  if (elapsed <= Number(first.t)) return { x: Number(first.x) || 0, y: Number(first.y) || 0 };
  if (elapsed >= Number(last.t)) return { x: Number(last.x) || 0, y: Number(last.y) || 0 };
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const next = path[i];
    const t0 = Number(prev.t) || 0;
    const t1 = Number(next.t) || 0;
    if (elapsed > t1) continue;
    const span = Math.max(1e-6, t1 - t0);
    const f = clamp((elapsed - t0) / span, 0, 1);
    return {
      x: (Number(prev.x) || 0) + ((Number(next.x) || 0) - (Number(prev.x) || 0)) * f,
      y: (Number(prev.y) || 0) + ((Number(next.y) || 0) - (Number(prev.y) || 0)) * f,
    };
  }
  return { x: Number(last.x) || 0, y: Number(last.y) || 0 };
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Keeps an animated layer turning and growing about its CENTRE.
 *
 * Konva rotates and scales a node about the point it is positioned at, which is the layer's
 * top-left corner. The app renders through a Compose `graphicsLayer`, whose transform origin is the
 * centre. Handing Konva the same numbers therefore produced a different picture: Spin swung the
 * layer around its own corner in a wide arc instead of turning in place, and a zoom grew it towards
 * the bottom-right instead of outwards.
 *
 * Rather than re-origin every node (which would change what x/y mean for dragging, the Transformer
 * and every import), this returns the top-left offset that holds the centre still: where the centre
 * sits under the authored rotation and scale, minus where it would sit under the animated ones.
 * With no animation both terms are equal and the offset is zero, so nothing else moves.
 */
function centrePivotOffset(
  width: number,
  height: number,
  fromRotationDegrees: number,
  fromScaleX: number,
  fromScaleY: number,
  toRotationDegrees: number,
  toScaleX: number,
  toScaleY: number
): { x: number; y: number } {
  const halfWidth = Math.max(0, width) / 2;
  const halfHeight = Math.max(0, height) / 2;
  if (halfWidth === 0 && halfHeight === 0) return { x: 0, y: 0 };

  const fromRadians = fromRotationDegrees * DEGREES_TO_RADIANS;
  const toRadians = toRotationDegrees * DEGREES_TO_RADIANS;
  const fromX = halfWidth * fromScaleX;
  const fromY = halfHeight * fromScaleY;
  const toX = halfWidth * toScaleX;
  const toY = halfHeight * toScaleY;

  return {
    x:
      (Math.cos(fromRadians) * fromX - Math.sin(fromRadians) * fromY) -
      (Math.cos(toRadians) * toX - Math.sin(toRadians) * toY),
    y:
      (Math.sin(fromRadians) * fromX + Math.cos(fromRadians) * fromY) -
      (Math.sin(toRadians) * toX + Math.cos(toRadians) * toY),
  };
}

export function resolveAnimatedElementPoseAtFrame(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number,
  options?: RenderPoseOptions
): ElementRenderPose {
  const base: ElementRenderPose = {
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    scaleX: element.scaleX,
    scaleY: element.scaleY,
    opacity: element.opacity,
    blurRadius: 0,
  };

  // Motion paths compose additively with (or without) a preset animation. A motion path IS the
  // animation, so a settled render holds the authored position — the offsets are cumulative from
  // it, which is exactly the place Canva's editing canvas shows before the path plays.
  const motionOffset = options?.settled
    ? null
    : resolveMotionPathOffset(element, currentFrame, fps, pageDurationMs);
  if (motionOffset) {
    base.x += motionOffset.x;
    base.y += motionOffset.y;
  }

  const state = resolveAnimationStateAtFrame(element, currentFrame, fps, pageDurationMs, options);
  if (!state) return base;

  const visual = resolveAnimationVisualState(
    state.spec,
    state.cycleProgress,
    Math.max(1, element.width),
    Math.max(1, element.height),
    state.isExiting
  );

  // scaleMultiplier is uniform and composes on top of the per-axis multipliers.
  const scaleX = base.scaleX * visual.scaleMultiplier * visual.scaleXMultiplier;
  const scaleY = base.scaleY * visual.scaleMultiplier * visual.scaleYMultiplier;

  // Phase 1 renders the reveal families through their alpha fallback: this surface has no mask
  // channel and no per-glyph text path yet, which is the documented behaviour for a surface
  // that can't honour revealMask / textReveal / glyphMotion.
  const rotation = base.rotation + visual.rotationDeltaDegrees;
  const pivot = centrePivotOffset(
    element.width,
    element.height,
    base.rotation,
    base.scaleX,
    base.scaleY,
    rotation,
    scaleX,
    scaleY
  );

  return {
    x: base.x + visual.translationX + pivot.x,
    y: base.y + visual.translationY + pivot.y,
    rotation,
    scaleX,
    scaleY,
    opacity: clamp(base.opacity * visual.alphaMultiplier, 0, 1),
    blurRadius: Math.max(0, visual.blurRadiusPx),
  };
}

/**
 * The animation's non-transform channels at [currentFrame] — the reveal matte, typewriter
 * reveal, per-glyph motion and BLOCK's bar. Phase 2: the Konva renderer honours these; a null
 * return means nothing to draw beyond the pose. Kept separate from the pose so the transform
 * path stays untouched.
 */
export interface ElementRenderEffects {
  revealMask: NonNullable<ReturnType<typeof resolveAnimationVisualState>>["revealMask"];
  textReveal: NonNullable<ReturnType<typeof resolveAnimationVisualState>>["textReveal"];
  glyphMotion: NonNullable<ReturnType<typeof resolveAnimationVisualState>>["glyphMotion"];
  overlayBar: NonNullable<ReturnType<typeof resolveAnimationVisualState>>["overlayBar"];
}

export function resolveAnimatedElementEffectsAtFrame(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number,
  options?: RenderPoseOptions
): ElementRenderEffects | null {
  const state = resolveAnimationStateAtFrame(element, currentFrame, fps, pageDurationMs, options);
  if (!state) return null;
  const visual = resolveAnimationVisualState(
    state.spec,
    state.cycleProgress,
    Math.max(1, element.width),
    Math.max(1, element.height),
    state.isExiting
  );
  if (!visual.revealMask && !visual.textReveal && !visual.glyphMotion && !visual.overlayBar) {
    return null;
  }
  return {
    revealMask: visual.revealMask,
    textReveal: visual.textReveal,
    glyphMotion: visual.glyphMotion,
    overlayBar: visual.overlayBar,
  };
}

export function resolveVideoSourceTimeAtFrame({
  frame,
  fps,
  layerStartMs,
  sourceStart,
  sourceEnd,
}: {
  frame: number;
  fps: number;
  layerStartMs: number;
  sourceStart: number;
  sourceEnd: number;
}) {
  const sourceSpan = Math.max(0.01, sourceEnd - sourceStart);
  const sampleTimeMs = frameToSampleTimeMs(frame, fps);
  const localSeconds = Math.max(0, sampleTimeMs - Math.max(0, Number(layerStartMs) || 0)) / 1000;
  const loopSeconds = localSeconds % sourceSpan;
  const safeMax = Math.max(sourceStart, sourceEnd - Math.max(1 / Math.max(1, fps), 0.01));
  return clamp(sourceStart + loopSeconds, sourceStart, safeMax);
}
