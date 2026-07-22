/**
 * Web↔mobile parity for the glyph / typewriter math (the "Phase 2" text effects). Golden is
 * generated from the mobile Kotlin runtime; the web port must reproduce it exactly — including
 * Arabic word/glyph counts, the per-glyph stagger, and the typewriter char offsets.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getAnimationDefaults } from "./animationSpec";
import {
  glyphMotionIndices,
  glyphVisual,
  revealedCharOffset,
  type TextRevealMode,
} from "./animationGlyph";
import golden from "./__fixtures__/mobileGlyphGolden.json";

const TOL = 0.005;
const near = (a: number, b: number, w: string) =>
  assert.ok(Math.abs(a - b) <= TOL, `${w}: web=${a} mobile=${b}`);

type IdxRow = { text: string; glyphCount: number; wordCount: number; glyphOrdinal: number[]; wordOrdinal: number[] };
type GlyphRow = { text: string; type: string; p: number; ci: number; alpha: number; ty: number; scale: number };
type TwRow = { text: string; mode: string; p: number; offset: number };

const g = golden as { glyph: GlyphRow[]; typewriter: TwRow[]; indices: IdxRow[] };

test("glyphMotionIndices matches mobile (incl. Arabic word/glyph counts)", () => {
  for (const row of g.indices) {
    const idx = glyphMotionIndices(row.text);
    assert.equal(idx.glyphCount, row.glyphCount, `${row.text} glyphCount`);
    assert.equal(idx.wordCount, row.wordCount, `${row.text} wordCount`);
    assert.deepEqual(idx.glyphOrdinal, row.glyphOrdinal, `${row.text} glyphOrdinal`);
    assert.deepEqual(idx.wordOrdinal, row.wordOrdinal, `${row.text} wordOrdinal`);
  }
});

// One test per glyph type so a failure names the effect.
const glyphByType = new Map<string, GlyphRow[]>();
for (const row of g.glyph) (glyphByType.get(row.type) ?? glyphByType.set(row.type, []).get(row.type)!).push(row);

for (const [type, rows] of glyphByType) {
  test(`glyphVisual matches mobile — ${type} (${rows.length} samples)`, () => {
    for (const row of rows) {
      const idx = glyphMotionIndices(row.text);
      const glyph = idx.glyphOrdinal[row.ci];
      // The golden only emits inked chars (mobile visualFor returns null for whitespace).
      assert.ok(glyph >= 0, `${type} ${row.text}@${row.ci}: golden row for whitespace?`);
      const dur = getAnimationDefaults(type).durationMs;
      const v = glyphVisual(type, row.p, dur, glyph, idx.glyphCount, idx.wordOrdinal[row.ci], idx.wordCount);
      assert.ok(v, `${type} ${row.text}@${row.ci}: web returned null`);
      near(v!.alpha, row.alpha, `${type} ${row.text}@${row.ci} alpha`);
      near(v!.translateYEm, row.ty, `${type} ${row.text}@${row.ci} ty`);
      near(v!.scale, row.scale, `${type} ${row.text}@${row.ci} scale`);
    }
  });
}

test("typewriter revealedCharOffset matches mobile across modes", () => {
  for (const row of g.typewriter) {
    const offset = revealedCharOffset(row.p, row.mode as TextRevealMode, 2000, row.text);
    assert.equal(offset, row.offset, `${row.mode} "${row.text}" @${row.p}`);
  }
});
