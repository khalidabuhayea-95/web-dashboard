// End-to-end check of multi-category templates against the configured database.
//
// Creates two throwaway templates — one filed under several { category, subCategory }
// placements, one legacy row with only the scalar pair — then exercises the filter, the
// published-taxonomy scope and the localizer that the catalog and mobile routes use.
// Run with `npm run smoke:template-categories` after touching the taxonomy or the
// category query helpers.
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { buildMobileTemplatesListResponse } from "@/lib/mobile/templateList";
import { mergeTemplateWhere, templateCategoryWhere } from "@/lib/templates/categoryQuery";
import {
  buildPublishedTemplateScopeWhere,
  isTemplateAllowedByTaxonomy,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
} from "@/lib/mobile/taxonomy";
import { normalizeCategoryFields } from "@/lib/templates/server";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`
  );
}

async function main(): Promise<void> {
  const settings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(settings);
  // The ids ride along because the mobile routes filter by GUID, not by slug.
  const pairs = taxonomy.categories.flatMap((category: any) =>
    category.subCategories.map((subCategory: any) => ({
      category: String(category.value),
      subCategory: String(subCategory.value),
      categoryId: String(category.id),
      subCategoryId: String(subCategory.id),
    }))
  );
  if (pairs.length < 3) {
    throw new Error(`Need at least 3 published placements to test with, found ${pairs.length}.`);
  }

  // Two placements in different categories, plus a third the template is NOT filed under.
  const primary = pairs[0];
  const secondary =
    pairs.find((pair: any) => pair.category !== primary.category) || pairs[1];
  const unrelated =
    pairs.find(
      (pair: any) => pair.category !== primary.category && pair.category !== secondary.category
    ) || pairs[2];

  console.log(
    `Placements: primary=${primary.category}/${primary.subCategory}` +
      ` secondary=${secondary.category}/${secondary.subCategory}` +
      ` unrelated=${unrelated.category}/${unrelated.subCategory}\n`
  );

  const ownerId = randomUUID();
  const multiId = randomUUID();
  const legacyId = randomUUID();
  const suffix = multiId.slice(0, 8);

  const categoryFields = normalizeCategoryFields(
    { categories: [primary, secondary] },
    settings
  );
  check("write mirrors categories[0] into the scalar primary", categoryFields.category, primary.category);
  check("write keeps both placements", categoryFields.categories.length, 2);

  const baseRow = {
    ownerId,
    status: "published",
    canvasSize: { width: 1080, height: 1080 },
    tags: [],
    data: {},
  };

  try {
    await prisma.template.create({
      data: {
        ...baseRow,
        id: multiId,
        name: `smoke-multi-category-${suffix}`,
        slug: `smoke-multi-category-${suffix}`,
        ...categoryFields,
      },
    });
    // A row as it looks before the multi-category migration: scalars only.
    await prisma.template.create({
      data: {
        ...baseRow,
        id: legacyId,
        name: `smoke-legacy-category-${suffix}`,
        slug: `smoke-legacy-category-${suffix}`,
        category: secondary.category,
        subCategory: secondary.subCategory,
        categories: undefined,
      },
    });

    const idsIn = { id: { in: [multiId, legacyId] } };
    const found = async (pair: { category: string; subCategory: string }) => {
      const rows = await prisma.template.findMany({
        where: mergeTemplateWhere(idsIn, templateCategoryWhere(pair)),
        select: { id: true },
      });
      return rows.map((row: any) => row.id).sort();
    };

    check("filter by primary placement finds the template", await found(primary), [multiId]);
    check(
      "filter by secondary placement finds it too (the point of multi-category)",
      await found(secondary),
      [multiId, legacyId].sort()
    );
    check("filter by an unrelated placement finds neither", await found(unrelated), []);

    const byCategoryOnly = await prisma.template.findMany({
      where: mergeTemplateWhere(idsIn, templateCategoryWhere({ category: secondary.category })),
      select: { id: true },
    });
    check(
      "filter by category alone matches any of its sub categories",
      byCategoryOnly.map((row: any) => row.id).sort(),
      [multiId, legacyId].sort()
    );

    const scoped = await prisma.template.findMany({
      where: mergeTemplateWhere(idsIn, buildPublishedTemplateScopeWhere(taxonomy)),
      select: { id: true },
    });
    check(
      "published-taxonomy scope keeps both rows",
      scoped.map((row: any) => row.id).sort(),
      [multiId, legacyId].sort()
    );

    const stored = await prisma.template.findUnique({
      where: { id: multiId },
      select: { category: true, subCategory: true, categories: true },
    });
    const localized = localizeTemplateTaxonomy(stored, taxonomy, "en");
    check("localizer reports both placements", localized.placements.length, 2);
    check(
      "localizer flat fields describe the primary placement",
      [localized.categoryValue, localized.subCategoryValue],
      [primary.category, primary.subCategory]
    );
    check(
      "localizer second placement is the secondary one",
      [localized.placements[1]?.categoryValue, localized.placements[1]?.subCategoryValue],
      [secondary.category, secondary.subCategory]
    );
    check("multi-category row passes the taxonomy gate", isTemplateAllowedByTaxonomy(stored, taxonomy), true);

    const legacyStored = await prisma.template.findUnique({
      where: { id: legacyId },
      select: { category: true, subCategory: true, categories: true },
    });
    check("legacy row has no stored placements", legacyStored?.categories ?? null, null);
    check(
      "legacy row still localizes to its scalar pair",
      localizeTemplateTaxonomy(legacyStored, taxonomy, "en").placements.length,
      1
    );

    // Route level: the catalog rails are what the app actually renders.
    const listRails = async (query: string) => {
      const response = await buildMobileTemplatesListResponse(
        new NextRequest(`http://localhost/api/mobile/templates?pageSize=200&${query}`)
      );
      const payload: any = await response.json();
      return {
        status: response.status,
        rails: (payload.templatesBySubCategory || [])
          .filter((group: any) => group.templates.some((item: any) => item.id === multiId))
          .map((group: any) => `${group.categoryValue}/${group.subCategoryValue}`)
          .sort(),
      };
    };

    const unfiltered = await listRails("");
    check("mobile list responds", unfiltered.status, 200);
    check(
      "the template is listed under BOTH of its rails",
      unfiltered.rails,
      [
        `${primary.category}/${primary.subCategory}`,
        `${secondary.category}/${secondary.subCategory}`,
      ].sort()
    );

    const filtered = await listRails(`subCategoryId=${encodeURIComponent(secondary.subCategoryId)}`);
    check(
      "filtering to the secondary sub category returns only that rail",
      filtered.rails,
      [`${secondary.category}/${secondary.subCategory}`]
    );

    const searched = await listRails(
      `categoryId=${encodeURIComponent(secondary.categoryId)}&name=smoke-multi-category`
    );
    check(
      "category filter combines with a name search instead of clobbering it",
      searched.rails,
      [`${secondary.category}/${secondary.subCategory}`]
    );
  } finally {
    await prisma.template.deleteMany({ where: { id: { in: [multiId, legacyId] } } });
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
