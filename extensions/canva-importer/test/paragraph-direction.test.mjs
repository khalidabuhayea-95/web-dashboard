// A Canva paragraph laid out left-to-right vs the editor and the app, which lay Arabic out
// right-to-left: end punctuation moves to the end it shows at, so both layouts agree. The block is
// evaluated straight out of canva-scraper.js between its marker comments, so the test exercises
// the code that ships.
//
//   node --test extensions/canva-importer/test/paragraph-direction.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "canva-scraper.js"), "utf8");
const start = source.indexOf("// ── canva-paragraph-direction:start");
const end = source.indexOf("// ── canva-paragraph-direction:end");
assert.ok(start >= 0 && end > start, "canva-paragraph-direction markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.match = matchCanvaParagraphDirection;`, context);
const match = (text, direction = "ltr") => context.match(text, direction);

test("the coffee post's '!' moves to the end of the Arabic sentence", () => {
  // DAHPQG4ffsM: typed with the "!" first in a left-to-right box, shown at the sentence's end.
  assert.equal(match("!مـسـتـوى الـحـمـاس في الـقـمـة"), "مـسـتـوى الـحـمـاس في الـقـمـة!");
});

test("runs at both ends swap ends, read right to left, with brackets mirrored", () => {
  assert.equal(match("«! صباح الخير"), "صباح الخير !»");
  assert.equal(match("صباح الخير ؟"), "؟ صباح الخير");
  assert.equal(match("(مرحبا"), "مرحبا)");
  // Outer whitespace stays where it was; numbers stay inside the sentence.
  assert.equal(match("  !مسقط ٢٠٢٣  "), "  مسقط ٢٠٢٣!  ");
});

test("every line of a multi-line paragraph is its own case", () => {
  assert.equal(match("!أهلاً\nبكم"), "أهلاً!\nبكم");
});

test("anything the two layouts already agree on is left alone", () => {
  // Canva laid it out right-to-left too.
  assert.equal(match("!مرحبا", "rtl"), "!مرحبا");
  // Latin, or Arabic mixed with Latin words (the word order would differ as well).
  assert.equal(match("!Hello"), "!Hello");
  assert.equal(match("!مرحبا Nayroz"), "!مرحبا Nayroz");
  // Nothing at the ends, or nothing but punctuation.
  assert.equal(match("صباح الخير"), "صباح الخير");
  assert.equal(match("..."), "...");
  assert.equal(match(""), "");
});

test("a left-to-right line of numbers keeps its order under Arabic (DAHMphBrpuo's date)", () => {
  assert.equal(match("2024 .10.10"), "\u200E2024 .10.10");
  assert.equal(match("10:30 - 12:00"), "\u200E10:30 - 12:00");
  // A bare number reads the same either way; marked once only; Canva's own RTL is left alone.
  assert.equal(match("2024"), "2024");
  assert.equal(match("\u200E2024 .10.10"), "\u200E2024 .10.10");
  assert.equal(match("2024 .10.10", "rtl"), "2024 .10.10");
});
