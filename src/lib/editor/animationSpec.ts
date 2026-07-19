/**
 * Typed access to `animationSpec.json` — the mobile app's animation system, exported from the
 * RUNTIME VALUES of its shared module. The app is the source of truth.
 *
 * REGENERATE, DO NOT HAND-EDIT: re-copy `docs/specs/animation-spec.json` from the mobile repo.
 * Everything here (catalog order, per-type defaults, labels, authored keyframes) is read from
 * that file so the two clients cannot silently drift.
 *
 * The 27 analytic effects (`formula.kotlin` in the JSON) are ported by hand in
 * `animationVisual.ts` — Kotlin can't be executed here. The 19 keyframe effects
 * (`authoredCurves`) are played straight from this data by `animationCurves.ts`.
 */
import rawSpec from "./animationSpec.json";
import type { AuthoredKeyframe } from "./animationCurves";

export type AnimationCategory = "ENTRANCE" | "EXIT" | "LOOP";

export type AnimationDirection =
  | "DEFAULT"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "CLOCKWISE"
  | "COUNTERCLOCKWISE";

export type AnimationEasing =
  | "DEFAULT"
  | "LINEAR"
  | "SOFT_OUT"
  | "SOFT_IN_OUT"
  | "EASE_IN"
  | "EASE_OUT"
  | "EASE_IN_OUT";

/** Channels the authored art animates. Translations are comp-relative (see COMP_PX). */
export type AuthoredChannel =
  | "opacity"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "rotation"
  | "translateX"
  | "translateY"
  | "maskProgress";

export interface AuthoredCurves {
  durationFrames: number;
  fps: number;
  durationMs: number;
  channels: Partial<Record<AuthoredChannel, AuthoredKeyframe[]>>;
}

export interface AnimationTypeDefault {
  durationMs: number;
  delayMs: number;
  direction: AnimationDirection;
  easing: AnimationEasing;
  intensity: number;
  supportsInfinite: boolean;
}

export interface AnimationTypeSpec {
  type: string;
  tabs: AnimationCategory[];
  default: AnimationTypeDefault;
  authoredCurves: AuthoredCurves | null;
  label: { ar: string; en: string; exit?: { ar: string; en: string } };
  formula?: { kotlin: string; sharesBranchWith?: string };
}

interface RawSpec {
  compPx: number;
  enums: { category: string[]; direction: string[]; easing: string[] };
  catalog: { entrance: string[]; exit: string[]; loop: string[] };
  types: AnimationTypeSpec[];
}

const spec = rawSpec as unknown as RawSpec;

/** Authored translations are fractions of a 700px comp — scale by layerSize / COMP_PX. */
export const COMP_PX = spec.compPx;

export const ANIMATION_DIRECTIONS = spec.enums.direction as AnimationDirection[];
export const ANIMATION_EASINGS = spec.enums.easing as AnimationEasing[];
export const ANIMATION_CATEGORIES = spec.enums.category as AnimationCategory[];

/** Tile order per tab, exactly as the app presents it. Index 0 is the first tile. */
export const ANIMATION_CATALOG: Record<AnimationCategory, string[]> = {
  ENTRANCE: spec.catalog.entrance,
  EXIT: spec.catalog.exit,
  LOOP: spec.catalog.loop,
};

const TYPES_BY_NAME = new Map<string, AnimationTypeSpec>(
  spec.types.map((entry) => [entry.type, entry])
);

export const ANIMATION_TYPES = spec.types;

/** Every known type, including the enum-only ones (`tabs: []`) kept for old projects. */
export const ANIMATION_TYPE_NAMES: string[] = spec.types.map((entry) => entry.type);

export function getAnimationTypeSpec(type: unknown): AnimationTypeSpec | null {
  return TYPES_BY_NAME.get(String(type ?? "").toUpperCase()) ?? null;
}

/** Normalizes an unknown wire/stored value to a known type, falling back to NONE. */
export function normalizeSpecAnimationType(value: unknown): string {
  const next = String(value ?? "NONE").toUpperCase();
  return TYPES_BY_NAME.has(next) ? next : "NONE";
}

export function normalizeSpecDirection(value: unknown): AnimationDirection {
  const next = String(value ?? "DEFAULT").toUpperCase();
  return (ANIMATION_DIRECTIONS as string[]).includes(next)
    ? (next as AnimationDirection)
    : "DEFAULT";
}

export function normalizeSpecEasing(value: unknown): AnimationEasing {
  const next = String(value ?? "DEFAULT").toUpperCase();
  return (ANIMATION_EASINGS as string[]).includes(next) ? (next as AnimationEasing) : "DEFAULT";
}

/** The preset applied when a user picks the effect. */
export function getAnimationDefaults(type: unknown): AnimationTypeDefault {
  const entry = getAnimationTypeSpec(type);
  return (
    entry?.default ?? {
      durationMs: 0,
      delayMs: 0,
      direction: "DEFAULT",
      easing: "LINEAR",
      intensity: 1,
      supportsInfinite: false,
    }
  );
}

/**
 * Tile label. DISSOLVE reads "نزول / Descend" on entry and "اندثار / Dissolve" on exit —
 * the only type whose label depends on the slot.
 */
export function getAnimationLabel(
  type: unknown,
  locale: "ar" | "en" = "en",
  category: AnimationCategory = "ENTRANCE"
): string {
  const entry = getAnimationTypeSpec(type);
  if (!entry) return String(type ?? "");
  if (category === "EXIT" && entry.label.exit) return entry.label.exit[locale];
  return entry.label[locale];
}

export function isAnimationOfferedIn(type: unknown, category: AnimationCategory): boolean {
  const entry = getAnimationTypeSpec(type);
  return Boolean(entry?.tabs.includes(category));
}

export function supportsInfinite(type: unknown): boolean {
  return getAnimationDefaults(type).supportsInfinite;
}

export function getAuthoredCurves(type: unknown): AuthoredCurves | null {
  return getAnimationTypeSpec(type)?.authoredCurves ?? null;
}
