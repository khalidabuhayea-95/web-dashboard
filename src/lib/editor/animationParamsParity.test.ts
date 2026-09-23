/**
 * Web↔mobile parity for round 2 of the Canva port (docs/canva-animation-parity.md §8.6): the
 * params-driven formulas, ramps, concurrent composition, text units and per-unit visuals.
 *
 * `__fixtures__/mobileAnimationParamsGolden.json` is generated FROM the app's Kotlin (a throwaway
 * test in the mobile repo), numbers rounded to 4 dp:
 *   visual     [{k, spec, p, exiting, w, h, layerIndex, out}]          — resolveAnimationVisualState
 *   timeline   [{k, slots, layerDurationMs, localMs, w, h, layerIndex, out}]
 *                                                  — resolveTimelinePlaybackState + the composed visual
 *   units      [{k, text, unit, lines, out: {graphemes, unitOfGrapheme, unitCount}}] — canvaTextUnits
 *   unitVisual [{k, type, unit, fill, intensity, seed, durationMs, exiting, p, unitIndex, unitCount,
 *                out: {alpha, blurEm, scale, elementScale}}]        — canvaUnitVisual / ElementScale
 * `out` of the first two carries the same fields as mobileAnimationGolden rows. Until the app has
 * produced the fixture, every test here SKIPS with a message instead of failing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { normalizeAnimationParams, resolveTimelinePlaybackState } from "./animationSlots";
import { canvaTextUnits, canvaUnitElementScale, canvaUnitVisual } from "./animationCanvaUnits";
import { getAnimationDefaults, normalizeSpecDirection, normalizeSpecEasing } from "./animationSpec";
import {
  resolveAnimationVisualState,
  resolvePlaybackVisualState,
  type AnimationSpecInput,
  type AnimationVisualState,
} from "./animationVisual";

const TOL = 0.005; // the golden is rounded to 4 dp; real drift is far larger.

/** `MOBILE_PARAMS_GOLDEN` points the replay at another copy (e.g. straight out of the app's build). */
const FIXTURE =
  process.env.MOBILE_PARAMS_GOLDEN ??
  path.join(__dirname, "__fixtures__", "mobileAnimationParamsGolden.json");

type Json = Record<string, unknown>;

interface ParamsGolden {
  visual?: Json[];
  timeline?: Json[];
  units?: Json[];
  unitVisual?: Json[];
}

function loadGolden(): ParamsGolden | null {
  if (!fs.existsSync(FIXTURE)) return null;
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as ParamsGolden;
}

const golden = loadGolden();
const MISSING =
  "mobileAnimationParamsGolden.json is not generated yet — the app's throwaway golden test writes it (§8.6)";

function near(web: number, mobile: number, what: string) {
  assert.ok(
    Number.isFinite(web) && Math.abs(web - mobile) <= TOL,
    `${what}: web=${web} mobile=${mobile} (Δ=${Math.abs(web - mobile)})`
  );
}

/** A golden spec as the app fed it — NOT re-normalized (an infinite flag stays as given). */
function specFrom(raw: unknown): AnimationSpecInput | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Json;
  const type = String(input.type ?? "NONE").toUpperCase();
  if (type === "NONE") return null;
  const defaults = getAnimationDefaults(type);
  const params = normalizeAnimationParams(input.params);
  return {
    type,
    infinite: Boolean(input.infinite),
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : defaults.durationMs,
    delayMs: Number.isFinite(Number(input.delayMs)) ? Number(input.delayMs) : defaults.delayMs,
    direction: normalizeSpecDirection(input.direction ?? defaults.direction),
    easing: normalizeSpecEasing(input.easing ?? defaults.easing),
    intensity: Number.isFinite(Number(input.intensity)) ? Number(input.intensity) : defaults.intensity,
    ...(params ? { params } : {}),
  };
}

function compareOptionalFields(web: Json | null, mobile: Json | null, what: string, skip: string[] = []) {
  if (mobile === null || mobile === undefined) {
    assert.equal(web, null, `${what}: mobile null, web=${JSON.stringify(web)}`);
    return;
  }
  assert.ok(web, `${what}: mobile ${JSON.stringify(mobile)}, web null`);
  for (const [key, value] of Object.entries(mobile)) {
    if (skip.includes(key) || value === null || value === undefined) continue;
    const mine: unknown = (web as Json)[key];
    if (typeof value === "number") near(Number(mine ?? (key.endsWith("Fraction") ? 0 : NaN)), value, `${what}.${key}`);
    else if (typeof value === "boolean") assert.equal(Boolean(mine), value, `${what}.${key}`);
    else if (typeof value === "string") assert.equal(String(mine), value, `${what}.${key}`);
  }
}

/** Compares a visual state with a golden `out` (the mobileAnimationGolden row fields). */
function compareVisual(state: AnimationVisualState, out: Json, at: string) {
  near(state.scaleMultiplier, Number(out.s), `${at} scale`);
  near(state.scaleXMultiplier, Number(out.sx), `${at} scaleX`);
  near(state.scaleYMultiplier, Number(out.sy), `${at} scaleY`);
  near(state.rotationDeltaDegrees, Number(out.rot), `${at} rot`);
  near(state.translationX, Number(out.tx), `${at} tx`);
  near(state.translationY, Number(out.ty), `${at} ty`);
  near(state.alphaMultiplier, Number(out.a), `${at} alpha`);
  near(state.blurRadiusPx, Number(out.blur), `${at} blur`);

  const mask = (out.mask ?? null) as Json | null;
  if (mask === null) {
    assert.equal(state.revealMask, null, `${at} mask: mobile null, web ${JSON.stringify(state.revealMask)}`);
  } else {
    assert.ok(state.revealMask, `${at} mask: mobile ${mask.kind}, web null`);
    assert.equal(state.revealMask.kind, mask.kind, `${at} mask.kind`);
    const webMask = state.revealMask as unknown as Json;
    const withDefaults: Json = {
      ...webMask,
      ...(webMask.kind === "WIPE" ? { edge: webMask.edge ?? "LEFT", anchored: Boolean(webMask.anchored) } : {}),
    };
    compareOptionalFields(withDefaults, mask, `${at} mask`, ["kind"]);
  }
  const text = (out.text ?? null) as Json | null;
  if (text === null) assert.equal(state.textReveal, null, `${at} text: mobile null`);
  else compareOptionalFields(state.textReveal as unknown as Json, text, `${at} text`);

  const glyph = (out.glyph ?? null) as Json | null;
  if (glyph === null) {
    assert.equal(state.glyphMotion, null, `${at} glyph: mobile null, web ${JSON.stringify(state.glyphMotion)}`);
  } else {
    assert.ok(state.glyphMotion, `${at} glyph: mobile present, web null`);
    assert.equal(state.glyphMotion.type, glyph.type, `${at} glyph.type`);
    near(state.glyphMotion.progress, Number(glyph.progress), `${at} glyph.progress`);
    // The app nests the writing-style fields under `canva` (rest values default 1 / 1 / 0 without
    // a concurrent loop); the web keeps them flat and only sets rest values under one.
    const extra = { ...glyph, ...((glyph.canva as Json | undefined) ?? {}) };
    const webGlyph = { restAlpha: 1, restScale: 1, restBlurPx: 0, ...state.glyphMotion } as unknown as Json;
    compareOptionalFields(webGlyph, extra, `${at} glyph`, ["type", "progress", "canva"]);
  }
  compareOptionalFields(
    state.overlayBar as unknown as Json | null,
    (out.bar ?? null) as Json | null,
    `${at} bar`
  );
}

function slotsFrom(raw: unknown) {
  const slots = (raw ?? {}) as Json;
  return {
    entrance: specFrom(slots.entrance),
    exit: specFrom(slots.exit),
    loop: specFrom(slots.loop),
  };
}

function groupByType(rows: Json[], keyOf: (row: Json) => string) {
  const groups = new Map<string, Json[]>();
  for (const row of rows) {
    const key = keyOf(row);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  return groups;
}

if (!golden) {
  test(`web matches mobile — round-2 params golden (${MISSING})`, { skip: MISSING }, () => {});
} else {
  const visualRows = golden.visual ?? [];
  for (const [type, rows] of groupByType(visualRows, (row) => String((row.spec as Json)?.type ?? row.k).split("|")[0])) {
    test(`web matches mobile — ${type} with params (${rows.length} samples)`, () => {
      for (const row of rows) {
        const spec = specFrom(row.spec);
        assert.ok(spec, `${row.k}: unreadable spec`);
        const state = resolveAnimationVisualState(
          spec,
          Number(row.p),
          Number(row.w),
          Number(row.h),
          Boolean(row.exiting),
          Number(row.layerIndex ?? 0)
        );
        compareVisual(state, row.out as Json, String(row.k));
      }
    });
  }

  const timelineRows = golden.timeline ?? [];
  if (timelineRows.length > 0) {
    test(`web matches mobile — concurrent timeline and composition (${timelineRows.length} samples)`, () => {
      for (const row of timelineRows) {
        const duration = Number(row.layerDurationMs);
        const playback = resolveTimelinePlaybackState(
          false,
          0,
          duration,
          slotsFrom(row.slots),
          Number(row.localMs),
          duration
        );
        const state = resolvePlaybackVisualState(
          playback,
          Number(row.w),
          Number(row.h),
          Number(row.layerIndex ?? 0)
        );
        compareVisual(state, row.out as Json, String(row.k));
      }
    });
  }

  const unitRows = golden.units ?? [];
  if (unitRows.length > 0) {
    test(`web matches mobile — text units (${unitRows.length} texts)`, () => {
      for (const row of unitRows) {
        const lines = Array.isArray(row.lines) ? (row.lines as number[]) : null;
        const units = canvaTextUnits(String(row.text), Number(row.unit), lines);
        const out = row.out as Json;
        if (Array.isArray(out.graphemes)) assert.deepEqual(units.graphemes, out.graphemes, `${row.k} graphemes`);
        else assert.equal(units.graphemes.length, Number(out.graphemes), `${row.k} grapheme count`);
        assert.deepEqual(units.unitOfGrapheme, out.unitOfGrapheme, `${row.k} unitOfGrapheme`);
        assert.equal(units.unitCount, Number(out.unitCount), `${row.k} unitCount`);
      }
    });
  }

  const unitVisualRows = golden.unitVisual ?? [];
  for (const [type, rows] of groupByType(unitVisualRows, (row) => String(row.type))) {
    test(`web matches mobile — ${type} per unit (${rows.length} samples)`, () => {
      for (const row of rows) {
        const seed = row.seed === null || row.seed === undefined ? null : Number(row.seed);
        const args = [
          String(row.type),
          Number(row.unit),
          Boolean(row.fill),
          Number(row.intensity),
          seed,
          Number(row.durationMs),
          Boolean(row.exiting),
          Number(row.p),
        ] as const;
        const visual = canvaUnitVisual(...args, Number(row.unitIndex), Number(row.unitCount));
        const out = row.out as Json;
        near(visual.alpha, Number(out.alpha), `${row.k} alpha`);
        near(visual.blurEm, Number(out.blurEm), `${row.k} blurEm`);
        near(visual.scale, Number(out.scale), `${row.k} scale`);
        if (out.elementScale !== undefined) {
          near(canvaUnitElementScale(...args, Number(row.unitCount)), Number(out.elementScale), `${row.k} elementScale`);
        }
      }
    });
  }

  test("the params golden covers every round-2 family", () => {
    assert.ok(visualRows.length > 0, "no visual rows");
    assert.ok(timelineRows.length > 0, "no timeline rows");
    assert.ok(unitRows.length > 0, "no unit rows");
    assert.ok(unitVisualRows.length > 0, "no per-unit rows");
  });
}
