/**
 * Template search for the mobile API (production audit H-18 / PAR-02; smart search 2026-10-19).
 *
 * The query is planned by src/lib/search (synonyms in both languages, Arabic clitics and stems,
 * English plurals, a cached machine translation of every word no synonym bridges, typo tolerance)
 * and matched in ONE statement over the stored, folded columns "searchTitle" (the name) and
 * "searchTags" (designer tags + machine keywords: the name translated into the other language),
 * both trigram-indexed (migration 20261019120000), plus the published category / sub-category
 * labels (AR + EN). Each template reports:
 *
 *   rawHit   the name contains the query exactly as typed (case-insensitive) — always first;
 *   matched  how many query concepts it matches (rows matching fewer than the best row are dropped);
 *   quality  the sum of the per-concept match classes (title word > title start > … > typo), see
 *            src/lib/search/searchSql.js.
 */
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { stablePartition } from "@/lib/occasions/hoist";
import { SEARCH_SESSION_SQL, dedupingParam, scoredSearchCtes } from "@/lib/search/searchSql";
import { planSearchQuery } from "@/lib/search/searchTranslate.server";
import { sortFeaturedFirst } from "@/lib/templates/featured";
import {
  SEARCH_DIGITS_CLASS,
  SEARCH_DIGITS_FROM,
  SEARCH_DIGITS_TO,
  SEARCH_LETTER_FOLDS,
  SEARCH_MARKS_CLASS,
  matchTaxonomyLabels,
} from "@/lib/text/arabicSearch";

/** Upper bound on matches kept per search (most relevant first); pagination runs over these. */
export const MAX_TEMPLATE_SEARCH_MATCHES = 5000;

export type TemplateSearchMatch = { rawHit: boolean; matched: number; quality: number };

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

type Placements = { categoryValues: string[]; pairs: Array<{ category: string; subCategory: string }> };

/** SQL that is true when the row is filed under one of the label-matched placements. */
function placementConditionSql(labels: Placements, param: (value: unknown) => string): string | null {
  const alternatives: string[] = [];
  // Placement semantics match templateCategoryWhere: the scalar primary pair, or any element of
  // the `categories` list (null on legacy rows, hence the coalesce).
  if (labels.categoryValues.length > 0) {
    alternatives.push(`t."category" = ANY(${param(labels.categoryValues)}::text[])`);
  }
  if (labels.pairs.length > 0) {
    const pairKeys = labels.pairs.map((pair) => `${pair.category}::${pair.subCategory}`);
    alternatives.push(`(t."category" || '::' || t."subCategory") = ANY(${param(pairKeys)}::text[])`);
  }
  const placementPatterns = [
    ...labels.categoryValues.map((category) => JSON.stringify([{ category }])),
    ...labels.pairs.map((pair) => JSON.stringify([{ category: pair.category, subCategory: pair.subCategory }])),
  ];
  if (placementPatterns.length > 0) {
    alternatives.push(`coalesce(t."categories" @> ANY(${param(placementPatterns)}::jsonb[]), false)`);
  }
  return alternatives.length ? `(${alternatives.join(" OR ")})` : null;
}

/** The placements whose AR / EN label contains any non-derived variant of the concept. */
function conceptPlacements(
  concept: { variants: Array<{ terms: string[]; kind: string }> },
  taxonomy: SearchTaxonomy
): Placements {
  const terms = concept.variants
    .filter((variant) => variant.kind !== "derived")
    .map((variant) => variant.terms.join(" "));
  const categoryValues = new Set<string>();
  const pairs = new Map<string, { category: string; subCategory: string }>();
  for (const hit of matchTaxonomyLabels(terms, taxonomy?.categories || [])) {
    hit.categoryValues.forEach((value: string) => categoryValues.add(value));
    hit.pairs.forEach((pair: { category: string; subCategory: string }) => pairs.set(`${pair.category}::${pair.subCategory}`, pair));
  }
  return { categoryValues: [...categoryValues], pairs: [...pairs.values()] };
}

/**
 * Every visible template matching `query`, most relevant first. `statuses` comes from the
 * caller's template audience — the only place that decides whether drafts are visible.
 */
export async function findTemplateSearchMatches({
  query,
  statuses,
  taxonomy,
  limit = MAX_TEMPLATE_SEARCH_MATCHES,
  translate = true,
}: {
  query: string;
  statuses: readonly string[];
  taxonomy: SearchTaxonomy;
  limit?: number;
  /** false skips the machine translation step (tests, offline tools). */
  translate?: boolean;
}): Promise<TemplateSearchResult> {
  const plan = await planSearchQuery(query, { translate });
  const tokens: string[] = plan.tokens;
  const matches = new Map<string, TemplateSearchMatch>();
  if (plan.concepts.length === 0 || statuses.length === 0) return { tokens, matches, truncated: false };

  const params: unknown[] = [];
  const param = dedupingParam((value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  });
  const columns = { title: 't."searchTitle"', tags: 't."searchTags"' };
  const placements = plan.concepts.map((concept: any) => placementConditionSql(conceptPlacements(concept, taxonomy), param));
  const rawQuery = String(query || "").trim().toLowerCase();
  const take = Math.max(1, Math.floor(limit)) + 1;
  const ctes = scoredSearchCtes({
    plan,
    columns: { title: 't."searchTitle"', tags: 't."searchTags"' },
    param,
    from: '"Template" t',
    where: `t."status" = ANY(${param([...statuses])}::text[])`,
    select: [
      ['t."id"', "id"],
      ['t."updatedAt"', "updated_at"],
      [`strpos(lower(t."name"), ${param(rawQuery)}) > 0`, "raw_hit"],
    ],
    extras: placements,
    // The name containing the query as typed always counts (old builds re-filter by it).
    keepAlso: "raw_hit",
  });
  const sql = `${ctes}
    SELECT id::text AS id, raw_hit, matched, quality
    FROM kept
    ORDER BY raw_hit DESC, matched DESC, quality DESC, updated_at DESC
    LIMIT ${param(take)}
  `;
  const [, rows] = (await prisma.$transaction([
    prisma.$queryRawUnsafe(SEARCH_SESSION_SQL),
    prisma.$queryRawUnsafe(sql, ...params),
  ])) as [unknown, Array<{ id: string; raw_hit: boolean; matched: number; quality: number }>];

  const truncated = rows.length >= take;
  for (const row of truncated ? rows.slice(0, take - 1) : rows) {
    matches.set(String(row.id), {
      rawHit: Boolean(row.raw_hit),
      matched: Number(row.matched) || 0,
      quality: Number(row.quality) || 0,
    });
  }
  if (matches.size === 0) {
    // The synonym list grows from these (src/lib/search/searchSynonyms.js).
    logger.info("Search returned nothing", { scope: "templates", query: String(query || "").slice(0, 120) });
  }
  return { tokens, matches, truncated };
}

/** Relevance tier of a template: exact name hits, then more concepts matched, then match quality. */
export function compareSearchRelevance(
  left: TemplateSearchMatch | undefined,
  right: TemplateSearchMatch | undefined
): number {
  const rawLeft = left?.rawHit ? 1 : 0;
  const rawRight = right?.rawHit ? 1 : 0;
  if (rawLeft !== rawRight) return rawRight - rawLeft;
  const matched = (right?.matched || 0) - (left?.matched || 0);
  if (matched !== 0) return matched;
  return (right?.quality || 0) - (left?.quality || 0);
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
    const match = matches.get(row.id) || { rawHit: false, matched: 0, quality: 0 };
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
