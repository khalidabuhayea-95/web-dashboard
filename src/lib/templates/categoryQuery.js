/**
 * Prisma `where` fragments for the multi-category placement model.
 *
 * A template matches a placement when it is either the primary pair (the scalar
 * `category`/`subCategory` columns, which the status+category+subCategory composite index
 * covers) or appears anywhere in the `categories` JSON list. Rows written before the
 * multi-category migration only have the scalars, so the scalar arm is load-bearing, not
 * just an index hint.
 *
 * Every fragment here is safe to drop into an `AND: [...]` list — they never collide on
 * an `OR` key with a caller's own filters.
 */

function containsPair(pair) {
  // Prisma compiles array_contains to jsonb `@>`, which matches recursively: an element
  // filter of { category } alone matches a { category, subCategory } element.
  return { categories: { array_contains: [pair] } };
}

/**
 * Match templates placed under `category` (and `subCategory`, when given). Returns null
 * when neither is set, so callers can `.filter(Boolean)` it away.
 */
export function templateCategoryWhere({ category, subCategory } = {}) {
  const categoryValue = String(category || "").trim();
  const subCategoryValue = String(subCategory || "").trim();

  if (categoryValue && subCategoryValue) {
    return {
      OR: [
        { AND: [{ category: categoryValue }, { subCategory: subCategoryValue }] },
        containsPair({ category: categoryValue, subCategory: subCategoryValue }),
      ],
    };
  }

  if (categoryValue) {
    return {
      OR: [{ category: categoryValue }, containsPair({ category: categoryValue })],
    };
  }

  if (subCategoryValue) {
    return {
      OR: [{ subCategory: subCategoryValue }, containsPair({ subCategory: subCategoryValue })],
    };
  }

  return null;
}

/**
 * Match templates placed under ANY of `pairs` — used to scope the catalog to the published
 * slice of the taxonomy. Returns null for an empty list (caller decides what that means).
 */
export function templateCategoryScopeWhere(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  const clauses = list.map((pair) => templateCategoryWhere(pair)).filter(Boolean);
  if (clauses.length === 0) return null;
  return { OR: clauses.flatMap((clause) => clause.OR) };
}

/** Merge where fragments without letting two of them fight over the same `OR` key. */
export function mergeTemplateWhere(...fragments) {
  const list = fragments.filter((fragment) => fragment && Object.keys(fragment).length > 0);
  if (list.length === 0) return {};
  if (list.length === 1) return list[0];
  return { AND: list };
}
