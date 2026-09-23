/**
 * Keeps an imported animation inside the tab it lands in.
 *
 * Canva's effects do not line up one-for-one with ours, so the importer maps each of its presets
 * onto the closest thing we have. That mapping ignored WHICH tab the result belongs to, and the
 * three tabs are not interchangeable: Drift and Tectonic are Loop and Exit effects here, never
 * entrances, and the typewriter family only ever enters. A Canva entrance mapped onto one of those
 * therefore landed in the Entrance slot holding an effect that tab does not offer. The editor could
 * not show it as selected, and the app was handed an entrance it does not list either.
 *
 * So the mapping happens in two steps now: the importer picks the closest effect by FEEL, and this
 * picks the closest effect that tab actually offers. Playback is not gated on the catalogs — an old
 * project holding one of these still renders — so this runs at IMPORT time only. It never rewrites
 * a choice a designer made by hand, because the picker can only ever offer legal types.
 *
 * Canva's own enter/exit family (docs/canva-animation-parity.md §7) is offered in the tabs Canva
 * offers it in, so Pan, Blur, Baseline, Tumble, Neon, Scrapbook and Stomp are entrances in their
 * own right and Pop, Baseline, Neon and Scrapbook are exits: an imported Canva animation keeps its
 * own effect there instead of being swapped for a look-alike.
 */
import { ANIMATION_CATALOG, type AnimationCategory } from "./animationSpec";

/**
 * The nearest effect in each tab, for the types that tab does not offer.
 *
 * Read these as "what this motion becomes when it has to happen on the way in / on the way out /
 * over and over". A drift or a pan arrives by sliding. A stomp or a tumble arrives with a pop,
 * because the impact is the part worth keeping. A drop arrives as Ascend, the per-word rise.
 */
const ENTRANCE_SUBSTITUTES: Record<string, string> = {
  // The Canva family is not here: the Entrance tab offers Rise, Pan, Succession, Blur, Baseline,
  // Tumble, Neon, Scrapbook and Stomp now, so an imported Canva entrance keeps its own effect
  // instead of being swapped for a look-alike (ASCEND is the per-WORD rise — a different motion,
  // and one that does nothing at all on a layer that is not text).
  DROP: "ASCEND",
  SHIFT: "SLIDE",
  SKATE: "SLIDE",
  DRIFT: "SLIDE",
  TECTONIC: "SLIDE",
  PULSE: "POP",
  BOUNCE: "POP",
  WAVE: "POP",
  SHAKE: "POP",
  WOBBLE: "POP",
  WIGGLE: "POP",
  ROTATE: "POP",
  RANDOM: "POP",
  BREATHE: "ZOOM",
  ZOOM_LOOP: "ZOOM",
  FLICKER: "DISSOLVE",
  CH_WIGGLE_Y: "CH_POSITION_FADE",
};

const EXIT_SUBSTITUTES: Record<string, string> = {
  // Pop, Baseline, Neon and Scrapbook are exits now (Canva offers them on the way out), so they
  // keep their own effect and are not listed here.
  BREATHE: "ZOOM",
  PULSE: "ZOOM",
  BOUNCE: "ZOOM",
  ZOOM_LOOP: "ZOOM",
  DROP: "RISE",
  FLICKER: "DISSOLVE",
  WAVE: "FADE",
  SHAKE: "FADE",
  WOBBLE: "FADE",
  WIGGLE: "FADE",
  ROTATE: "FADE",
  RANDOM: "FADE",
  TYPEWRITER_CHARS: "FADE",
  TYPEWRITER_CURSOR: "FADE",
  TYPEWRITER_WORDS: "FADE",
  ONE_WORD: "FADE",
  CH_POSITION_FADE: "FADE",
  CH_SCALE_FADE: "FADE",
  CH_WIGGLE_Y: "FADE",
};

const LOOP_SUBSTITUTES: Record<string, string> = {
  POP: "PULSE",
  FADE: "PULSE",
  DISSOLVE: "FLICKER",
  BLOCK: "PULSE",
  WIPE: "PULSE",
  GRADIENT_WIPE: "PULSE",
  CIRCUAL: "PULSE",
  CIRCUAL_GRADIENT: "PULSE",
  RADIAL: "PULSE",
  RADIAL_GRADIENT: "PULSE",
  ZOOM: "ZOOM_LOOP",
  ZOOM_FADE: "ZOOM_LOOP",
  SLIDE: "PAN",
  DROP: "RISE",
  ASCEND: "RISE",
  TYPEWRITER_CHARS: "CH_WIGGLE_Y",
  TYPEWRITER_CURSOR: "CH_WIGGLE_Y",
  TYPEWRITER_WORDS: "CH_WIGGLE_Y",
  ONE_WORD: "CH_WIGGLE_Y",
  CH_POSITION_FADE: "CH_WIGGLE_Y",
  CH_SCALE_FADE: "CH_WIGGLE_Y",
};

const SUBSTITUTES: Record<AnimationCategory, Record<string, string>> = {
  ENTRANCE: ENTRANCE_SUBSTITUTES,
  EXIT: EXIT_SUBSTITUTES,
  LOOP: LOOP_SUBSTITUTES,
};

/** Where an unrecognised effect ends up, so the slot always holds something the tab offers. */
const FALLBACKS: Record<AnimationCategory, string> = {
  ENTRANCE: "FADE",
  EXIT: "FADE",
  LOOP: "PULSE",
};

function offers(category: AnimationCategory, type: string): boolean {
  return ANIMATION_CATALOG[category].includes(type);
}

/**
 * The nearest effect the given tab actually offers. A type the tab already offers is returned
 * untouched, and NONE stays NONE everywhere.
 */
export function fitAnimationTypeToCategory(type: unknown, category: AnimationCategory): string {
  const normalized = String(type || "").trim().toUpperCase();
  if (!normalized || normalized === "NONE") return "NONE";
  if (offers(category, normalized)) return normalized;

  const substitute = SUBSTITUTES[category][normalized];
  if (substitute && offers(category, substitute)) return substitute;
  return FALLBACKS[category];
}

/** The tab a legacy `mediaAnimationMode` puts an effect in. */
export function categoryForLegacyMode(mode: unknown, infinite?: unknown): AnimationCategory {
  if (infinite === true) return "LOOP";
  const normalized = String(mode || "IN").trim().toUpperCase();
  if (normalized === "LOOP") return "LOOP";
  if (normalized === "OUT") return "EXIT";
  return "ENTRANCE";
}

/**
 * Walks an imported design and moves every animation onto an effect its own tab offers.
 *
 * The shape varies by import path (pages, a flat mirror, fabric objects), so this looks for the
 * animation fields themselves rather than for a particular container. Returns how many layers it
 * had to change, which the import log reports.
 */
export function fitImportedAnimationsToCategories(data: unknown): number {
  let changed = 0;

  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const layer = node as Record<string, unknown>;

    // The three-slot shape: each slot is fitted against its own tab. A spec's `params` are Canva's
    // exact numbers FOR ITS TYPE (docs/canva-animation-parity.md §8.1): they stay with a type that
    // is kept and go with one that is swapped for a look-alike, which would misread them.
    const slots = layer.animations as
      | Record<string, { type?: unknown; params?: unknown }>
      | null
      | undefined;
    if (slots && typeof slots === "object" && !Array.isArray(slots)) {
      for (const [slot, category] of [
        ["entrance", "ENTRANCE"],
        ["exit", "EXIT"],
        ["loop", "LOOP"],
      ] as Array<[string, AnimationCategory]>) {
        const spec = slots[slot];
        if (!spec || typeof spec !== "object" || spec.type === undefined) continue;
        const fitted = fitAnimationTypeToCategory(spec.type, category);
        if (fitted !== String(spec.type || "").trim().toUpperCase()) {
          spec.type = fitted;
          delete spec.params;
          changed += 1;
        }
      }
    }

    // The legacy single-animation shape, which is what the Canva extension sends.
    if (layer.mediaAnimationType !== undefined) {
      const category = categoryForLegacyMode(layer.mediaAnimationMode, layer.mediaAnimationInfinite);
      const original = String(layer.mediaAnimationType || "").trim().toUpperCase();
      const fitted = fitAnimationTypeToCategory(original, category);
      if (fitted !== original) {
        layer.mediaAnimationType = fitted;
        changed += 1;
      }
      // IN_OUT plays the SAME effect both ways, so the type has to suit both tabs. When the
      // entrance fit is not an exit effect, the exit leg is dropped rather than stored illegal.
      const mode = String(layer.mediaAnimationMode || "").trim().toUpperCase();
      if (mode === "IN_OUT" && !ANIMATION_CATALOG.EXIT.includes(fitted)) {
        layer.mediaAnimationMode = "IN";
        delete layer.mediaAnimationOutDurationMs;
      }
    }

    for (const value of Object.values(layer)) visit(value, depth + 1);
  };

  visit(data, 0);
  return changed;
}
