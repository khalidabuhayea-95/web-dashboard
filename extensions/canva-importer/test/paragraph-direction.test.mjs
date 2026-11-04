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

test("a number before the words moves after them, so it stays on the left (DAHZk2fauFU's date)", () => {
  // Canva drew "25 يونيو" (a left-to-right box) with 25 on the LEFT; laid out right to left, the
  // same text put 25 on the right.
  assert.equal(match("25 يونيو"), "يونيو 25");
  assert.equal(match("25يونيو"), "يونيو25");
  // Extended Arabic-Indic digits are European numbers to the layout too.
  assert.equal(match("۲۵ يونيو"), "يونيو ۲۵");
  // A number with separators keeps its own order behind a left-to-right mark.
  assert.equal(match("2024 .10.10 يوم السبت"), "يوم السبت ‎2024 .10.10");
  // End punctuation of the words still moves to the end it shows at. (These and the lines above
  // were checked pixel for pixel in Chrome: canvas fillText of Canva's text left-to-right against
  // ours right-to-left, 0 pixels apart.)
  assert.equal(match("25 يونيو!"), "!يونيو 25");
  assert.equal(match("«25 يونيو»"), "«يونيو ‎«25");
  // Each line on its own; outer whitespace stays.
  assert.equal(match("  25 يونيو  \nالساعة 6"), "  يونيو 25  \nالساعة 6");
});

test("numbers the two layouts already agree on stay where they are", () => {
  // After the first letter a number joins the words' right-to-left run either way.
  assert.equal(match("يونيو 25"), "يونيو 25");
  assert.equal(match("الساعة 6 مساءً"), "الساعة 6 مساءً");
  // Arabic-Indic digits are right-to-left numbers in both layouts.
  assert.equal(match("٢٥ يونيو"), "٢٥ يونيو");
  // Canva laid it out right to left too; mixed with Latin words, nothing moves.
  assert.equal(match("25 يونيو", "rtl"), "25 يونيو");
  assert.equal(match("25 June يونيو"), "25 June يونيو");
});

test("a left-to-right line of numbers keeps its order under Arabic (DAHMphBrpuo's date)", () => {
  assert.equal(match("2024 .10.10"), "\u200E2024 .10.10");
  assert.equal(match("10:30 - 12:00"), "\u200E10:30 - 12:00");
  // A bare number reads the same either way; marked once only; Canva's own RTL is left alone.
  assert.equal(match("2024"), "2024");
  assert.equal(match("\u200E2024 .10.10"), "\u200E2024 .10.10");
  assert.equal(match("2024 .10.10", "rtl"), "2024 .10.10");
});
