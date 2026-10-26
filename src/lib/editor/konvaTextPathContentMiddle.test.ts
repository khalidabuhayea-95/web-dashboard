/**
 * Curved glyphs drawn so the middle of the font's ascent–descent box rides the arc.
 *
 *   node --import tsx --test src/lib/editor/konvaTextPathContentMiddle.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// The helper sits in a module that installs canvas patches on import, so evaluate just its block.
const source = fs.readFileSync(path.join(process.cwd(), "src/lib/editor/konvaTextPatches.ts"), "utf8");
const start = source.indexOf("// ── konva-textpath-content-middle:start");
const end = source.indexOf("// ── konva-textpath-content-middle:end");
assert.ok(start >= 0 && end > start, "konva-textpath-content-middle markers missing");
const js = source
  .slice(start, end)
  .replace(/type GlyphBoxMetrics = \{[\s\S]*?\};/, "")
  .replace(/export function/g, "function")
  .replace("(metrics: GlyphBoxMetrics | null | undefined): number", "(metrics)");
const context = vm.createContext({});
vm.runInContext(`${js}\nthis.offset = contentMiddleGlyphOffset;`, context);
const offset = (metrics: unknown) => context.offset(metrics) as number;

test("DAHNZVrSYZM's kashida face: the box middle sits 10.4 px below Konva's em middle", () => {
  // YADK4JLT5uI_0 at 118.97 px, measured on the "middle" baseline Konva's TextPath draws with.
  assert.equal(Math.round(offset({ fontBoundingBoxAscent: 103.41, fontBoundingBoxDescent: 82.59 }) * 100) / 100, 10.41);
  // On the alphabetic baseline the same face gives the app's baselineShiftPx: (122 - 64) / 2.
  assert.equal(offset({ fontBoundingBoxAscent: 122, fontBoundingBoxDescent: 64 }), 29);
});

test("a face whose box is centred on the baseline does not move", () => {
  assert.equal(offset({ fontBoundingBoxAscent: 40, fontBoundingBoxDescent: 40 }), 0);
});

test("ink metrics stand in when the font box is not reported, nothing when neither is", () => {
  assert.equal(offset({ actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 10 }), 10);
  assert.equal(offset({}), 0);
  assert.equal(offset(null), 0);
});
