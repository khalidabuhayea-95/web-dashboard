/**
 * Right-to-left justified lines, placed as the browser (and Canva) lays them out.
 *
 *   node --import tsx --test src/lib/editor/konvaRtlJustify.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// The helper sits in a module that installs canvas patches on import, so evaluate just its block.
const source = fs.readFileSync(path.join(process.cwd(), "src/lib/editor/konvaTextPatches.ts"), "utf8");
const start = source.indexOf("// ── konva-rtl-justify:start");
const end = source.indexOf("// ── konva-rtl-justify:end");
assert.ok(start >= 0 && end > start, "konva-rtl-justify markers missing");
const js = source
  .slice(start, end)
  .replace(/export function/g, "function")
  .replace(/\(input: \{[\s\S]*?\}\): \{ x: number; wordSpacing: number \}/, "(input)");
const context = vm.createContext({});
vm.runInContext(`${js}\nthis.place = rtlJustifiedLinePlacement;`, context);
const place = (input: Record<string, unknown>) => JSON.parse(JSON.stringify(context.place(input)));

test("a one-line Arabic item sits on the right of its box", () => {
  // DAHQBQgaj3k: "قهوة أمريكية" (one space) in a 428 px justified box.
  assert.deepEqual(place({ text: "قهوة أمريكية", width: 90, available: 428, lastInParagraph: true }), { x: 338, wordSpacing: 0 });
});

test("a full line spans the box by widening its spaces", () => {
  assert.deepEqual(place({ text: "a b c", width: 300, available: 400, lastInParagraph: false }), { x: 0, wordSpacing: 50 });
});

test("a line with no space to widen also sits at the start", () => {
  assert.deepEqual(place({ text: "كابتشينو", width: 80, available: 428, lastInParagraph: false }), { x: 348, wordSpacing: 0 });
});

test("an over-wide line never moves past the left edge", () => {
  assert.deepEqual(place({ text: "a b", width: 500, available: 400, lastInParagraph: true }), { x: 0, wordSpacing: 0 });
});
