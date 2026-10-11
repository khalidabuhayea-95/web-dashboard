/**
 * Per-category template counts for /api/mobile/templates/taxonomy (production audit M-18).
 *
 * Pure tests always run. The parity test — every count equals what the list endpoint's own
 * Prisma filter returns — needs a DISPOSABLE database (see templateSearch.server.test.ts) and is
 * skipped without NAYROZ_TEST_DATABASE_URL.
 * Run: NAYROZ_TEST_DATABASE_URL=… node --import tsx --test src/lib/mobile/taxonomyCounts.server.test.js
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { tallyTemplatePlacements, withTemplateCounts } from "@/lib/mobile/taxonomyCounts.server";

const TEST_DATABASE_URL = process.env.NAYROZ_TEST_DATABASE_URL || "";
const skipDb = !TEST_DATABASE_URL;
if (!skipDb) {
  const parsed = new URL(TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !/_test$/.test(parsed.pathname)) {
    throw new Error("Refusing to write test rows outside a local *_test database.");
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

test("a template counts once per category and once per placement pair", () => {
  const counts = tallyTemplatePlacements([
    // Primary pair duplicated in `categories` (the normal shape since multi-category).
    { id: "a", category: "islamic", subCategory: "ramadan", categories: [{ category: "islamic", subCategory: "ramadan" }] },
    // Two sub categories inside one category: 1 for the category, 1 for each pair.
    {
      id: "b",
      category: "islamic",
      subCategory: "ramadan",
      categories: [
        { category: "islamic", subCategory: "ramadan" },
        { category: "islamic", subCategory: "eid" },
      ],
    },
    // A legacy row: scalars only.
    { id: "c", category: "quotes", subCategory: "motivational", categories: null },
  ]);
  assert.equal(counts.byCategory.get("islamic"), 2);
  assert.equal(counts.byCategory.get("quotes"), 1);
  assert.equal(counts.byPair.get("islamic::ramadan"), 2);
  assert.equal(counts.byPair.get("islamic::eid"), 1);
  assert.equal(counts.byPair.get("quotes::motivational"), 1);
});

test("templateCount is added to every category and sub category; nothing else changes", () => {
  const categories = [
    {
      id: "c1",
      value: "islamic",
      label: "Islamic",
      subCategories: [
        { id: "s1", value: "ramadan", label: "Ramadan" },
        { id: "s2", value: "hajj", label: "Hajj" },
      ],
    },
    { id: "c2", value: "general", label: "General", subCategories: [{ id: "s3", value: "general", label: "General" }] },
  ];
  const result = withTemplateCounts(categories, tallyTemplatePlacements([{ id: "a", category: "islamic", subCategory: "ramadan" }]));
  assert.equal(result[0].templateCount, 1);
  assert.deepEqual(result[0].subCategories.map((sub) => sub.templateCount), [1, 0]);
  assert.equal(result[1].templateCount, 0, "an empty category says so");
  const strip = (list) =>
    list.map(({ templateCount: _count, subCategories, ...rest }) => ({
      ...rest,
      subCategories: subCategories.map(({ templateCount: _sub, ...sub }) => sub),
    }));
  assert.deepEqual(strip(result), categories);
});

test("counts equal the list endpoint's own filter, per category and per pair", { skip: skipDb }, async () => {
  const prisma = (await import("@/lib/prisma")).default;
  const { getTemplateCountsByPlacement } = await import("@/lib/mobile/taxonomyCounts.server");
  const { buildPublishedTemplateScopeWhere, prepareMobileTaxonomy } = await import("@/lib/mobile/taxonomy");
  const { mergeTemplateWhere, templateCategoryWhere } = await import("@/lib/templates/categoryQuery");

  const owner = "00000000-0000-4000-8000-0000000000bb";
  const settings = [
    {
      value: "islamic",
      labelEn: "Islamic",
      labelAr: "إسلامي",
      subCategories: [
        { value: "ramadan", labelEn: "Ramadan", labelAr: "رمضان" },
        { value: "eid", labelEn: "Eid", labelAr: "عيد" },
        { value: "hidden", labelEn: "Hidden", labelAr: "مخفي", published: false },
      ],
    },
    { value: "quotes", labelEn: "Quotes", labelAr: "اقتباسات", subCategories: [{ value: "daily", labelEn: "Daily", labelAr: "يومي" }] },
  ];
  const taxonomy = prepareMobileTaxonomy(settings);
  const rows = [
    { status: "published", category: "islamic", subCategory: "ramadan", categories: [{ category: "islamic", subCategory: "ramadan" }, { category: "quotes", subCategory: "daily" }] },
    { status: "published", category: "islamic", subCategory: "eid", categories: [{ category: "islamic", subCategory: "eid" }] },
    { status: "published", category: "islamic", subCategory: "hidden", categories: [{ category: "islamic", subCategory: "hidden" }] },
    { status: "draft", category: "quotes", subCategory: "daily", categories: [{ category: "quotes", subCategory: "daily" }] },
    { status: "published", category: "quotes", subCategory: "daily", categories: null },
  ];
  await prisma.template.deleteMany({ where: { ownerId: owner } });
  try {
    for (const [index, row] of rows.entries()) {
      const id = randomUUID();
      await prisma.template.create({
        data: { id, ownerId: owner, name: `count-${index}`, slug: `count-test-${id}`, canvasSize: {}, tags: [], data: {}, ...row },
      });
    }
    for (const statuses of [["published"], ["published", "draft"]]) {
      const counts = await getTemplateCountsByPlacement(taxonomy, statuses);
      const scope = buildPublishedTemplateScopeWhere(taxonomy);
      const listCount = (filter) =>
        prisma.template.count({
          where: mergeTemplateWhere({ ownerId: owner }, { status: { in: statuses } }, scope, templateCategoryWhere(filter)),
        });
      for (const category of taxonomy.categories) {
        assert.equal(counts.byCategory.get(category.value) || 0, await listCount({ category: category.value }), `${statuses}: ${category.value}`);
        for (const sub of category.subCategories) {
          assert.equal(
            counts.byPair.get(`${category.value}::${sub.value}`) || 0,
            await listCount({ category: category.value, subCategory: sub.value }),
            `${statuses}: ${category.value}/${sub.value}`
          );
        }
      }
    }
  } finally {
    await prisma.template.deleteMany({ where: { ownerId: owner } });
    await prisma.$disconnect();
  }
});
