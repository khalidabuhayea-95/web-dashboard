// Multi-style Canva text → the layer's textSpans. The block is evaluated straight out of
// background.js between its marker comments. (DAHQBJ7cipQ: "طلّب أونلاين وخليك مرتاح… إحنا نوصل
// لعندك وين ما كنت." alternates white and yellow inside one paragraph; the import kept white only.)
//
//   node --test extensions/canva-importer/test/text-spans.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-text-spans:start");
const end = source.indexOf("// ── canva-text-spans:end");
assert.ok(start >= 0 && end > start, "canva-text-spans markers missing");
const context = vm.createContext({});
vm.runInContext(
  `${source.slice(start, end)}\nthis.align = alignCanvaTextRuns; this.toSpans = canvaTextRunsToSpans;`,
  context
);
// Results cross the vm boundary; compare them as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));
const align = (text, runs) => plain(context.align(text, runs));
const toSpans = (text, runs, base, scale) => plain(context.toSpans(text, runs, base, scale));

const style = (overrides = {}) => ({
  fontFamily: "IBM Plex Sans Arabic",
  fontWeight: 700,
  fontStyle: "normal",
  fontSize: 40.708,
  color: "rgb(255, 255, 255)",
  letterSpacing: 0,
  textDecoration: "none",
  ...overrides,
});
const base = {
  fontFamily: "IBM Plex Sans Arabic",
  fontWeight: 700,
  fontStyle: "normal",
  fontSize: 40.708,
  color: "rgb(255, 255, 255)",
  letterSpacing: 0,
  textDecoration: "",
};
const yellow = style({ color: "rgb(255, 191, 81)" });

// The runs exactly as the live page renders them (one <p>, four leaf spans).
const DELIVERY_RUNS = [
  { text: "طلّب أونلاين ", style: style() },
  { text: "وخليك مرتاح", style: yellow },
  { text: "… إحنا نوصل لعندك ", style: style() },
  { text: "وين ما كنت.", style: yellow },
];
const DELIVERY = "طلّب أونلاين وخليك مرتاح… إحنا نوصل لعندك وين ما كنت.";

test("DAHQBJ7cipQ: the two yellow phrases become colour spans over the final text", () => {
  const spans = toSpans(DELIVERY, DELIVERY_RUNS, base);
  assert.deepEqual(spans, [
    { start: DELIVERY.indexOf("وخليك"), end: DELIVERY.indexOf("…"), color: "#ffbf51" },
    { start: DELIVERY.indexOf("وين"), end: DELIVERY.length, color: "#ffbf51" },
  ]);
  for (const span of spans) assert.match(DELIVERY.slice(span.start, span.end), /^\S.*\S$/u);
});

test("whitespace is matched loosely: wrapping, trimming and paragraph breaks", () => {
  const runs = [
    { text: "  Hello ", style: style({ color: "rgb(255, 0, 0)" }) },
    { text: "\n", style: null },
    { text: "world", style: style() },
  ];
  assert.deepEqual(toSpans("Hello\nworld", runs, base), [{ start: 0, end: 5, color: "#ff0000" }]);
  assert.deepEqual(align("a  b", [{ text: "a b", style: null }]), []);
});

test("list markers and end punctuation the direction fix moved are skipped, a letter mismatch gives up", () => {
  // matchCanvaParagraphDirection moved the "!" to the other end of an all-Arabic LTR paragraph.
  const runs = [
    { text: "!", style: style() },
    { text: "مستوى", style: style({ color: "rgb(0, 0, 255)" }) },
    { text: " الحماس", style: style() },
  ];
  assert.deepEqual(toSpans("مستوى الحماس!", runs, base), [{ start: 0, end: 5, color: "#0000ff" }]);
  // A bullet the scraper prefixed shows up as a styleless run.
  assert.deepEqual(
    toSpans("• one two", [{ text: "• ", style: null }, { text: "one ", style: style({ fontWeight: 400 }) }, { text: "two", style: style() }], base),
    [{ start: 2, end: 6, fontWeight: "400" }]
  );
  assert.equal(align("abc", [{ text: "abd", style: style() }]), null);
  assert.deepEqual(toSpans("abc", [{ text: "xyz", style: yellow }], base), []);
});

test("only differences become overrides; a transparent layout copy is no colour", () => {
  const runs = [
    { text: "Big ", style: style({ fontSize: 81.416, fontFamily: "Cairo", fontStyle: "italic", letterSpacing: 2 }) },
    { text: "plain ", style: style() },
    { text: "ghost", style: style({ color: "rgba(0, 0, 0, 0)" }) },
    { text: " under", style: style({ textDecoration: "underline" }) },
  ];
  assert.deepEqual(toSpans("Big plain ghost under", runs, base), [
    { start: 0, end: 4, fontFamily: "Cairo", fontStyle: "italic", fontSize: 81.416, letterSpacing: 2 },
    // A run keeps its own spaces, styled as Canva styles them.
    { start: 15, end: 21, textDecoration: "underline" },
  ]);
});

test("neighbours with the same overrides merge across whitespace, never across a letter", () => {
  const red = style({ color: "rgb(255, 0, 0)" });
  assert.deepEqual(
    toSpans("ab cd", [{ text: "ab", style: red }, { text: " ", style: style() }, { text: "cd", style: red }], base),
    [{ start: 0, end: 5, color: "#ff0000" }]
  );
  assert.deepEqual(
    toSpans("abXcd", [{ text: "ab", style: red }, { text: "X", style: style() }, { text: "cd", style: red }], base),
    [
      { start: 0, end: 2, color: "#ff0000" },
      { start: 3, end: 5, color: "#ff0000" },
    ]
  );
});
