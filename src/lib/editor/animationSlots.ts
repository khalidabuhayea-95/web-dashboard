/**
 * Port of the mobile app's `LayerAnimationRuntime.resolveTimelinePlaybackStateFor`.
 *
 * The three slots are NOT blended — they are mutually exclusive, picked by time window in a
 * strict priority order (exit → entrance → loop → hold). This is not stated in the handoff doc;
 * it is transcribed from the app so playback can't drift.
 *
 *   entDur   = min(layerDuration, entrance.durationMs + entrance.delayMs)   // 0 with no entrance
 *   exitDur  = min(layerDuration - entDur, exit.durationMs)                 // entrance wins the budget
 *   exitStart = layerDuration - exitDur
 *
 * Exit reuses the ENTRANCE visual mapping run in reverse (progress 1 = shown → 0 = gone), and
 * sets isExiting so the visual runtime fades the layer fully out on top of its motion.
 */
import {
  getAnimationDefaults,
  normalizeSpecAnimationType,
  normalizeSpecDirection,
  normalizeSpecEasing,
  type AnimationCategory,
} from "./animationSpec";
import type { AnimationSpecInput } from "./animationVisual";

export interface LayerAnimations {
  entrance: AnimationSpecInput | null;
  exit: AnimationSpecInput | null;
  loop: AnimationSpecInput | null;
}

export interface PlaybackState {
  isVisible: boolean;
  localMs: number;
  /** Raw 0..1 for the active slot — feed this to resolveAnimationVisualState as cycleProgress. */
  progress: number;
  animation: AnimationSpecInput | null;
  isExiting: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Builds a spec, filling anything unset from the type's own defaults. */
export function makeAnimationSpec(
  input: Partial<AnimationSpecInput> & { type: unknown },
  category?: AnimationCategory
): AnimationSpecInput {
  const type = normalizeSpecAnimationType(input.type);
  const defaults = getAnimationDefaults(type);
  const durationMs = Number.isFinite(input.durationMs as number)
    ? Math.max(1, Number(input.durationMs))
    : Math.max(1, defaults.durationMs);
  return {
    type,
    // Only a LOOP runs infinite; an entrance/exit is always one-shot.
    infinite:
      typeof input.infinite === "boolean"
        ? input.infinite && defaults.supportsInfinite
        : category === "LOOP" && defaults.supportsInfinite,
    durationMs,
    delayMs: Number.isFinite(input.delayMs as number)
      ? Math.max(0, Number(input.delayMs))
      : defaults.delayMs,
    direction: normalizeSpecDirection(input.direction ?? defaults.direction),
    easing: normalizeSpecEasing(input.easing ?? defaults.easing),
    intensity: Number.isFinite(input.intensity as number)
      ? Number(input.intensity)
      : defaults.intensity,
  };
}

function activeSlot(spec: AnimationSpecInput | null): AnimationSpecInput | null {
  if (!spec || spec.type === "NONE") return null;
  return spec;
}

/** The stored three-slot shape on an element. */
export interface EditorAnimationSlots {
  entrance: AnimationSpecInput | null;
  exit: AnimationSpecInput | null;
  loop: AnimationSpecInput | null;
}

const SLOT_CATEGORY: Record<keyof EditorAnimationSlots, AnimationCategory> = {
  entrance: "ENTRANCE",
  exit: "EXIT",
  loop: "LOOP",
};

export function emptyAnimationSlots(): EditorAnimationSlots {
  return { entrance: null, exit: null, loop: null };
}

export function isEmptyAnimationSlots(slots: EditorAnimationSlots | null | undefined): boolean {
  if (!slots) return true;
  return !activeSlot(slots.entrance) && !activeSlot(slots.exit) && !activeSlot(slots.loop);
}

/** Normalizes a stored/wire `animations` object, dropping empty or NONE slots. */
export function normalizeAnimationSlots(value: unknown): EditorAnimationSlots {
  const raw = (value ?? {}) as Partial<Record<keyof EditorAnimationSlots, unknown>>;
  const slots = emptyAnimationSlots();
  (Object.keys(SLOT_CATEGORY) as Array<keyof EditorAnimationSlots>).forEach((slot) => {
    const entry = raw[slot] as (Partial<AnimationSpecInput> & { type?: unknown }) | null | undefined;
    if (!entry || typeof entry !== "object" || entry.type === undefined) return;
    const spec = makeAnimationSpec({ ...entry, type: entry.type }, SLOT_CATEGORY[slot]);
    slots[slot] = spec.type === "NONE" ? null : spec;
  });
  return slots;
}

/**
 * The legacy single-animation fields an element may still carry. The web's legacy model has a
 * `mode` the app never had (IN / OUT / IN_OUT / LOOP), so migration here is richer than the
 * app's own `infinite ? loop : entrance`: an IN_OUT element genuinely meant "entrance AND exit",
 * and collapsing it to entrance alone would silently drop its exit.
 */
export interface LegacyAnimationFields {
  mediaAnimationType?: unknown;
  mediaAnimationMode?: unknown;
  mediaAnimationInfinite?: unknown;
  mediaAnimationDurationMs?: unknown;
  mediaAnimationOutDurationMs?: unknown;
  mediaAnimationDelayMs?: unknown;
  mediaAnimationDirection?: unknown;
  mediaAnimationEasing?: unknown;
  mediaAnimationIntensity?: unknown;
  animations?: unknown;
}

function legacyIsInfinite(fields: LegacyAnimationFields, type: string): boolean {
  if (!getAnimationDefaults(type).supportsInfinite) return false;
  const mode = String(fields.mediaAnimationMode ?? "").toUpperCase();
  if (mode === "LOOP") return true;
  const raw = fields.mediaAnimationInfinite;
  if (typeof raw === "boolean") return raw;
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  return false;
}

/**
 * The three slots for an element, migrating the legacy single-animation fields when the new
 * `animations` object is absent or empty. Mirrors `LayerModel.resolvedLayerAnimations()`.
 */
export function resolveElementAnimations(element: LegacyAnimationFields): EditorAnimationSlots {
  const stored = normalizeAnimationSlots(element.animations);
  if (!isEmptyAnimationSlots(stored)) return stored;

  const type = normalizeSpecAnimationType(element.mediaAnimationType);
  if (type === "NONE") return emptyAnimationSlots();

  const infinite = legacyIsInfinite(element, type);
  const base = {
    type,
    durationMs: element.mediaAnimationDurationMs as number | undefined,
    delayMs: element.mediaAnimationDelayMs as number | undefined,
    // The legacy CENTER direction has no spec equivalent and normalizes to DEFAULT.
    direction: element.mediaAnimationDirection,
    easing: element.mediaAnimationEasing,
    intensity: element.mediaAnimationIntensity as number | undefined,
  } as Partial<AnimationSpecInput> & { type: unknown };

  if (infinite) {
    return { ...emptyAnimationSlots(), loop: makeAnimationSpec({ ...base, infinite: true }, "LOOP") };
  }

  const mode = String(element.mediaAnimationMode ?? "IN").toUpperCase();
  const entrance = makeAnimationSpec({ ...base, infinite: false }, "ENTRANCE");
  // The exit leg may have carried its own (usually shorter) duration.
  const outDuration = Number(element.mediaAnimationOutDurationMs);
  const exit = makeAnimationSpec(
    {
      ...base,
      infinite: false,
      ...(Number.isFinite(outDuration) && outDuration > 0 ? { durationMs: outDuration } : {}),
    },
    "EXIT"
  );

  if (mode === "OUT") return { ...emptyAnimationSlots(), exit };
  if (mode === "IN_OUT") return { ...emptyAnimationSlots(), entrance, exit };
  return { ...emptyAnimationSlots(), entrance };
}

export function resolveTimelinePlaybackState(
  hidden: boolean,
  timelineStartMs: number,
  timelineEndMs: number,
  animations: LayerAnimations,
  playheadMs: number,
  totalDurationMs: number
): PlaybackState {
  const safePlayhead = Math.max(0, playheadMs);
  const safeTotal = Math.max(0, totalDurationMs);
  const safeStart = clamp(timelineStartMs, 0, safeTotal);
  const fallbackEnd = Math.max(safeStart, safeTotal);
  const safeEnd = Number.isFinite(timelineEndMs)
    ? Math.max(safeStart, timelineEndMs)
    : fallbackEnd;
  // The very last frame of the timeline still shows layers whose window ends exactly there,
  // otherwise the final frame renders empty.
  const isTimelineFinalFrame = safeTotal > 0 && safePlayhead >= safeTotal && safeEnd >= safeTotal;
  const isVisible =
    !hidden && safePlayhead >= safeStart && (safePlayhead < safeEnd || isTimelineFinalFrame);
  const localMs = Math.max(0, safePlayhead - safeStart);

  const entrance = activeSlot(animations.entrance);
  const exit = activeSlot(animations.exit);
  const loop = activeSlot(animations.loop);

  if (!isVisible || (!entrance && !exit && !loop)) {
    return {
      isVisible,
      localMs: isVisible ? localMs : 0,
      progress: isVisible ? 1 : 0,
      animation: null,
      isExiting: false,
    };
  }

  const layerDurationMs = Math.max(1, safeEnd - safeStart);
  const entDur = Math.min(
    layerDurationMs,
    entrance ? Math.max(1, entrance.durationMs + entrance.delayMs) : 0
  );
  const exitDur = Math.min(
    Math.max(0, layerDurationMs - entDur),
    exit ? Math.max(1, exit.durationMs) : 0
  );
  const exitStart = layerDurationMs - exitDur;

  // Exit — plays the reveal in reverse.
  if (exit && exitDur > 0 && localMs >= exitStart) {
    const p = clamp((localMs - exitStart) / exitDur, 0, 1);
    return { isVisible: true, localMs, progress: 1 - p, animation: exit, isExiting: true };
  }
  // Entrance — plays once at the start.
  if (entrance && entDur > 0 && localMs < entDur) {
    const delayed = Math.max(0, localMs - entrance.delayMs);
    const p = clamp(delayed / Math.max(1, entrance.durationMs), 0, 1);
    return { isVisible: true, localMs: delayed, progress: p, animation: entrance, isExiting: false };
  }
  // Loop — the continuous middle (honors the loop's own delay, after the entrance).
  if (loop) {
    const d = Math.max(1, loop.durationMs);
    const delayedMs = Math.max(0, localMs - entDur - loop.delayMs);
    const p = (delayedMs % d) / d;
    return { isVisible: true, localMs: delayedMs, progress: p, animation: loop, isExiting: false };
  }
  // Past the entrance with no loop — hold the entrance's final (shown) frame.
  return { isVisible: true, localMs, progress: 1, animation: entrance, isExiting: false };
}
