"use client";

import {
  getAnimationPreset,
  isAnimationInfiniteActive,
  normalizeAnimationDelayMs,
  normalizeAnimationDirection,
  normalizeAnimationDurationMs,
  normalizeAnimationEasing,
  normalizeAnimationIntensity,
  normalizeAnimationMode,
  normalizeAnimationType,
  resolveTimelineWindow,
  type EditorAnimationDirection,
  type EditorAnimationEasing,
  type EditorAnimationPreset,
} from "@/lib/editor/animationTimeline";
import type { EditorElement } from "@/store/editorStore";

export const PREVIEW_RENDER_FPS = 60;

export interface ElementRenderPose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

interface AnimationState {
  preset: EditorAnimationPreset;
  progress: number;
  cycleProgress: number;
  cycleWave: number;
  direction: EditorAnimationDirection;
  intensity: number;
  isInfinite: boolean;
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

function resolveEffectiveAnimationType(element: EditorElement) {
  const normalizedType = normalizeAnimationType(element.mediaAnimationType);
  return normalizedType === "RANDOM"
    ? (["FADE", "PAN", "POP", "BASELINE", "WIGGLE", "PULSE"][
        Array.from(String(element.id || "random")).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
      ] as ReturnType<typeof normalizeAnimationType>)
    : normalizedType;
}

function applyAnimationEasing(progress: number, easing: EditorAnimationEasing) {
  const value = clamp(progress, 0, 1);
  switch (easing) {
    case "LINEAR":
      return value;
    case "EASE_OUT":
      return 1 - Math.pow(1 - value, 3);
    case "EASE_IN_OUT":
      return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
    case "SOFT_OUT":
      return 1 - Math.pow(1 - value, 4);
    case "SOFT_IN_OUT":
      return 0.5 - Math.cos(Math.PI * value) / 2;
    default:
      return value;
  }
}

function getDirectionalVector(direction: EditorAnimationDirection) {
  switch (direction) {
    case "LEFT":
      return { x: -1, y: 0, spin: -1 };
    case "RIGHT":
      return { x: 1, y: 0, spin: 1 };
    case "UP":
      return { x: 0, y: -1, spin: -1 };
    case "DOWN":
      return { x: 0, y: 1, spin: 1 };
    case "COUNTERCLOCKWISE":
      return { x: 0, y: 0, spin: -1 };
    case "CLOCKWISE":
      return { x: 0, y: 0, spin: 1 };
    default:
      return { x: 0, y: 0, spin: 1 };
  }
}

function pingPong(progress: number) {
  const normalized = ((progress % 1) + 1) % 1;
  return 0.5 - Math.cos(normalized * Math.PI * 2) / 2;
}

export function resolveAnimationStateAtFrame(
  element: EditorElement,
  currentFrame: number,
  fps: number,
  pageDurationMs: number
): AnimationState | null {
  const type = resolveEffectiveAnimationType(element);
  const preset = getAnimationPreset(type);
  if (type === "NONE") return null;

  const legacyMode = normalizeAnimationMode(element.mediaAnimationMode);
  const direction = normalizeAnimationDirection(element.mediaAnimationDirection, type);
  const easing = normalizeAnimationEasing(element.mediaAnimationEasing, type);
  const intensity = normalizeAnimationIntensity(element.mediaAnimationIntensity);
  const timelineWindow = resolveTimelineWindow(element, pageDurationMs);
  const sampleTimeMs = Math.min(
    Math.max(0, Number(pageDurationMs) || 0),
    frameToSampleTimeMs(currentFrame, fps)
  );
  const layerDurationMs = Math.max(1, timelineWindow.endMs - timelineWindow.startMs);
  const delayMs = Math.min(
    Math.max(0, layerDurationMs - 1),
    normalizeAnimationDelayMs(element.mediaAnimationDelayMs)
  );
  const isInfinite = isAnimationInfiniteActive(
    type,
    element.mediaAnimationInfinite,
    element.mediaAnimationMode
  );
  const requestedDurationMs = isInfinite
    ? preset.defaultDurationMs
    : normalizeAnimationDurationMs(element.mediaAnimationDurationMs || preset.defaultDurationMs);
  const durationMs = Math.max(1, Math.min(layerDurationMs, requestedDurationMs));
  const activeTimeMs = sampleTimeMs - (timelineWindow.startMs + delayMs);
  const cycleProgress =
    activeTimeMs <= 0
      ? 0
      : isInfinite
        ? ((activeTimeMs % durationMs) + durationMs) % durationMs / durationMs
        : clamp(activeTimeMs / durationMs, 0, 1);
  const cycleWave = applyAnimationEasing(pingPong(cycleProgress), easing);

  if (preset.category === "loop") {
    const oneShot = applyAnimationEasing(clamp(activeTimeMs / durationMs, 0, 1), easing);
    return {
      preset,
      progress: isInfinite ? cycleWave : oneShot,
      cycleProgress,
      cycleWave,
      direction,
      intensity,
      isInfinite,
    };
  }

  if (isInfinite) {
    return {
      preset,
      progress: cycleWave,
      cycleProgress,
      cycleWave,
      direction,
      intensity,
      isInfinite: true,
    };
  }

  const introProgress = applyAnimationEasing(clamp(activeTimeMs / durationMs, 0, 1), easing);
  const outroProgress = applyAnimationEasing(
    clamp((timelineWindow.endMs - delayMs - sampleTimeMs) / durationMs, 0, 1),
    easing
  );
  const progress = legacyMode === "OUT" ? outroProgress : introProgress;

  return {
    preset,
    progress,
    cycleProgress,
    cycleWave,
    direction,
    intensity,
    isInfinite: false,
  };
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
  };

  const state = resolveAnimationStateAtFrame(element, currentFrame, fps, pageDurationMs);
  const type = resolveEffectiveAnimationType(element);
  if (!state) return base;

  const vector = getDirectionalVector(state.direction);
  const progress = clamp(state.progress, 0, 1);
  const intensity = state.intensity;

  let opacityFactor = 1;
  let scaleXFactor = 1;
  let scaleYFactor = 1;
  let offsetX = 0;
  let offsetY = 0;
  let rotationOffset = 0;

  switch (type) {
    case "FADE":
      opacityFactor = 0.04 + progress * 0.96;
      break;
    case "BLUR":
      opacityFactor = 0.05 + progress * 0.95;
      scaleXFactor = 0.92 + progress * 0.08;
      scaleYFactor = 0.92 + progress * 0.08;
      break;
    case "RISE":
      offsetY = Math.max(16, element.height * 0.22) * (1 - progress) * intensity;
      opacityFactor = 0.12 + progress * 0.88;
      break;
    case "PAN":
      offsetX = vector.x * (1 - progress) * Math.max(22, element.width * 0.28) * intensity;
      opacityFactor = 0.16 + progress * 0.84;
      break;
    case "DRIFT":
      offsetX = vector.x * (1 - progress) * Math.max(14, element.width * 0.18) * intensity;
      offsetY = vector.y * (1 - progress) * Math.max(8, element.height * 0.12) * intensity;
      opacityFactor = 0.1 + progress * 0.9;
      break;
    case "TECTONIC":
      offsetX = vector.x * (1 - progress) * Math.max(28, element.width * 0.34) * intensity;
      scaleXFactor = 0.9 + progress * 0.1;
      opacityFactor = 0.08 + progress * 0.92;
      break;
    case "WIPE":
      if (Math.abs(vector.x) > 0) {
        scaleXFactor = Math.max(0.001, progress);
        offsetX = vector.x < 0 ? element.width * (1 - progress) : 0;
      } else {
        scaleYFactor = Math.max(0.001, progress);
        offsetY = vector.y < 0 ? element.height * (1 - progress) : 0;
      }
      break;
    case "POP":
      scaleXFactor = 0.7 + progress * 0.3;
      scaleYFactor = 0.7 + progress * 0.3;
      opacityFactor = 0.12 + progress * 0.88;
      break;
    case "SUCCESSION":
      scaleXFactor = 0.82 + progress * 0.18;
      scaleYFactor = 0.82 + progress * 0.18;
      opacityFactor = 0.06 + progress * 0.94;
      break;
    case "STOMP":
      scaleXFactor = 0.78 + progress * 0.22;
      scaleYFactor = 0.78 + progress * 0.22;
      rotationOffset = (1 - progress) * 18 * vector.spin * intensity;
      opacityFactor = 0.1 + progress * 0.9;
      break;
    case "BREATHE": {
      const breathWave = pingPong(state.cycleProgress);
      scaleXFactor = 1 + breathWave * 0.06 * intensity;
      scaleYFactor = 1 + breathWave * 0.06 * intensity;
      opacityFactor = 0.86 + breathWave * 0.14;
      break;
    }
    case "BASELINE": {
      const bounceWave = Math.abs(Math.sin(state.cycleProgress * Math.PI * 2));
      offsetY = -bounceWave * Math.max(10, element.height * 0.1) * intensity;
      scaleYFactor = 1 - bounceWave * 0.06 * intensity;
      scaleXFactor = 1 + bounceWave * 0.04 * intensity;
      break;
    }
    case "TUMBLE":
      rotationOffset = (1 - progress) * 26 * vector.spin * intensity;
      offsetX = vector.spin * (1 - progress) * Math.max(18, element.width * 0.18) * intensity;
      offsetY = -(1 - progress) * Math.max(18, element.height * 0.22) * intensity;
      opacityFactor = 0.08 + progress * 0.92;
      break;
    case "NEON": {
      const pulseWave = pingPong(state.cycleProgress);
      scaleXFactor = 1 + pulseWave * 0.05 * intensity;
      scaleYFactor = 1 + pulseWave * 0.05 * intensity;
      opacityFactor = clamp(0.8 + pulseWave * 0.2 + Math.sin(state.cycleProgress * Math.PI * 6) * 0.04, 0.72, 1);
      break;
    }
    case "SCRAPBOOK": {
      const scrapbookWave = Math.sin(state.cycleProgress * Math.PI * 2);
      rotationOffset = scrapbookWave * 6.5 * intensity;
      offsetX = scrapbookWave * Math.max(5, element.width * 0.024) * intensity;
      offsetY = Math.cos(state.cycleProgress * Math.PI * 2) * Math.max(3, element.height * 0.018) * intensity;
      break;
    }
    case "ROTATE":
      rotationOffset = state.cycleProgress * 360 * vector.spin * intensity;
      break;
    case "FLICKER": {
      const irregular =
        0.4 +
        0.34 * Math.abs(Math.sin(state.cycleProgress * Math.PI * 9.2)) +
        0.22 * Math.abs(Math.sin(state.cycleProgress * Math.PI * 23.6));
      opacityFactor = clamp(
        state.isInfinite ? irregular : 1 - state.progress + irregular * state.progress,
        0.16,
        1
      );
      break;
    }
    case "PULSE": {
      const pulseWave = pingPong(state.cycleProgress);
      scaleXFactor = 1 + pulseWave * 0.12 * intensity;
      scaleYFactor = 1 + pulseWave * 0.12 * intensity;
      break;
    }
    case "WIGGLE": {
      const wiggleWave = Math.sin(state.cycleProgress * Math.PI * 2);
      rotationOffset = wiggleWave * 4.5 * intensity;
      offsetX = wiggleWave * Math.max(3, element.width * 0.018) * intensity;
      break;
    }
    default:
      break;
  }

  return {
    x: base.x + offsetX,
    y: base.y + offsetY,
    rotation: base.rotation + rotationOffset,
    scaleX: base.scaleX * scaleXFactor,
    scaleY: base.scaleY * scaleYFactor,
    opacity: clamp(base.opacity * opacityFactor, 0, 1),
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
