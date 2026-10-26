// Canva lays some texts out with its own engine: nowrap spans per line, <br> at the wraps, the
// space at a wrap gone from the page. The model's plaintext decides whether each break was a wrap
// (whitespace there) or a line the author typed (a newline). Evaluated straight out of
// canva-scraper.js between its marker comments.
//
// DAHMphBrpuo: "قاعات الفرح" — one line in the model, two on Canva's page; imported as one line.
//
//   node --test extensions/canva-importer/test/canva-laid-wrap.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-laid-wrap:start");
const end = source.indexOf("// ── canva-laid-wrap:end");
assert.ok(start >= 0 && end > start, "canva-laid-wrap markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.resolve = resolveCanvaLaidWrapRange;`, context);
const resolve = (pending, text) => JSON.parse(JSON.stringify(context.resolve(pending, text)));

// Measured on Canva's page: "قاعات" 2.61 em, "الفرح" 2.20 em, "قاعات الفرح" 5.05 em.
const halls = { minEm: 2.61198, maxEm: null, softBreaks: 0, lines: 2, breaks: [{ afterLetters: 5, joinEm: 5.05397 }] };

test("a space in the model at Canva's <br> is a wrap: the range reproduces it", () => {
  assert.deepEqual(resolve(halls, "قاعات الفرح"), { minEm: 2.61198, maxEm: 5.05397, lines: 2 });
});

test("a newline in the model is a typed break: no wrap to reproduce", () => {
  assert.equal(context.resolve(halls, "قاعات\nالفرح"), null);
});

test("no whitespace at the break: a word Canva split, no range", () => {
  assert.equal(context.resolve(halls, "قاعاتالفرح"), null);
});

test("a typed break and a wrap in one text: only the wrap bounds the range", () => {
  const pending = {
    minEm: 3,
    maxEm: null,
    softBreaks: 0,
    lines: 3,
    breaks: [
      { afterLetters: 4, joinEm: 9 },
      { afterLetters: 8, joinEm: 6 },
    ],
  };
  assert.deepEqual(resolve(pending, "aaaa\nbbbb cccc"), { minEm: 3, maxEm: 6, lines: 3 });
});

test("breaks the page already proved soft keep their bound", () => {
  const pending = { minEm: 2, maxEm: 4, softBreaks: 1, lines: 3, breaks: [{ afterLetters: 3, joinEm: 5 }] };
  assert.deepEqual(resolve(pending, "abc\ndef ghi"), { minEm: 2, maxEm: 4, lines: 3 });
  assert.equal(context.resolve(null, "x"), null);
});
