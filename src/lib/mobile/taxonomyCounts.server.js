import prisma from "@/lib/prisma";
import { buildPublishedTemplateScopeWhere } from "@/lib/mobile/taxonomy";
import { mergeTemplateWhere } from "@/lib/templates/categoryQuery";

/**
 * How many templates a caller would get from /api/mobile/templates for each category and each
 * {category, subCategory} — the `templateCount` the taxonomy carries so the app can skip empty
 * categories without probing them one request at a time (production audit M-18 / REG-09).
 *
 * Same visibility rules as the list routes: the caller's audience statuses (published; drafts too
 * for a tester account) and only templates with at least one placement inside the PUBLISHED
 * taxonomy. Placement semantics mirror templateCategoryWhere exactly — the scalar primary pair or
 * any element of `categories` — so a count equals what that category/sub-category filter returns,
 * and a template is counted once per category even when it sits in two of its sub categories.
 */

// The taxonomy is fetched on every launch and pull-to-refresh; one light read per audience every
// half minute is plenty (the response itself is publicly cacheable for 5 minutes on top).
const COUNTS_CACHE_TTL_MS = 30_000;
const countsCache = new Map();

/**
 * Pure tally over light rows — exported for tests.
 * @param {Array<{ id: string, category?: string | null, subCategory?: string | null, categories?: unknown }>} rows
 * @returns {{ byCategory: Map<string, number>, byPair: Map<string, number> }}
 */
export function tallyTemplatePlacements(rows) {
  const byCategory = new Map();
  const byPair = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const categories = new Set();
    const pairs = new Set();
    const placements = [
      { category: row?.category, subCategory: row?.subCategory },
      ...(Array.isArray(row?.categories) ? row.categories : []),
    ];
    for (const placement of placements) {
      const category = String(placement?.category || "");
      if (!category) continue;
      categories.add(category);
      const subCategory = String(placement?.subCategory || "");
      if (subCategory) pairs.add(`${category}::${subCategory}`);
    }
    for (const category of categories) byCategory.set(category, (byCategory.get(category) || 0) + 1);
    for (const pair of pairs) byPair.set(pair, (byPair.get(pair) || 0) + 1);
  }
  return { byCategory, byPair };
}

/**
 * @param {{ categories: Array<{ value: string, subCategories?: Array<{ value: string }> }> }} taxonomy prepared (published-only) taxonomy
 * @param {readonly string[]} statuses from resolveTemplateAudience
 */
export async function getTemplateCountsByPlacement(taxonomy, statuses) {
  const scopeWhere = buildPublishedTemplateScopeWhere(taxonomy);
  const statusList = Array.isArray(statuses) ? [...statuses].sort() : [];
  if (!scopeWhere || statusList.length === 0) return tallyTemplatePlacements([]);

  // Keyed by the published pairs too, so a taxonomy edit never serves counts for the old shape.
  const pairsKey = taxonomy.categories
    .map((category) => `${category.value}:${(category.subCategories || []).map((sub) => sub.value).join(",")}`)
    .join("|");
  const cacheKey = `${statusList.join(",")}#${pairsKey}`;
  const cached = countsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const rows = await prisma.template.findMany({
    where: mergeTemplateWhere({ status: { in: statusList } }, scopeWhere),
    select: { id: true, category: true, subCategory: true, categories: true },
  });
  const value = tallyTemplatePlacements(rows);
  // Successes only — a failed read throws to the route (503) and is retried next request. There
  // are two audiences per taxonomy shape, so a handful of keys is the whole working set.
  if (countsCache.size >= 8) countsCache.clear();
  countsCache.set(cacheKey, { value, expiresAt: now + COUNTS_CACHE_TTL_MS });
  return value;
}

/**
 * Adds `templateCount` to localized taxonomy options (the shape localizeCategoryOptions returns),
 * on every category and every sub category. Purely additive: nothing else changes.
 */
export function withTemplateCounts(categories, counts) {
  return (Array.isArray(categories) ? categories : []).map((category) => {
    const categoryValue = String(category?.value || "");
    return {
      ...category,
      templateCount: counts.byCategory.get(categoryValue) || 0,
      subCategories: (Array.isArray(category?.subCategories) ? category.subCategories : []).map(
        (subCategory) => ({
          ...subCategory,
          templateCount: counts.byPair.get(`${categoryValue}::${String(subCategory?.value || "")}`) || 0,
        })
      ),
    };
  });
}
