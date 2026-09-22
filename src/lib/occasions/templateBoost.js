/**
 * Template-side helpers of the seasonal boost: the Prisma `where` fragment that selects
 * boosted templates, and its in-memory twin for the search path that already holds every
 * candidate row.
 */
import { templateCategoryScopeWhere } from "@/lib/templates/categoryQuery";

function isPublishedPair(pair, taxonomy) {
  const category = taxonomy?.categoryByValue?.get(String(pair?.category || ""));
  if (!category) return false;
  const subCategory = String(pair?.subCategory || "");
  if (!subCategory) return true;
  return (Array.isArray(category.subCategories) ? category.subCategories : []).some(
    (item) => String(item?.value || "") === subCategory
  );
}

/**
 * `OR` fragment matching every boosted template — linked ids plus every template placed
 * under a linked (published) category pair. Null when nothing is boosted. Safe to pass to
 * `mergeTemplateWhere`, which AND-merges it with the caller's own filters.
 *
 * @param {{ templateIds?: string[], templateCategoryPairs?: Array<{ category: string, subCategory?: string | null }> } | null | undefined} snapshot
 * @param {{ categoryByValue?: Map<string, any> }} taxonomy the output of prepareMobileTaxonomy
 */
export function buildTemplateBoostWhere(snapshot, taxonomy) {
  const ids = Array.isArray(snapshot?.templateIds) ? snapshot.templateIds : [];
  const pairs = (Array.isArray(snapshot?.templateCategoryPairs) ? snapshot.templateCategoryPairs : []).filter(
    (pair) => isPublishedPair(pair, taxonomy)
  );
  const scope = templateCategoryScopeWhere(pairs);
  const arms = [...(ids.length ? [{ id: { in: ids } }] : []), ...(scope ? scope.OR : [])];
  return arms.length ? { OR: arms } : null;
}

/**
 * In-memory predicate equivalent to `buildTemplateBoostWhere`, for rows that carry
 * `id`, `category`, `subCategory` and `categories`. Null when nothing is boosted.
 *
 * @param {{ templateIds?: string[], templateCategoryPairs?: Array<{ category: string, subCategory?: string | null }> } | null | undefined} snapshot
 * @returns {((template: any) => boolean) | null}
 */
export function makeTemplateBoostPredicate(snapshot) {
  const ids = new Set(Array.isArray(snapshot?.templateIds) ? snapshot.templateIds : []);
  const pairs = Array.isArray(snapshot?.templateCategoryPairs) ? snapshot.templateCategoryPairs : [];
  const pairKeys = new Set(
    pairs
      .filter((pair) => String(pair?.subCategory || ""))
      .map((pair) => `${String(pair.category || "")}::${String(pair.subCategory || "")}`)
  );
  const categoryKeys = new Set(
    pairs.filter((pair) => !String(pair?.subCategory || "")).map((pair) => String(pair?.category || ""))
  );
  if (!ids.size && !pairKeys.size && !categoryKeys.size) return null;

  return (template) => {
    if (ids.has(String(template?.id || ""))) return true;
    const placements =
      Array.isArray(template?.categories) && template.categories.length
        ? template.categories
        : [{ category: template?.category, subCategory: template?.subCategory }];
    return placements.some((placement) => {
      const category = String(placement?.category || "");
      const subCategory = String(placement?.subCategory || "");
      return categoryKeys.has(category) || pairKeys.has(`${category}::${subCategory}`);
    });
  };
}

/**
 * Re-sorts fetched boosted rows into the snapshot's own order (occasion proximity, then
 * link order) so an admin's arrangement survives the database's `updatedAt` ordering.
 * @template {{ id: string }} T
 * @param {T[]} rows
 * @param {string[]} orderedIds
 */
export function sortRowsBySnapshotOrder(rows, orderedIds) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  const rank = new Map();
  (Array.isArray(orderedIds) ? orderedIds : []).forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return [...rows].sort((a, b) => {
    const left = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const right = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}
