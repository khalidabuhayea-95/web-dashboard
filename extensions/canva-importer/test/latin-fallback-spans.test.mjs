// Runs of an Arabic text that Canva draws with its Latin fallback. The block is evaluated straight
// out of background.js between its marker comments, so the test exercises the code that ships.
//
//   node --test extensions/canva-importer/test/latin-fallback-spans.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-latin-fallback-spans:start");
const end = source.indexOf("// ── canva-latin-fallback-spans:end");
assert.ok(start >= 0 && end > start, "canva-latin-fallback-spans markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.spans = latinFallbackSpans;`, context);
const spans = (text) => JSON.parse(JSON.stringify(context.spans(text, "Noto Sans")));

test("a price: the digits only", () => {
  assert.deepEqual(spans("15 ريال"), [{ start: 0, end: 2, fontFamily: "Noto Sans" }]);
});

test("decimals stay one run; separate numbers are separate runs", () => {
  assert.deepEqual(spans("السعر 4.25 أو 5"), [
    { start: 6, end: 10, fontFamily: "Noto Sans" },
    { start: 14, end: 15, fontFamily: "Noto Sans" },
  ]);
});

test("Latin words inside Arabic; a trailing full stop is not part of the run", () => {
  assert.deepEqual(spans("قهوة Latte."), [{ start: 5, end: 10, fontFamily: "Noto Sans" }]);
});

test("pure Arabic has no runs", () => {
  assert.deepEqual(spans("قهوة أمريكية"), []);
});
