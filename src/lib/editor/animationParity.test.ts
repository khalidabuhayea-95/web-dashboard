/**
 * Full web↔mobile parity: the mobile app's LayerAnimationVisualRuntime is the source of truth.
 *
 * `__fixtures__/mobileAnimationGolden.json` is generated FROM the mobile Kotlin runtime — every
 * LayerAnimationType sampled across { infinite×{f,t} } × { exiting×{f,t} } × 5 progresses × 2
 * sizes (2000 rows), at layerIndex GOLDEN_LAYER_INDEX. This test feeds the identical grid through
 * the web port and asserts every field matches. If a formula, an easing, a reveal mask (its
 * anchored edge included), a glyph channel or the BLOCK bar drifts from mobile, exactly one row
 * fails and names the type.
 *
 * CAVEAT — the fixture is a SNAPSHOT, so it only proves parity with mobile as of its capture.
 * Mobile once added DISSOLVE's blur AFTER a capture and the stale rows kept passing against a web
 * port that had no blur at all — a green suite hid a real difference for weeks. Regenerate the
 * whole fixture from the mobile runtime whenever its animation code changes: a throwaway JUnit
 * test in the mobile repo (shared/src/androidUnitTest/.../tmpgolden/) that walks this exact grid
 * through resolveLayerAnimationVisualState(playback, w, h, layerIndex) and dumps raw rows, then a
 * script that rounds every number to 4 dp (last regenerated 2026-09-23, Canva parity pass).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getAnimationDefaults } from "./animationSpec";
import {
  resolveAnimationVisualState,
  type AnimationSpecInput,
  type AnimationVisualState,
} from "./animationVisual";
import golden from "./__fixtures__/mobileAnimationGolden.json";

const TOL = 0.005; // golden is rounded to 4dp; real drift is >>this.

/**
 * The z-index every golden row was sampled at (TmpGoldenTest on the mobile side passes the same
 * constant). Index parity steers TUMBLE's side, SCRAPBOOK's stamp signs and NEON's intro/outro
 * schedule, so both platforms must be fed the identical value.
 */
const GOLDEN_LAYER_INDEX = 0;

type GoldenRow = {
  k: string;
  s: number; sx: number; sy: number; rot: number; tx: number; ty: number; a: number; blur: number;
  mask: null | {
    kind: string;
    progress: number;
    featherFraction?: number;
    startAngleDegrees?: number;
    edge?: string;
    anchored?: boolean;
  };
  text: null | { progress: number; mode: string; durationMs: number };
  glyph: null | { type: string; progress: number; durationMs: number };
  bar: null | {
    leftFraction: number;
    widthFraction: number;
    topFraction?: number;
    heightFraction?: number;
  };
};

function near(a: number, b: number, what: string) {
  assert.ok(Math.abs(a - b) <= TOL, `${what}: web=${a} mobile=${b} (Δ=${Math.abs(a - b)})`);
}

function compareObj(
  web: Record<string, number> | null,
  mob: Record<string, number> | null,
  fields: string[],
  what: string
) {
  if (mob === null) {
    assert.equal(web, null, `${what}: mobile null, web=${JSON.stringify(web)}`);
    return;
  }
  assert.ok(web !== null, `${what}: mobile ${JSON.stringify(mob)}, web null`);
  for (const f of fields) near((web as Record<string, number>)[f] ?? 0, mob[f] ?? 0, `${what}.${f}`);
}

const rows = golden as GoldenRow[];

// One node:test per TYPE, so a failure names the effect. Group rows by their leading type token.
const byType = new Map<string, GoldenRow[]>();
for (const row of rows) {
  const type = row.k.split("|")[0];
  (byType.get(type) ?? byType.set(type, []).get(type)!).push(row);
}

for (const [type, typeRows] of byType) {
  test(`web matches mobile — ${type} (${typeRows.length} samples)`, () => {
    for (const row of typeRows) {
      const [, infinite, exiting, progress, w, h] = row.k.split("|");
      const d = getAnimationDefaults(type);
      const spec: AnimationSpecInput = {
        type,
        infinite: infinite === "true",
        durationMs: d.durationMs,
        delayMs: d.delayMs,
        direction: d.direction,
        easing: d.easing,
        intensity: d.intensity,
      };
      const st: AnimationVisualState = resolveAnimationVisualState(
        spec,
        Number(progress),
        Number(w),
        Number(h),
        exiting === "true",
        GOLDEN_LAYER_INDEX
      );
      const at = `${row.k}`;
      near(st.scaleMultiplier, row.s, `${at} scale`);
      near(st.scaleXMultiplier, row.sx, `${at} scaleX`);
      near(st.scaleYMultiplier, row.sy, `${at} scaleY`);
      near(st.rotationDeltaDegrees, row.rot, `${at} rot`);
      near(st.translationX, row.tx, `${at} tx`);
      near(st.translationY, row.ty, `${at} ty`);
      near(st.alphaMultiplier, row.a, `${at} alpha`);
      near(st.blurRadiusPx, row.blur, `${at} blur`);

      // revealMask
      if (row.mask === null) {
        assert.equal(st.revealMask, null, `${at} mask: mobile null web=${JSON.stringify(st.revealMask)}`);
      } else {
        assert.ok(st.revealMask, `${at} mask: mobile ${row.mask.kind}, web null`);
        assert.equal(st.revealMask!.kind, row.mask.kind, `${at} mask.kind`);
        near((st.revealMask as { progress: number }).progress, row.mask.progress, `${at} mask.progress`);
        if (row.mask.kind === "RADIAL") {
          near((st.revealMask as { startAngleDegrees: number }).startAngleDegrees, row.mask.startAngleDegrees!, `${at} mask.angle`);
        } else {
          near((st.revealMask as { featherFraction: number }).featherFraction, row.mask.featherFraction!, `${at} mask.feather`);
        }
        if (row.mask.kind === "WIPE") {
          // Mobile always carries an edge (LEFT by default); the web leaves the default implicit.
          const webEdge = (st.revealMask as { edge?: string }).edge ?? "LEFT";
          assert.equal(webEdge, row.mask.edge, `${at} mask.edge`);
          // §8.3 item 2: rows generated after the anchored-mask change carry the flag.
          if (row.mask.anchored !== undefined) {
            const webAnchored = Boolean((st.revealMask as { anchored?: boolean }).anchored);
            assert.equal(webAnchored, row.mask.anchored, `${at} mask.anchored`);
          }
        }
      }
      // textReveal
      if (row.text === null) assert.equal(st.textReveal, null, `${at} text: mobile null`);
      else {
        assert.ok(st.textReveal, `${at} text: mobile present, web null`);
        assert.equal(st.textReveal!.mode, row.text.mode, `${at} text.mode`);
        near(st.textReveal!.progress, row.text.progress, `${at} text.progress`);
        assert.equal(st.textReveal!.durationMs, row.text.durationMs, `${at} text.durationMs`);
      }
      // glyphMotion
      if (row.glyph === null) assert.equal(st.glyphMotion, null, `${at} glyph: mobile null`);
      else {
        assert.ok(st.glyphMotion, `${at} glyph: mobile present, web null`);
        assert.equal(st.glyphMotion!.type, row.glyph.type, `${at} glyph.type`);
        near(st.glyphMotion!.progress, row.glyph.progress, `${at} glyph.progress`);
      }
      // overlayBar (BLOCK)
      // §8.3 item 3 added topFraction/heightFraction (the full-box bar); older rows lack them.
      compareObj(
        st.overlayBar as unknown as Record<string, number> | null,
        row.bar as unknown as Record<string, number> | null,
        row.bar ? Object.keys(row.bar).filter((key) => key.endsWith("Fraction")) : [],
        `${at} bar`
      );
    }
  });
}

test("golden covers every offered type at least once", () => {
  const covered = new Set([...byType.keys()]);
  for (const type of ["SHIFT", "SKATE", "ASCEND", "BLOCK", "RISE", "PAN", "BLUR"]) {
    assert.ok(covered.has(type), `golden missing ${type}`);
  }
  assert.ok(rows.length >= 1000, `expected a dense grid, got ${rows.length}`);
});
