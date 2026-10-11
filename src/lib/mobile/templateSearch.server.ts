/**
 * Template search for the mobile API (production audit H-18 / PAR-02).
 *
 * One SQL statement finds every template whose normalised title, tags or published
 * category/sub-category labels (AR + EN) contain EVERY query token, and reports how strongly each
 * matched so the list routes can rank title hits above tag/label hits:
 *
 *   rawHit     the title contains the query exactly as typed (case-insensitive) — today's match,
 *              and what shipped app builds still re-filter /templates and /by-subcategory results
 *              by on the device, so these lead every page and old clients keep full pages;
 *   titleHits  how many tokens the normalised title contains.
 *
 * The fold is applied in Postgres (regexp_replace + replace + translate + lower) from the same
 * tables the JS normaliser uses (src/lib/text/arabicSearch.js), so the query and the rows always
 * agree. It is a sequential scan of the visible templates with a few string functions per row:
 * ~12 ms of execution for the current 519 published templates, i.e. roughly linear — about 0.1 s
 * at 5,000. Past that, a stored normalised column + trigram index is the next step.
 */
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { stablePartition } from "@/lib/occasions/hoist";
import { sortFeaturedFirst } from "@/lib/templates/featured";
import {
  SEARCH_DIGITS_CLASS,
  SEARCH_DIGITS_FROM,
  SEARCH_DIGITS_TO,
  SEARCH_LETTER_FOLDS,
  SEARCH_MARKS_CLASS,
  matchTaxonomyLabels,
  toContainsPattern,
  tokenizeSearchQuery,
} from "@/lib/text/arabicSearch";

/** Upper bound on matches kept per search (most relevant first); pagination runs over these. */
export const MAX_TEMPLATE_SEARCH_MATCHES = 5000;

export type TemplateSearchMatch = { rawHit: boolean; titleHits: number };

export type TemplateSearchResult = {
  tokens: string[];
  /** Matching template ids, most relevant first. Empty when the query has no usable token. */
  matches: Map<string, TemplateSearchMatch>;
  truncated: boolean;
};

type SearchTaxonomy = {
  categories: Array<{
    value: string;
    labelAr?: string;
    labelEn?: string;
    subCategories?: Array<{ value: string; labelAr?: string; labelEn?: string }>;
  }>;
};

/**
 * The JS fold (normalizeSearchText) in SQL: digits (only on the rare row that has one — translate
 * is the expensive call), then tashkeel/tatweel, then the letter folds, then lower(). The steps
 * touch disjoint characters, so their order does not matter.
 */
export function normalizedSearchSql(expression: Prisma.Sql): Prisma.Sql {
  const digitsFolded = Prisma.sql`CASE WHEN ${expression} ~ ${SEARCH_DIGITS_CLASS} THEN translate(${expression}, ${SEARCH_DIGITS_FROM}, ${SEARCH_DIGITS_TO}) ELSE ${expression} END`;
  const stripped = Prisma.sql`regexp_replace(${digitsFolded}, ${SEARCH_MARKS_CLASS}, '', 'g')`;
  const lettersFolded = SEARCH_LETTER_FOLDS.reduce<Prisma.Sql>(
    (folded, [from, to]) => Prisma.sql`replace(${folded}, ${from}, ${to})`,
    stripped
  );
  return Prisma.sql`lower(${lettersFolded})`;
}

// Tags are a jsonb array of strings. Its text form (["a", "b"]) is searched as is: tokens are
// letters/digits only, so they can never match the quotes and commas or span two tags.
const TAGS_TEXT_SQL = Prisma.sql`t."tags"::text`;

function tokenConditionSql(
  pattern: string,
  labels: { categoryValues: string[]; pairs: Array<{ category: string; subCategory: string }> }
): Prisma.Sql {
  const alternatives: Prisma.Sql[] = [
    Prisma.sql`s.title_n LIKE ${pattern} ESCAPE '\\'`,
    Prisma.sql`s.tags_n LIKE ${pattern} ESCAPE '\\'`,
  ];
  // Placement semantics match templateCategoryWhere: the scalar primary pair, or any element of
  // the `categories` list (null on legacy rows, hence the coalesce).
  if (labels.categoryValues.length > 0) {
    alternatives.push(Prisma.sql`s."category" = ANY(${labels.categoryValues}::text[])`);
  }
  if (labels.pairs.length > 0) {
    const pairKeys = labels.pairs.map((pair) => `${pair.category}::${pair.subCategory}`);
    alternatives.push(Prisma.sql`(s."category" || '::' || s."subCategory") = ANY(${pairKeys}::text[])`);
  }
  const placementPatterns = [
    ...labels.categoryValues.map((category) => JSON.stringify([{ category }])),
    ...labels.pairs.map((pair) => JSON.stringify([{ category: pair.category, subCategory: pair.subCategory }])),
  ];
  if (placementPatterns.length > 0) {
    alternatives.push(
      Prisma.sql`coalesce(s."categories" @> ANY(${placementPatterns}::jsonb[]), false)`
    );
  }
  return Prisma.sql`(${Prisma.join(alternatives, " OR ")})`;
}

/**
 * Every visible template matching `query` (token-AND across title, tags and placement labels),
 * most relevant first. `statuses` comes from the caller's template audience — the only place
 * that decides whether drafts are visible.
 */
export async function findTemplateSearchMatches({
  query,
  statuses,
  taxonomy,
  limit = MAX_TEMPLATE_SEARCH_MATCHES,
}: {
  query: string;
  statuses: readonly string[];
  taxonomy: SearchTaxonomy;
  limit?: number;
}): Promise<TemplateSearchResult> {
  const tokens = tokenizeSearchQuery(query);
  const matches = new Map<string, TemplateSearchMatch>();
  if (tokens.length === 0 || statuses.length === 0) return { tokens, matches, truncated: false };

  const labelMatches = matchTaxonomyLabels(tokens, taxonomy?.categories || []);
  const patterns = tokens.map((token) => toContainsPattern(token));
  const conditions = patterns.map((pattern, index) => tokenConditionSql(pattern, labelMatches[index]));
  const titleHitsSql = Prisma.join(
    patterns.map((pattern) => Prisma.sql`(s.title_n LIKE ${pattern} ESCAPE '\\')::int`),
    " + "
  );
  const rawQuery = String(query || "").trim().toLowerCase();
  const take = Math.max(1, Math.floor(limit)) + 1;

  const rows = await prisma.$queryRaw<Array<{ id: string; raw_hit: boolean; title_hits: number }>>`
    SELECT s."id"::text AS id, s.raw_hit, (${titleHitsSql})::int AS title_hits
    FROM (
      SELECT t."id", t."category", t."subCategory", t."categories", t."updatedAt",
             strpos(lower(t."name"), ${rawQuery}) > 0 AS raw_hit,
             ${normalizedSearchSql(Prisma.sql`t."name"`)} AS title_n,
             ${normalizedSearchSql(TAGS_TEXT_SQL)} AS tags_n
      FROM "Template" t
      WHERE t."status" = ANY(${[...statuses]}::text[])
      -- Fence: fold each row once, not once per token reference below.
      OFFSET 0
    ) s
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY s.raw_hit DESC, title_hits DESC, s."updatedAt" DESC
    LIMIT ${take}
  `;

  const truncated = rows.length >= take;
  for (const row of truncated ? rows.slice(0, take - 1) : rows) {
    matches.set(String(row.id), { rawHit: Boolean(row.raw_hit), titleHits: Number(row.title_hits) || 0 });
  }
  return { tokens, matches, truncated };
}

/** Relevance tier of a template: exact title hits, then more title tokens, then tags/labels. */
export function compareSearchRelevance(
  left: TemplateSearchMatch | undefined,
  right: TemplateSearchMatch | undefined
): number {
  const rawLeft = left?.rawHit ? 1 : 0;
  const rawRight = right?.rawHit ? 1 : 0;
  if (rawLeft !== rawRight) return rawRight - rawLeft;
  return (right?.titleHits || 0) - (left?.titleHits || 0);
}

/**
 * Orders matched rows for a search page. Relevance first (see compareSearchRelevance); inside one
 * relevance tier the catalogue's usual order holds — featured (newest-featured first), then the
 * active occasion's boosted templates, then the rest in their incoming (recency) order.
 */
export function rankTemplateSearchRows<
  T extends { id: string; isFeatured?: boolean | null; featuredAt?: Date | string | null; updatedAt?: Date | string | null }
>(
  rows: T[],
  matches: Map<string, TemplateSearchMatch>,
  isBoosted: ((row: T) => boolean) | null = null
): T[] {
  const tiers: Array<{ match: TemplateSearchMatch; rows: T[] }> = [];
  for (const row of rows) {
    const match = matches.get(row.id) || { rawHit: false, titleHits: 0 };
    const tier = tiers.find((entry) => compareSearchRelevance(entry.match, match) === 0);
    if (tier) tier.rows.push(row);
    else tiers.push({ match, rows: [row] });
  }
  tiers.sort((left, right) => compareSearchRelevance(left.match, right.match));
  return tiers.flatMap((tier) => {
    const partitioned = isBoosted ? stablePartition(tier.rows, isBoosted) : tier.rows;
    return sortFeaturedFirst(partitioned);
  });
}
