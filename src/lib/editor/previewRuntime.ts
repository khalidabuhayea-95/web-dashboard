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

export function resolveAnimationStateAtFrame(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number
): AnimationState | null {
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

export function resolveAnimatedElementPoseAtFrame(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number
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

  // Motion paths compose additively with (or without) a preset animation.
  const motionOffset = resolveMotionPathOffset(element, currentFrame, fps, pageDurationMs);
  if (motionOffset) {
    base.x += motionOffset.x;
    base.y += motionOffset.y;
  }

  const state = resolveAnimationStateAtFrame(element, currentFrame, fps, pageDurationMs);
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
  return {
    x: base.x + visual.translationX,
    y: base.y + visual.translationY,
    rotation: base.rotation + visual.rotationDeltaDegrees,
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
  pageDurationMs: number
): ElementRenderEffects | null {
  const state = resolveAnimationStateAtFrame(element, currentFrame, fps, pageDurationMs);
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
