/**
 * Arabic stored as already-SHAPED glyphs in VISUAL order (production audit H-04 / D-02).
 *
 * Canva draws curved text as pre-shaped glyphs laid out left to right, and the importer copied
 * that string: «تذكير اليوم:» arrived as ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ" — Arabic Presentation Forms-B in display
 * order. Every renderer we have (Konva, Compose/Skia, CoreText) shapes and reorders text itself,
 * so it drew those glyphs disjoint and reversed; the web editor also found no U+0600 letter and
 * laid the box out LTR.
 *
 * Two steps, both evidence-based:
 *   1. ORDER. A line is reordered visual → logical only when the positional forms say it is
 *      visual: a word whose first STORED letter is a final form and whose last is an initial form
 *      was stored reversed. Logical-order text that merely contains a presentation form — the
 *      honorific «ﷺ» in 25 of the 26 affected local templates — is never reordered.
 *   2. FOLD. Contextual letter forms (U+FB50–U+FDFF, U+FE70–U+FEFC) go back to base letters
 *      (NFKC, one character at a time). The word ligatures U+FDF0–U+FDFF (ﷺ ﷻ ﷲ ﷽ …) and the
 *      ornate Quranic parentheses ﴾﴿ are written deliberately as single glyphs and are kept.
 *
 * ★Reordering runs on the ORIGINAL code points, before folding: a lam-alef ligature is one glyph in
 * display order but folds to two letters that are already in logical order («ﻻ» → «لا»).
 *
 * Dependency-free so the import route, the one-off data fix (scripts/) and node tests share it.
 */

const PRESENTATION_FORM_PATTERN = /[ﭐ-﷿ﹰ-ﻼ]/u;

function isPreservedPresentationForm(codePoint) {
  return (codePoint >= 0xfdf0 && codePoint <= 0xfdff) || codePoint === 0xfd3e || codePoint === 0xfd3f;
}

function isFoldablePresentationForm(codePoint) {
  const inBlocks =
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) || (codePoint >= 0xfe70 && codePoint <= 0xfefc);
  return inBlocks && !isPreservedPresentationForm(codePoint);
}

/**
 * Positional form of every single-letter presentation form, derived from the block layout:
 * consecutive code points that fold (NFKC) to the same letter are that letter's forms in the order
 * isolated, final, initial, medial (two-form letters: isolated, final). Lam-alef ligatures are
 * isolated/final pairs.
 */
const POSITIONAL_FORMS = (() => {
  const table = new Map();
  const ORDER = { 1: ["isolated"], 2: ["isolated", "final"], 4: ["isolated", "final", "initial", "medial"] };
  for (const [start, end] of [
    [0xfb50, 0xfbff],
    [0xfe80, 0xfef4],
  ]) {
    let group = [];
    let groupBase = null;
    const flush = () => {
      const forms = ORDER[group.length];
      if (forms) group.forEach((codePoint, index) => table.set(codePoint, forms[index]));
      group = [];
      groupBase = null;
    };
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      const char = String.fromCodePoint(codePoint);
      const base = char.normalize("NFKC");
      if (base === char || [...base].length !== 1) {
        flush();
        continue;
      }
      if (base !== groupBase) flush();
      groupBase = base;
      group.push(codePoint);
    }
    flush();
  }
  // Uighur/Kazakh alef maksura: only an initial and a medial form exist.
  table.set(0xfbe8, "initial");
  table.set(0xfbe9, "medial");
  for (let codePoint = 0xfef5; codePoint <= 0xfefc; codePoint += 1) {
    table.set(codePoint, codePoint % 2 === 1 ? "isolated" : "final");
  }
  return table;
})();

function isArabicLetter(codePoint) {
  return (
    (codePoint >= 0x0620 && codePoint <= 0x064a) ||
    (codePoint >= 0x066e && codePoint <= 0x06d3) ||
    codePoint === 0x06d5 ||
    (codePoint >= 0x06ee && codePoint <= 0x06ff && !(codePoint >= 0x06f0 && codePoint <= 0x06f9)) ||
    (codePoint >= 0x0750 && codePoint <= 0x077f) ||
    (codePoint >= 0x08a0 && codePoint <= 0x08c9) ||
    POSITIONAL_FORMS.has(codePoint) ||
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe80 && codePoint <= 0xfefc)
  );
}

function isArabicMarkOrJoiner(codePoint) {
  return (
    (codePoint >= 0x064b && codePoint <= 0x065f) ||
    codePoint === 0x0670 ||
    codePoint === 0x0640 ||
    (codePoint >= 0x06d6 && codePoint <= 0x06ed) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfe7f)
  );
}

const joinsNext = (form) => form === "initial" || form === "medial";
const joinsPrevious = (form) => form === "final" || form === "medial";

/**
 * Adds this line's evidence: does each Arabic word look stored in display (visual) order?
 *
 *   - Boundaries: logical order stores a word initial-first and final-last; display order stores
 *     it the other way round.
 *   - Joins: in logical order a letter connects forward exactly when the NEXT stored letter
 *     connects backward; stored reversed, it is the next letter's forward join that matches this
 *     one's backward join. Only pairs that fit one reading and not the other count — this is what
 *     decides words whose boundary letters are isolated forms (alef, lam-alef), e.g. «السلام».
 */
function collectOrderVotes(line, votes) {
  const codePoints = [...line].map((char) => char.codePointAt(0));
  let index = 0;
  while (index < codePoints.length) {
    if (!isArabicLetter(codePoints[index])) {
      index += 1;
      continue;
    }
    const letters = [];
    while (
      index < codePoints.length &&
      (isArabicLetter(codePoints[index]) || isArabicMarkOrJoiner(codePoints[index]))
    ) {
      if (isArabicLetter(codePoints[index])) letters.push(codePoints[index]);
      index += 1;
    }
    if (letters.length < 2) continue;
    const first = POSITIONAL_FORMS.get(letters[0]);
    const last = POSITIONAL_FORMS.get(letters[letters.length - 1]);
    if (first === "final") votes.visual += 1;
    else if (first === "initial") votes.logical += 1;
    if (last === "initial") votes.visual += 1;
    else if (last === "final") votes.logical += 1;

    for (let pair = 0; pair + 1 < letters.length; pair += 1) {
      const stored = POSITIONAL_FORMS.get(letters[pair]);
      const next = POSITIONAL_FORMS.get(letters[pair + 1]);
      if (!stored || !next) continue;
      const fitsLogical = joinsNext(stored) === joinsPrevious(next);
      const fitsVisual = joinsNext(next) === joinsPrevious(stored);
      if (fitsLogical && !fitsVisual) votes.logical += 1;
      else if (fitsVisual && !fitsLogical) votes.visual += 1;
    }
  }
}

const MIRRORED = new Map([
  ["(", ")"],
  [")", "("],
  ["[", "]"],
  ["]", "["],
  ["{", "}"],
  ["}", "{"],
  ["<", ">"],
  [">", "<"],
  ["«", "»"],
  ["»", "«"],
  ["‹", "›"],
  ["›", "‹"],
]);

// Characters that keep their own left-to-right order inside a right-to-left line: Latin letters
// and digits (European and Arabic-Indic — numbers are laid out LTR even in Arabic).
const LTR_CHAR = /[A-Za-z0-9À-ɏ٠-٩۰-۹]/u;
// Separators that stay inside a number or word when they sit between two such characters
// (10:30, 1.5, 1,000, 2026/10, e-mail).
const LTR_JOINER = /[.,:/'’\-_٫٬]/u;

function hasRtlCharacter(line) {
  return [...line].some((char) => isArabicLetter(char.codePointAt(0)) || /[֐-׿]/u.test(char));
}

/**
 * One line from display order back to logical order, assuming a right-to-left paragraph: the run
 * order is reversed, RTL runs are reversed character by character (with paired brackets mirrored
 * back), and LTR runs (Latin words, numbers) keep their internal order. A line with no RTL
 * character is left exactly as it is.
 */
export function visualToLogicalLine(line) {
  const chars = [...String(line ?? "")];
  if (!hasRtlCharacter(chars.join(""))) return chars.join("");
  const isLtrAt = (index) => {
    const char = chars[index];
    if (LTR_CHAR.test(char)) return true;
    if (char === "%" && index > 0 && LTR_CHAR.test(chars[index - 1])) return true;
    return (
      LTR_JOINER.test(char) &&
      index > 0 &&
      index < chars.length - 1 &&
      LTR_CHAR.test(chars[index - 1]) &&
      LTR_CHAR.test(chars[index + 1])
    );
  };
  const runs = [];
  for (let index = 0; index < chars.length; index += 1) {
    const ltr = isLtrAt(index);
    const current = runs[runs.length - 1];
    if (current && current.ltr === ltr) current.chars.push(chars[index]);
    else runs.push({ ltr, chars: [chars[index]] });
  }
  return runs
    .reverse()
    .map((run) => (run.ltr ? run.chars.join("") : run.chars.reverse().map((char) => MIRRORED.get(char) ?? char).join("")))
    .join("");
}

/** Folds contextual presentation forms to base letters, keeping the deliberate ligatures. */
export function foldArabicPresentationForms(text) {
  let out = "";
  for (const char of String(text ?? "")) {
    const codePoint = char.codePointAt(0);
    if (!isFoldablePresentationForm(codePoint)) {
      out += char;
      continue;
    }
    let folded = char.normalize("NFKC");
    // Isolated harakat forms decompose to SPACE + mark; the space is a glyph-spacing artefact.
    if (codePoint >= 0xfe70 && codePoint <= 0xfe7f) folded = folded.replace(/^ /, "");
    out += folded;
  }
  return out;
}

/** The paragraph direction a renderer would pick: the first strong character's. */
export function firstStrongIsRtl(text) {
  for (const char of String(text ?? "")) {
    const codePoint = char.codePointAt(0);
    if (isArabicLetter(codePoint) || /[֐-׿]/u.test(char)) return true;
    if (/\p{L}/u.test(char)) return false;
  }
  return false;
}

/**
 * The text of one layer, normalised. `reordered` says the visual → logical step ran; `changed`
 * whether anything differs at all. Text without a presentation form comes back untouched.
 *
 * @param {unknown} value
 * @returns {{ text: string, changed: boolean, reordered: boolean }}
 */
export function normalizeArabicPresentationText(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!PRESENTATION_FORM_PATTERN.test(text)) return { text, changed: false, reordered: false };

  // Visual order is per line, so lines are reordered one by one; the decision is per text box.
  const parts = text.split(/(\r\n|\n|\r)/);
  const votes = { visual: 0, logical: 0 };
  for (let index = 0; index < parts.length; index += 2) collectOrderVotes(parts[index], votes);
  const reorder = votes.visual > votes.logical;

  const normalized = parts
    .map((part, index) =>
      index % 2 === 1 ? part : foldArabicPresentationForms(reorder ? visualToLogicalLine(part) : part)
    )
    .join("");
  return { text: normalized, changed: normalized !== text, reordered: reorder && normalized !== text };
}

const TEXT_LAYER_TYPES = new Set(["text", "textbox", "i-text", "itext"]);

/**
 * Normalises every text layer in a template payload — fabric `objects` (groups included) and
 * editor `pages[].elements` alike — IN PLACE, and returns what changed. A changed layer whose text
 * now starts right-to-left is also marked `isRtl: true` (the app reads the flag; the old text had
 * no base Arabic letter for anything to infer direction from).
 *
 * @param {unknown} data
 * @returns {Array<{ path: string, before: string, after: string, reordered: boolean, isRtlBefore: unknown, isRtlAfter: unknown }>}
 */
export function normalizeTemplateArabicTextInPlace(data) {
  const changes = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    if (TEXT_LAYER_TYPES.has(String(node.type || "").toLowerCase()) && typeof node.text === "string") {
      const result = normalizeArabicPresentationText(node.text);
      if (result.changed) {
        const before = node.text;
        const isRtlBefore = node.isRtl;
        node.text = result.text;
        // Multi-style ranges (textSpans) index the text: they survive a one-for-one fold, but a
        // reordered or resized string would put them on the wrong letters — drop them instead.
        if (Array.isArray(node.textSpans) && (result.reordered || result.text.length !== before.length)) {
          delete node.textSpans;
        }
        if (firstStrongIsRtl(result.text)) node.isRtl = true;
        changes.push({
          path: `${path}.text`,
          before,
          after: result.text,
          reordered: result.reordered,
          isRtlBefore,
          isRtlAfter: node.isRtl,
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") visit(value, `${path}.${key}`);
    }
  };
  visit(data, "data");
  return changes;
}
