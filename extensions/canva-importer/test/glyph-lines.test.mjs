// Per-glyph client rects → the rendered lines, in logical order. The block is evaluated straight
// out of canva-scraper.js between its marker comments, so the test exercises the code that ships.
//
// FS Albert Arabic's inline box is two em tall while its lines sit 1.1 em apart, so the old
// "middle dropped by half a box" rule merged lines 1 and 2 of the three-line paragraph on
// DAHFEg4hhOk — the wrap range came out double and the box ran under the graduate illustration.
//
//   node --test extensions/canva-importer/test/glyph-lines.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-glyph-lines:start");
const end = source.indexOf("// ── canva-glyph-lines:end");
assert.ok(start >= 0 && end > start, "canva-glyph-lines markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.group = groupGlyphsIntoLines;`, context);
const group = (chars) => JSON.parse(JSON.stringify(context.group(chars)));
const texts = (chars) => group(chars).map((line) => line.text);

const BLOCK = "p1";
// Glyphs of `text` on one line whose inline box starts at `top` and is `h` tall.
const line = (text, top, h, block = BLOCK) =>
  [...text].map((ch) => ({ ch, top, mid: top + h / 2, h, block }));

test("the certificate paragraph: 60 px glyph boxes on 29 px line pitch are three lines", () => {
  const chars = [...line("تهانينا لك ", 100, 59.8), ...line("والتقدير ", 129, 59.8), ...line("النجاح.", 158, 59.8)];
  assert.deepEqual(texts(chars), ["تهانينا لك ", "والتقدير ", "النجاح."]);
  assert.deepEqual(group(chars).map((item) => item.hardBreak), [false, false, false]);
});

test("ordinary glyph boxes still split where they used to", () => {
  const chars = [...line("one two ", 10, 20), ...line("three", 34, 20)];
  assert.deepEqual(texts(chars), ["one two ", "three"]);
});

test("sub-pixel wobble inside one line does not split it", () => {
  const chars = [...line("abc", 10, 20), ...line("def", 10.6, 20), ...line("ghi", 9.4, 20)];
  assert.deepEqual(texts(chars), ["abcdefghi"]);
});

test("hard breaks and paragraph changes end a line and mark it", () => {
  const chars = [...line("first", 10, 20), { ch: "\n", hardBreak: true }, ...line("second", 34, 20), ...line("third", 58, 20, "p2")];
  const lines = group(chars);
  assert.deepEqual(lines.map((item) => item.text), ["first", "second", "third"]);
  assert.deepEqual(lines.map((item) => item.hardBreak), [true, true, false]);
});

test("glyphs without a top fall back to the middle-drop rule", () => {
  const strip = (items) => items.map(({ top: _top, ...rest }) => rest);
  const chars = strip([...line("one", 10, 20), ...line("two", 34, 20)]);
  assert.deepEqual(texts(chars), ["one", "two"]);
  assert.deepEqual(texts(strip(line("same", 10, 20))), ["same"]);
});
