/**
 * Arabic-aware search normalisation (production audit H-18 / PAR-02).
 *
 * Template search used to be a raw title substring match, so «تهنئه» found nothing while «تهنئة»
 * found 134, «رَمَضَان» (with harakat) and «عيد فطر» (no article) found nothing, and an English
 * "Ramadan" never reached the Ramadan rail. Both sides of a comparison — the query and the
 * searchable text — go through the same fold:
 *
 *   - tashkeel U+064B–U+065F, superscript alef U+0670 and tatweel U+0640 are dropped;
 *   - أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي (and the Persian-keyboard ک → ك, ی → ي);
 *   - Arabic-Indic and extended Arabic-Indic digits → ASCII digits;
 *   - Latin is lowercased and whitespace collapsed.
 *
 * ★The SQL side (src/lib/mobile/templateSearch.server.ts) applies the SAME fold with
 * regexp_replace + replace + translate + lower, built from the tables exported here, so the two
 * can never drift: change a fold in SEARCH_LETTER_FOLDS and both sides change together.
 *
 * Dependency-free on purpose: node tests import it directly, and the taxonomy labels (which live
 * in an AppSetting, not in a column) are matched with it in JS.
 */

// Removed outright, both sides. One character class, reused verbatim as the SQL regexp.
export const SEARCH_MARKS_CLASS = "[ً-ٰٟـ]";
const SEARCH_MARKS_PATTERN = new RegExp(SEARCH_MARKS_CLASS, "gu");

// [from, to], one code point each. SQL applies these as nested replace() calls — measurably
// cheaper than one translate() over the same table (12 ms vs 26 ms for 519 rows).
export const SEARCH_LETTER_FOLDS = Object.freeze([
  ["أ", "ا"], // أ → ا
  ["إ", "ا"], // إ → ا
  ["آ", "ا"], // آ → ا
  ["ٱ", "ا"], // ٱ → ا
  ["ة", "ه"], // ة → ه
  ["ى", "ي"], // ى → ي
  ["ؤ", "و"], // ؤ → و
  ["ئ", "ي"], // ئ → ي
  ["ک", "ك"], // ک → ك (Persian keyboard)
  ["ی", "ي"], // ی → ي (Persian keyboard)
]);

// Arabic-Indic (U+0660–0669) and extended Arabic-Indic (U+06F0–06F9) digits → ASCII. Rare in
// titles, so SQL only runs translate() on a row that matches SEARCH_DIGITS_CLASS.
const DIGIT_FOLDS = [
  ...Array.from({ length: 10 }, (_, digit) => [String.fromCodePoint(0x0660 + digit), String(digit)]),
  ...Array.from({ length: 10 }, (_, digit) => [String.fromCodePoint(0x06f0 + digit), String(digit)]),
];
export const SEARCH_DIGITS_CLASS = "[٠-٩۰-۹]";
export const SEARCH_DIGITS_FROM = DIGIT_FOLDS.map(([from]) => from).join("");
export const SEARCH_DIGITS_TO = DIGIT_FOLDS.map(([, to]) => to).join("");

const ALL_FOLDS = [...SEARCH_LETTER_FOLDS, ...DIGIT_FOLDS];
/** Every single-character fold as one translate() table pair (tests compare against it). */
export const SEARCH_FOLD_FROM = ALL_FOLDS.map(([from]) => from).join("");
export const SEARCH_FOLD_TO = ALL_FOLDS.map(([, to]) => to).join("");
const FOLD_MAP = new Map(ALL_FOLDS);

// The definite article is ignored at the start of a query token when at least this many letters
// remain: «الفطر» → «فطر» (so «عيد فطر» and «عيد الفطر» meet), but «الله» does not collapse to
// «له», which is a substring of half the catalogue.
const ARTICLE = "ال"; // ال
const MIN_LETTERS_AFTER_ARTICLE = 3;

export const MAX_SEARCH_TOKENS = 8;
const MAX_TOKEN_LENGTH = 64;

/** The shared fold. Idempotent: normalizeSearchText(normalizeSearchText(x)) === normalizeSearchText(x). */
export function normalizeSearchText(value) {
  const stripped = String(value ?? "").replace(SEARCH_MARKS_PATTERN, "");
  let folded = "";
  for (const char of stripped) folded += FOLD_MAP.get(char) ?? char;
  return folded.toLowerCase().replace(/\s+/gu, " ").trim();
}

function stripLeadingArticle(token) {
  if (!token.startsWith(ARTICLE)) return token;
  const rest = token.slice(ARTICLE.length);
  return [...rest].length >= MIN_LETTERS_AFTER_ARTICLE ? rest : token;
}

/**
 * Query → the tokens every result must contain (token-AND). Splits on anything that is not a
 * letter, digit or mark; drops the article (see above); de-duplicates; and drops one-letter tokens
 * when longer ones exist (a lone «و» between words would otherwise match everything).
 */
export function tokenizeSearchQuery(query, { maxTokens = MAX_SEARCH_TOKENS } = {}) {
  const tokens = [];
  for (const piece of normalizeSearchText(query).split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (!piece) continue;
    const token = stripLeadingArticle([...piece].slice(0, MAX_TOKEN_LENGTH).join(""));
    if (!tokens.includes(token)) tokens.push(token);
  }
  const meaningful = tokens.filter((token) => [...token].length > 1);
  return (meaningful.length > 0 ? meaningful : tokens).slice(0, Math.max(1, maxTokens));
}

/** LIKE pattern for "contains token", with the LIKE metacharacters escaped (ESCAPE '\'). */
export function toContainsPattern(token) {
  return `%${String(token).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function labelMatches(item, token) {
  return (
    normalizeSearchText(item?.labelAr).includes(token) ||
    normalizeSearchText(item?.labelEn).includes(token)
  );
}

/**
 * For each token, the published placements whose AR or EN label contains it: a category-label hit
 * covers the whole category, a sub-category-label hit its {category, subCategory} pair. This is
 * what lets "Ramadan" (EN label "Ramadan Greeting") or «أدعية» (label «أدعية وأذكار») find the
 * templates filed there even when their titles never say so.
 *
 * @param {string[]} tokens normalised tokens from tokenizeSearchQuery
 * @param {Array<{ value: string, labelAr?: string, labelEn?: string, subCategories?: Array<{ value: string, labelAr?: string, labelEn?: string }> }>} categories
 * @returns {Array<{ token: string, categoryValues: string[], pairs: Array<{ category: string, subCategory: string }> }>}
 */
export function matchTaxonomyLabels(tokens, categories) {
  const list = Array.isArray(categories) ? categories : [];
  return (Array.isArray(tokens) ? tokens : []).map((token) => {
    const categoryValues = [];
    const pairs = [];
    for (const category of list) {
      const categoryValue = String(category?.value || "");
      if (!categoryValue) continue;
      if (labelMatches(category, token)) {
        categoryValues.push(categoryValue);
        continue; // the whole category is in; its sub categories add nothing
      }
      for (const subCategory of Array.isArray(category?.subCategories) ? category.subCategories : []) {
        const subCategoryValue = String(subCategory?.value || "");
        if (subCategoryValue && labelMatches(subCategory, token)) {
          pairs.push({ category: categoryValue, subCategory: subCategoryValue });
        }
      }
    }
    return { token, categoryValues, pairs };
  });
}
