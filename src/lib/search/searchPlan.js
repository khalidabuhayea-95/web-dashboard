/**
 * Search query planning, shared by template and element search.
 *
 * A query becomes a list of CONCEPTS (one per meaningful word, or one per known phrase such as
 * «عيد ميلاد»). A row matches a concept when any of the concept's VARIANTS is in its folded title or
 * tags; rows are kept by how many concepts they match and ranked by how well (see searchSql.js).
 *
 * Variants of a concept, strongest first:
 *   exact        the word as typed (folded: tashkeel, hamza forms, ة/ه … — see arabicSearch.js);
 *   synonym      every other spelling in its synonym group (searchSynonyms.js), both languages;
 *   translation  the word machine-translated into the other language (searchTranslate.server.js);
 *   derived      the word without an Arabic clitic («بالوردي» → «وردي», «للاطفال» → «اطفال»), a light
 *                suffix stem («ورديه» → «وردي») or an English plural ("flowers" → "flower").
 *
 * Every variant is a list of TERMS that must all appear (a phrase translated as two words, a
 * two-word synonym). Pure and dependency-free apart from the shared fold, so node tests import it.
 */
import { normalizeSearchText, tokenizeSearchQuery } from "../text/arabicSearch.js";
import { SEARCH_SYNONYM_GROUPS } from "./searchSynonyms.js";

export const MAX_SEARCH_CONCEPTS = 6;
const MAX_VARIANTS_PER_CONCEPT = 14;
const MAX_PHRASE_WORDS = 3;

// Folded forms. A query made of nothing but these keeps them (see buildSearchPlan).
const STOPWORDS = new Set(
  [
    "في", "من", "على", "الى", "إلى", "عن", "مع", "و", "او", "أو", "ثم", "هذا", "هذه", "ذلك", "تلك",
    "كل", "بعض", "لل", "ب", "ل", "ك", "ف", "يا", "ما", "لا", "هو", "هي", "انا", "نحن",
    "the", "a", "an", "of", "for", "with", "and", "or", "to", "in", "on", "by", "at", "is", "are",
    "my", "your", "our", "this", "that", "from", "about", "during", "into", "over", "under", "its", "it", "be",
  ].map((word) => normalizeSearchText(word))
);

const ARABIC_RE = /[؀-ۿ]/u;
const LATIN_RE = /[a-z]/;
const ONLY_DIGITS_RE = /^[0-9]+$/;

const letters = (value) => [...String(value || "")].length;

export function isSearchStopword(word) {
  return STOPWORDS.has(normalizeSearchText(word));
}

/** The language a translation of `text` should go to, or null (digits, mixed, unknown). */
export function translationTarget(text) {
  const value = String(text || "");
  if (ONLY_DIGITS_RE.test(value)) return null;
  if (ARABIC_RE.test(value)) return "en";
  if (LATIN_RE.test(value)) return "ar";
  return null;
}

/** A synonym entry or translation in the same folded, article-free shape the query tokens have. */
function foldEntry(entry) {
  return tokenizeSearchQuery(entry, { maxTokens: 8 }).join(" ");
}

let synonymIndex = null;
/** folded entry → set of folded entries in any group that contains it (itself excluded). */
function getSynonymIndex() {
  if (synonymIndex) return synonymIndex;
  const index = new Map();
  for (const group of SEARCH_SYNONYM_GROUPS) {
    const folded = Array.from(new Set(group.map(foldEntry).filter(Boolean)));
    for (const entry of folded) {
      if (!index.has(entry)) index.set(entry, new Set());
      for (const other of folded) if (other !== entry) index.get(entry).add(other);
    }
  }
  synonymIndex = index;
  return index;
}

/** Folded multi-word synonym entries, longest first (phrase detection). */
let phraseList = null;
function getPhrases() {
  if (phraseList) return phraseList;
  phraseList = Array.from(getSynonymIndex().keys())
    .map((entry) => entry.split(" "))
    .filter((words) => words.length > 1 && words.length <= MAX_PHRASE_WORDS)
    .sort((left, right) => right.length - left.length);
  return phraseList;
}

export function synonymsOf(foldedEntry) {
  return Array.from(getSynonymIndex().get(foldedEntry) || []);
}

const ARABIC_PREFIXES = [
  ["وال", 3],
  ["بال", 3],
  ["كال", 3],
  ["فال", 3],
  ["لل", 3],
  ["و", 3],
  ["ب", 4],
  ["ل", 4],
  ["ف", 4],
  ["ك", 4],
];
const ARABIC_SUFFIXES = ["ات", "ين", "ون", "ه", "ي"];

/**
 * Looser forms of one folded token, weakest evidence: Arabic clitics and light suffixes, English
 * plurals. Each keeps at least three letters so «ورد» never becomes «رد».
 */
export function deriveTokenForms(token) {
  const forms = new Set();
  const word = String(token || "");
  if (ARABIC_RE.test(word)) {
    // The suffix stem is taken from the clitic-free form (or the word itself when it has none).
    let base = word;
    for (const [prefix, minRest] of ARABIC_PREFIXES) {
      if (word.startsWith(prefix) && letters(word) - letters(prefix) >= minRest) {
        let rest = word.slice(prefix.length);
        if (rest.startsWith("ال") && letters(rest) - 2 >= 3) rest = rest.slice(2);
        forms.add(rest);
        base = rest;
        break;
      }
    }
    for (const suffix of ARABIC_SUFFIXES) {
      if (base.endsWith(suffix) && letters(base) - letters(suffix) >= 3) {
        forms.add(base.slice(0, base.length - suffix.length));
        break;
      }
    }
  } else if (/^[a-z]+$/.test(word) && word.length >= 4) {
    if (word.endsWith("ies")) forms.add(`${word.slice(0, -3)}y`);
    else if (/(ches|shes|xes|sses)$/.test(word)) forms.add(word.slice(0, -2));
    else if (word.endsWith("s") && !word.endsWith("ss")) forms.add(word.slice(0, -1));
  }
  forms.delete(word);
  return Array.from(forms);
}

/** Folded, stopword-free words of a translation result. */
export function translationTerms(translated) {
  return tokenizeSearchQuery(translated, { maxTokens: 6 }).filter((word) => !STOPWORDS.has(word) && letters(word) > 1);
}

/**
 * Query → concepts, before translation. Each concept: { surface, words, variants }, where
 * `surface` is the folded word or phrase (what gets translated) and each variant is
 * { terms: string[], kind: "exact" | "synonym" | "translation" | "derived" }.
 */
export function buildSearchPlan(query) {
  const raw = tokenizeSearchQuery(query, { maxTokens: 12 });
  const content = raw.filter((token) => !STOPWORDS.has(token));
  const tokens = content.length > 0 ? content : raw;
  const phrases = getPhrases();

  const groups = [];
  for (let index = 0; index < tokens.length; ) {
    let matched = null;
    for (const phrase of phrases) {
      if (index + phrase.length > tokens.length) continue;
      if (phrase.every((word, offset) => tokens[index + offset] === word)) {
        matched = phrase;
        break;
      }
    }
    if (matched) {
      groups.push(matched);
      index += matched.length;
    } else {
      groups.push([tokens[index]]);
      index += 1;
    }
  }

  const concepts = groups.slice(0, MAX_SEARCH_CONCEPTS).map((words) => {
    const surface = words.join(" ");
    const variants = [];
    const seen = new Set();
    const add = (terms, kind) => {
      const clean = terms.map((term) => String(term || "").trim()).filter(Boolean);
      if (!clean.length) return;
      const key = clean.join("|");
      if (seen.has(key)) return;
      seen.add(key);
      variants.push({ terms: clean, kind });
    };
    add(words.length > 1 ? [surface] : words, "exact");
    if (words.length > 1) add(words, "exact");
    for (const synonym of synonymsOf(surface)) add(synonym.split(" ").length > 1 ? [synonym] : [synonym], "synonym");
    if (words.length === 1) {
      for (const form of deriveTokenForms(surface)) {
        add([form], "derived");
        for (const synonym of synonymsOf(form)) add([synonym], "synonym");
      }
    }
    return { surface, words, variants: variants.slice(0, MAX_VARIANTS_PER_CONCEPT) };
  });

  return { tokens, concepts };
}

/**
 * Surfaces worth translating: not digits, and not already bridged to the other language by a
 * synonym (the dictionary is cheaper and more precise than a machine translation).
 */
export function surfacesNeedingTranslation(plan) {
  const out = [];
  for (const concept of plan?.concepts || []) {
    const target = translationTarget(concept.surface);
    if (!target) continue;
    const bridged = concept.variants.some(
      (variant) => variant.kind === "synonym" && translationTarget(variant.terms.join(" ")) !== target && translationTarget(variant.terms.join(" ")) !== null
    );
    if (!bridged) out.push({ surface: concept.surface, target });
  }
  return out;
}

/** Adds machine translations (folded surface → translated text) as variants. Returns the plan. */
export function attachTranslations(plan, translations) {
  if (!plan || !translations) return plan;
  for (const concept of plan.concepts) {
    const translated = translations.get(concept.surface);
    if (!translated) continue;
    const terms = translationTerms(translated);
    if (!terms.length || terms.join(" ") === concept.surface) continue;
    const seen = new Set(concept.variants.map((variant) => variant.terms.join("|")));
    const push = (variantTerms) => {
      const key = variantTerms.join("|");
      if (seen.has(key) || concept.variants.length >= MAX_VARIANTS_PER_CONCEPT + 4) return;
      seen.add(key);
      concept.variants.push({ terms: variantTerms, kind: "translation" });
    };
    push(terms.length > 1 ? [terms.join(" ")] : terms);
    if (terms.length > 1) push(terms);
    for (const synonym of synonymsOf(terms.join(" "))) push([synonym]);
  }
  return plan;
}
