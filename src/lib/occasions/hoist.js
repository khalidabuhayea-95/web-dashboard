/**
 * Pure list re-ordering used by the seasonal boost: move the entries whose key is linked
 * to an active occasion to the front, in the order the occasions listed them, and leave
 * everything else exactly as it was. Returns the SAME array reference when there is
 * nothing to do, so callers can rely on "no boost → byte-identical output".
 */

/**
 * @template T
 * @param {T[]} items
 * @param {string[]} keys keys to hoist, most important first
 * @param {(item: T) => string} [getKey]
 * @returns {T[]}
 */
export function hoistToFront(items, keys, getKey = (item) => /** @type {any} */ (item)) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const wanted = (Array.isArray(keys) ? keys : []).map((key) => String(key || "")).filter(Boolean);
  if (wanted.length === 0) return items;
  const rank = new Map();
  wanted.forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });
  const front = [];
  const rest = [];
  for (const item of items) {
    (rank.has(String(getKey(item) || "")) ? front : rest).push(item);
  }
  if (front.length === 0) return items;
  front.sort((a, b) => rank.get(String(getKey(a) || "")) - rank.get(String(getKey(b) || "")));
  return [...front, ...rest];
}

/**
 * Applies an occasion's linked template categories to a localized category list (the output
 * of `localizeCategoryOptions`): a linked category moves to the front, and a linked
 * `category/subCategory` pair also moves that sub-category to the front of its category.
 *
 * Never call this on the taxonomy object itself or on the cached settings array — both
 * are shared with the dashboard and use index 0 as a fallback.
 *
 * @param {Array<{ value: string, subCategories?: Array<{ value: string }> }>} categories
 * @param {{ hoistedTemplateCategoryPairs?: Array<{ category: string, subCategory?: string | null }> } | null | undefined} snapshot
 */
export function applyOccasionCategoryOrder(categories, snapshot) {
  const pairs = Array.isArray(snapshot?.hoistedTemplateCategoryPairs)
    ? snapshot.hoistedTemplateCategoryPairs
    : [];
  if (!Array.isArray(categories) || categories.length === 0 || pairs.length === 0) return categories;

  const subKeysByCategory = new Map();
  for (const pair of pairs) {
    const category = String(pair?.category || "");
    const subCategory = String(pair?.subCategory || "");
    if (!category || !subCategory) continue;
    const list = subKeysByCategory.get(category) || [];
    list.push(subCategory);
    subKeysByCategory.set(category, list);
  }

  let changed = false;
  const withSubs = categories.map((category) => {
    const subKeys = subKeysByCategory.get(String(category?.value || ""));
    if (!subKeys) return category;
    const reordered = hoistToFront(
      Array.isArray(category.subCategories) ? category.subCategories : [],
      subKeys,
      (sub) => String(sub?.value || "")
    );
    if (reordered === category.subCategories) return category;
    changed = true;
    return { ...category, subCategories: reordered };
  });

  const hoisted = hoistToFront(
    withSubs,
    pairs.map((pair) => String(pair?.category || "")),
    (category) => String(category?.value || "")
  );
  if (hoisted === withSubs && !changed) return categories;
  return hoisted;
}

/**
 * Stable partition: items matching `predicate` first (in their original order), then the
 * rest (in their original order). Same reference when nothing matches.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => boolean} predicate
 */
export function stablePartition(items, predicate) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const first = [];
  const rest = [];
  for (const item of items) (predicate(item) ? first : rest).push(item);
  if (first.length === 0) return items;
  return [...first, ...rest];
}
