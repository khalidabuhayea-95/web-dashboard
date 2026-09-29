import prisma from "@/lib/prisma";

/**
 * How many templates sit under each category and each {category, subCategory} pair.
 *
 * A template belongs to a placement when it is the primary pair (the scalar columns) or appears in
 * its `categories` list — the same rule `templateCategoryWhere` filters by, so these numbers match
 * what the dashboard list and the app would return. Each template counts ONCE per category even when
 * it has two placements inside it. The whole table is read in one query: a count per row of the
 * taxonomy would be ~100 round trips for a page that shows them all at once.
 */
export async function getTemplateCategoryCounts() {
  const rows = await prisma.template.findMany({
    select: { id: true, status: true, category: true, subCategory: true, categories: true },
  });

  const byCategory = new Map();
  const byPair = new Map();
  const add = (map, key, row) => {
    const entry = map.get(key) || { total: 0, published: 0, ids: new Set() };
    if (entry.ids.has(row.id)) return;
    entry.ids.add(row.id);
    entry.total += 1;
    if (String(row.status || "").toLowerCase() === "published") entry.published += 1;
    map.set(key, entry);
  };

  for (const row of rows) {
    const placements = [
      { category: row.category, subCategory: row.subCategory },
      ...(Array.isArray(row.categories) ? row.categories : []),
    ];
    for (const placement of placements) {
      const category = String(placement?.category || "").trim();
      if (!category) continue;
      add(byCategory, category, row);
      const subCategory = String(placement?.subCategory || "").trim();
      if (subCategory) add(byPair, `${category}|${subCategory}`, row);
    }
  }

  const serialize = (map) =>
    Object.fromEntries(
      [...map.entries()].map(([key, { total, published }]) => [key, { total, published }])
    );
  return { total: rows.length, categories: serialize(byCategory), subCategories: serialize(byPair) };
}
