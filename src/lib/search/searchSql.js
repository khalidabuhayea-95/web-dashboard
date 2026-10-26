/**
 * SQL for a search plan (searchPlan.js) over two stored, folded columns: a TITLE column and a TAGS
 * column, both produced by nayroz_search_fold() (migration 20261019120000) — words separated by
 * single spaces, padded with one space each side.
 *
 * Per concept the row gets a CLASS (0 = no match), the best of:
 *
 *   exact / synonym / translation      derived (clitic / stem / plural)
 *   8  whole word in the title         5  whole word in the title
 *   6  word start in the title         4  word start in the title
 *   5  substring of the title (3+ ch)  3  whole word in the tags
 *   4  whole word in the tags          2  word start in the tags
 *   3  word start in the tags
 *   2  substring of the tags (3+ ch)   typo (the typed word, 4+ ch): 2 at trigram word
 *   2  `extra` (template placement labels)  similarity ≥ 0.75, 1 at ≥ 0.5
 *
 * A row is kept when it matches as many concepts as the best row does (and at least half of
 * them), so "كيكة زرقاء" shows blue cakes when there are any and cakes otherwise. The trigram
 * GIN indexes on both columns serve the prefilter.
 *
 * Builders return SQL TEXT; every value goes through `param(value)`, which returns a placeholder.
 */

const ARABIC_RE = /[؀-ۿ]/u;
const letters = (value) => [...String(value || "")].length;

export const FUZZY_MIN_LETTERS = 4;
// Measured on the catalogue (2026-10-19): 0.6 missed "balons" → Balloons (0.45 word similarity
// on the stored text, 0.71 on the word itself); 0.5 finds it with ~80 rows of tail. Strong typos
// (≥ 0.75) rank a step above weak ones.
export const FUZZY_THRESHOLD = 0.5;
const FUZZY_STRONG = 0.75;

/**
 * Run (as a query) before a search statement in the SAME transaction. Both settings are local to
 * that transaction:
 *   - pg_trgm.word_similarity_threshold: the prefilter's `<%` operator (the indexable typo check)
 *     reads its threshold from it (default 0.6);
 *   - enable_seqscan off: the planner over-estimates an OR of trigram LIKEs and picked a full scan
 *     that ran the typo check on every row — 291 ms for "balloons" on 9.8k elements, 15 ms with the
 *     trigram indexes (measured 2026-10-19).
 */
export const SEARCH_SESSION_SQL = `SELECT set_config('pg_trgm.word_similarity_threshold', '${FUZZY_THRESHOLD}', true), set_config('enable_seqscan', 'off', true)`;

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** A param function that reuses one placeholder per distinct value. */
export function dedupingParam(param) {
  const cache = new Map();
  return (value) => {
    const key = JSON.stringify(value);
    if (!cache.has(key)) cache.set(key, param(value));
    return cache.get(key);
  };
}

/** Whole-word and word-start spellings of a term: Arabic also with the article glued on. */
function wordForms(term) {
  return ARABIC_RE.test(term) && !term.includes(" ") ? [term, `ال${term}`] : [term];
}

function like(column, pattern, param) {
  return `${column} LIKE ${param(pattern)} ESCAPE '\\'`;
}

function termCondition(column, mode, term, param) {
  const escaped = escapeLike(term);
  if (mode === "contains") {
    if (letters(term) < 3) return null;
    return like(column, `%${escaped}%`, param);
  }
  const forms = wordForms(term).map(escapeLike);
  const parts = forms.map((form) => like(column, mode === "word" ? `% ${form} %` : `% ${form}%`, param));
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

/** Every term of the variant, in the given column and mode; null when the mode cannot apply. */
function variantCondition(column, mode, variant, param) {
  const parts = [];
  for (const term of variant.terms) {
    const condition = termCondition(column, mode, term, param);
    if (!condition) return null;
    parts.push(condition);
  }
  return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
}

function anyVariant(column, mode, variants, param) {
  const parts = variants.map((variant) => variantCondition(column, mode, variant, param)).filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

function ladder(steps) {
  const arms = steps.filter(([condition]) => condition).map(([condition, value]) => `WHEN ${condition} THEN ${value}`);
  return arms.length ? `CASE ${arms.join(" ")} ELSE 0 END` : "0";
}

function fuzzyTerm(concept) {
  if (concept.words.length !== 1) return null;
  const word = concept.words[0];
  if (letters(word) < FUZZY_MIN_LETTERS || /^[0-9]+$/.test(word)) return null;
  return word;
}

/**
 * The two score expressions of one concept: `exact` (0..8, every non-typo way it can match) and
 * `fuzzy` (0..2, the typed word within typo distance). A typo only counts when NO row matches the
 * concept for real — "did you mean" — so «بالوردي» never drags in «بالون» next to the pink flowers.
 * @param {{ words: string[], variants: Array<{ terms: string[], kind: string }> }} concept
 * @param {{ title: string, tags: string }} columns  SQL column references
 * @param {(value: unknown) => string} param
 * @param {string | null} extraCondition  SQL that scores 2 when true (placement labels)
 */
export function conceptScoreSql(concept, columns, param, extraCondition = null) {
  const strong = concept.variants.filter((variant) => variant.kind !== "derived");
  const derived = concept.variants.filter((variant) => variant.kind === "derived");
  const strongLadder = ladder([
    [anyVariant(columns.title, "word", strong, param), 8],
    [anyVariant(columns.title, "start", strong, param), 6],
    [anyVariant(columns.title, "contains", strong, param), 5],
    [anyVariant(columns.tags, "word", strong, param), 4],
    [anyVariant(columns.tags, "start", strong, param), 3],
    [anyVariant(columns.tags, "contains", strong, param), 2],
    [extraCondition, 2],
  ]);
  const derivedLadder = derived.length
    ? ladder([
        [anyVariant(columns.title, "word", derived, param), 5],
        [anyVariant(columns.title, "start", derived, param), 4],
        [anyVariant(columns.tags, "word", derived, param), 3],
        [anyVariant(columns.tags, "start", derived, param), 2],
      ])
    : "0";
  const word = fuzzyTerm(concept);
  const similarity = word
    ? `GREATEST(word_similarity(${param(word)}, ${columns.title}), word_similarity(${param(word)}, ${columns.tags}))`
    : null;
  return {
    exact: derived.length ? `GREATEST(${strongLadder}, ${derivedLadder})` : strongLadder,
    fuzzy: similarity ? `CASE WHEN ${similarity} >= ${FUZZY_STRONG} THEN 2 WHEN ${similarity} >= ${FUZZY_THRESHOLD} THEN 1 ELSE 0 END` : "0",
  };
}

/**
 * The scoring CTEs shared by template and element search. Produces a CTE named `kept` with the
 * `carry` columns plus `matched` (concepts matched) and `quality` (sum of the concept classes),
 * holding only the rows that match as many concepts as the best row (and at least half), or that
 * satisfy `keepAlso`.
 *
 * @param {{ plan, columns, param, from: string, where: string, select: Array<[string, string]>,
 *           extras?: Array<string | null>, keepAlso?: string | null }} options
 *   select: [sqlExpression, alias] pairs carried through (an alias must be a plain identifier)
 */
export function scoredSearchCtes({ plan, columns, param, from, where, select, extras = [], keepAlso = null }) {
  const concepts = plan.concepts;
  const scores = concepts.map((concept, index) => conceptScoreSql(concept, columns, param, extras[index] || null));
  const prefilter = planPrefilterSql(plan, columns, param, extras);
  const carry = select.map(([, alias]) => alias);
  const scoredColumns = [
    ...select.map(([expression, alias]) => `${expression} AS ${alias}`),
    ...scores.flatMap((score, index) => [`${score.exact} AS e${index}`, `${score.fuzzy} AS f${index}`]),
  ];
  const effectiveColumns = [
    ...carry,
    ...concepts.map((_, index) => `CASE WHEN max(e${index}) OVER () > 0 THEN e${index} ELSE f${index} END AS c${index}`),
  ];
  const matched = concepts.map((_, index) => `(c${index} > 0)::int`).join(" + ");
  const quality = concepts.map((_, index) => `c${index}`).join(" + ");
  const minimum = param(minimumMatchedConcepts(plan));
  return `
    WITH scored AS (
      SELECT ${scoredColumns.join(", ")}
      FROM ${from}
      WHERE ${where}
        AND ${prefilter}
    ), effective AS (
      SELECT ${effectiveColumns.join(", ")} FROM scored
    ), counted AS (
      SELECT ${carry.join(", ")}, (${matched})::int AS matched, (${quality})::int AS quality FROM effective
    ), kept AS (
      SELECT * FROM counted
      WHERE (matched > 0 AND matched >= GREATEST(${minimum}::int, (SELECT max(matched) FROM counted)))${keepAlso ? ` OR ${keepAlso}` : ""}
    )
  `;
}

/**
 * A cheap, index-friendly superset of every concept's matches (the WHERE prefilter): any variant
 * term anywhere in either column, or the typed word within typo distance.
 */
export function planPrefilterSql(plan, columns, param, extraConditions = []) {
  const parts = [];
  for (const concept of plan.concepts) {
    for (const variant of concept.variants) {
      for (const term of variant.terms) {
        const escaped = escapeLike(term);
        const pattern = letters(term) >= 3 ? `%${escaped}%` : `% ${escaped} %`;
        parts.push(like(columns.title, pattern, param), like(columns.tags, pattern, param));
      }
    }
    const fuzzy = fuzzyTerm(concept);
    // `<%` is pg_trgm's word-similarity operator — the indexable form of the typo check above.
    // Its threshold is the session setting: run SEARCH_SESSION_SQL first.
    if (fuzzy) parts.push(`${param(fuzzy)} <% ${columns.title}`, `${param(fuzzy)} <% ${columns.tags}`);
  }
  for (const extra of extraConditions) if (extra) parts.push(extra);
  return parts.length ? `(${Array.from(new Set(parts)).join(" OR ")})` : "FALSE";
}

/** At least half of the concepts must match (and as many as the best row matches). */
export function minimumMatchedConcepts(plan) {
  const count = plan?.concepts?.length || 0;
  return Math.max(1, Math.ceil(count / 2));
}
