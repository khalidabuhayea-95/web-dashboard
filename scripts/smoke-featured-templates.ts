// End-to-end check of featured templates against the configured database.
//
// Creates throwaway templates in one published rail — three published ones backdated so
// recency alone would never put them first, plus a draft — features them through the real
// writer, and calls the real mobile routes in-process: featured templates lead the rail, the
// grouped list and search (newest-featured first), outrank a throwaway live occasion's
// boosted template, keep their updatedAt / version / ready preview, and a featured draft
// never surfaces. Assertions are about relative order, so featured content that already
// exists in the rail cannot break them. Cleans up in `finally`.
//
//   npm run smoke:featured
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { GET as templateDetailGet } from "@/app/api/mobile/templates/[slug]/route";
import { GET as bySubCategoryGet } from "@/app/api/mobile/templates/by-subcategory/route";
import { prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import { buildMobileTemplatesListResponse } from "@/lib/mobile/templateList";
import { invalidateOccasionBoostCache } from "@/lib/occasions/boost.server";
import { OCCASIONS_TIME_ZONE, todayInTimeZone } from "@/lib/occasions/dates";
import { linkOccasionItem } from "@/lib/occasions/items.server";
import prisma from "@/lib/prisma";
import { preserveTemplateUpdatedAt, setTemplatesFeatured } from "@/lib/templates/featured.server";
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

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

async function json(response: Response): Promise<any> {
  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Row = { id: string; isFeatured?: boolean; preview?: { status?: string } };

async function railRows(categoryId: string, subCategoryValue: string): Promise<Row[]> {
  const payload = await json(
    await bySubCategoryGet(request(`/api/mobile/templates/by-subcategory?categoryId=${categoryId}&templatesPerSubCategory=5`))
  );
  const rail = (payload.subCategories as any[]).find((item: any) => item.subCategory.value === subCategoryValue);
  return rail?.templates ?? [];
}

async function listPage(path: string): Promise<{ rows: Row[]; total: number }> {
  const payload = await json(await buildMobileTemplatesListResponse(request(path)));
  return {
    rows: (payload.templatesBySubCategory as any[]).flatMap((group: any) => group.templates),
    total: payload.total,
  };
}

async function searchRows(query: string): Promise<Row[]> {
  const payload = await json(
    await buildMobileTemplatesListResponse(request(`/api/mobile/templates/search?query=${query}`), { searchMode: "queryOnly" })
  );
  return (payload.templatesBySubCategory as any[]).flatMap((group: any) => group.templates);
}

async function stamps(id: string): Promise<{ updatedAt: string; version: number; featuredAt: string | null }> {
  const row = await prisma.template.findUnique({ where: { id }, select: { updatedAt: true, version: true, featuredAt: true } });
  return {
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    featuredAt: row.featuredAt ? row.featuredAt.toISOString() : null,
  };
}

/** True when `ids` appear in `rows` in this relative order (each one present). */
function inOrder(rows: Row[], ids: string[]): boolean {
  const positions = ids.map((id) => rows.findIndex((row) => row.id === id));
  return positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
}

/** Every row ahead of `id` is featured — i.e. `id` is the first non-featured row. */
function onlyFeaturedAhead(rows: Row[], id: string): boolean {
  const position = rows.findIndex((row) => row.id === id);
  return position >= 0 && rows.slice(0, position).every((row) => row.isFeatured === true);
}

async function main(): Promise<void> {
  const settings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(settings);
  const category = taxonomy.categories[taxonomy.categories.length - 1];
  const subCategory = category?.subCategories?.[0];
  if (!category || !subCategory) throw new Error("Need at least one published category with a sub category.");
  const pair = { category: String(category.value), subCategory: String(subCategory.value) };
  console.log(`Rail ${pair.category}::${pair.subCategory}\n`);

  const ownerId = randomUUID();
  const aId = randomUUID();
  const bId = randomUUID();
  const cId = randomUUID();
  const draftId = randomUUID();
  const smokeIds = [aId, bId, cId, draftId];
  const tag = `smoke-featured-${aId.slice(0, 8)}`;
  const backdated = new Date("2020-01-01T00:00:00Z");
  const baseRow = {
    ownerId,
    canvasSize: { width: 1080, height: 1080 },
    tags: [tag],
    data: {},
    ...normalizeCategoryFields({ categories: [pair] }, settings),
  };
  const categoryList = `/api/mobile/templates?categoryId=${category.id}&pageSize=5`;
  const railList = `/api/mobile/templates?categoryId=${category.id}&subCategoryId=${subCategory.id}`;

  let occasionId: string | null = null;

  try {
    await prisma.template.createMany({
      data: [
        {
          ...baseRow,
          id: aId,
          status: "published",
          name: `${tag}-a`,
          slug: `${tag}-a`,
          // A ready preview recorded at the same instant as the (backdated) save: bumping
          // updatedAt would make the mobile serializer treat it as stale and drop it.
          previewStatus: "ready",
          previewVideoUrl: "https://example.com/smoke-featured.mp4",
          previewPosterUrl: "https://example.com/smoke-featured.jpg",
          previewVersion: 1,
          previewUpdatedAt: backdated,
        },
        { ...baseRow, id: bId, status: "published", name: `${tag}-b`, slug: `${tag}-b` },
        { ...baseRow, id: cId, status: "published", name: `${tag}-c`, slug: `${tag}-c` },
        { ...baseRow, id: draftId, status: "draft", name: `${tag}-draft`, slug: `${tag}-draft` },
      ],
    });
    // Old enough that recency order alone would never put them first, and A the oldest of
    // the three so even a rail holding nothing but these rows has A last. The table trigger
    // stamps now() on every update unless the transaction opts out.
    const dayAfter = (days: number) => new Date(backdated.getTime() + days * 86_400_000);
    await prisma.$transaction([
      preserveTemplateUpdatedAt(),
      prisma.template.updateMany({ where: { id: { in: [aId, draftId] } }, data: { updatedAt: backdated } }),
      prisma.template.update({ where: { id: bId }, data: { updatedAt: dayAfter(1) } }),
      prisma.template.update({ where: { id: cId }, data: { updatedAt: dayAfter(2) } }),
    ]);
    check("the backdate sticks", (await stamps(aId)).updatedAt, backdated.toISOString());
    invalidateOccasionBoostCache();

    console.log("Baseline");
    const baselineRail = await railRows(String(category.id), pair.subCategory);
    const baselineList = await listPage(categoryList);
    if (baselineRail.length >= 2) {
      check("the old smoke template is NOT first in its rail", baselineRail[0]?.id !== aId, true);
    } else {
      console.log("skip  baseline ordering check (rail has fewer than 2 templates)");
    }
    const before = await stamps(aId);

    console.log("\nFeature A, then B (and the draft)");
    const featuredA = await setTemplatesFeatured([aId], true);
    check("the writer returns the featured row", [featuredA.length, featuredA[0]?.id, featuredA[0]?.isFeatured], [1, aId, true]);
    await sleep(20);
    await setTemplatesFeatured([bId, draftId], true);
    const after = await stamps(aId);
    check("featuring leaves updatedAt and version alone", [after.updatedAt, after.version], [before.updatedAt, before.version]);
    check("featuring stamps featuredAt", after.featuredAt !== null, true);
    const bFeaturedAt = (await stamps(bId)).featuredAt;

    console.log("\nHome feed (by-subcategory)");
    const rail = await railRows(String(category.id), pair.subCategory);
    check("B then A lead the rail (newest-featured first)", [rail[0]?.id, rail[1]?.id], [bId, aId]);
    check("both carry isFeatured", [rail[0]?.isFeatured, rail[1]?.isFeatured], [true, true]);
    check("A's ready preview survives featuring", rail[1]?.preview?.status, "ready");
    check("the featured draft never surfaces", rail.some((row) => row.id === draftId), false);
    check("the rail keeps its size", rail.length, baselineRail.length);

    console.log("\nGrouped list, detail and search");
    const list = await listPage(categoryList);
    check("B then A lead the grouped list", inOrder(list.rows, [bId, aId]) && list.rows[0]?.id === bId, true);
    check("total is unchanged by featuring", list.total, baselineList.total);
    const pageTwo = await listPage(`${categoryList}&page=2`);
    check("page 2 does not repeat them", pageTwo.rows.some((row) => row.id === aId || row.id === bId), false);
    const detail = await json(
      await templateDetailGet(request(`/api/mobile/templates/${aId}`), { params: Promise.resolve({ slug: aId }) })
    );
    check("the detail payload carries isFeatured", detail?.template?.isFeatured, true);
    const search = await searchRows(tag);
    check("search: B, A, then the unfeatured C; no draft", search.map((row) => row.id), [bId, aId, cId]);

    console.log("\nFeatured beat a live occasion");
    const todayIso = todayInTimeZone(OCCASIONS_TIME_ZONE);
    const occasion = await prisma.occasion.create({
      data: {
        slug: tag,
        titleEn: `Smoke featured ${tag}`,
        titleAr: "مناسبة تجريبية",
        kind: "seasonal",
        calendar: "gregorian",
        month: Number(todayIso.slice(5, 7)),
        day: Number(todayIso.slice(8, 10)),
        durationDays: 3,
        reminderLeadDays: 45,
        boostLeadDays: 30,
        sortOrder: 9999,
      },
    });
    occasionId = String(occasion.id);
    await linkOccasionItem(String(occasion.id), "template", cId);
    invalidateOccasionBoostCache();

    const boostedRail = await railRows(String(category.id), pair.subCategory);
    check("rail: B, A before the boosted C", inOrder(boostedRail, [bId, aId, cId]), true);
    check("rail: only featured templates ahead of C", onlyFeaturedAhead(boostedRail, cId), true);
    const full = await listPage(`${railList}&pageSize=200`);
    check("list: B, A before the boosted C, only featured ahead of it", inOrder(full.rows, [bId, aId, cId]) && onlyFeaturedAhead(full.rows, cId), true);
    const walk: string[] = [];
    const steps = Math.min(full.total, 8);
    for (let page = 1; page <= steps; page += 1) {
      walk.push(...(await listPage(`${railList}&pageSize=1&page=${page}`)).rows.map((row) => row.id));
    }
    check("paging one row at a time matches one big page", walk, full.rows.slice(0, steps).map((row) => row.id));
    check("total is unchanged by pinning", (await listPage(`${railList}&pageSize=1`)).total, full.total);

    console.log("\nUnfeature A, re-feature B");
    const unfeatured = await setTemplatesFeatured([aId], false);
    check("unfeaturing clears featuredAt", [unfeatured[0]?.isFeatured, unfeatured[0]?.featuredAt ?? null], [false, null]);
    check("unfeaturing leaves updatedAt alone", (await stamps(aId)).updatedAt, before.updatedAt);
    const railAfter = await railRows(String(category.id), pair.subCategory);
    const aPosition = railAfter.findIndex((row) => row.id === aId);
    const cPosition = railAfter.findIndex((row) => row.id === cId);
    check("A drops back behind the boosted C", aPosition === -1 || aPosition > cPosition, true);
    await sleep(20);
    await setTemplatesFeatured([bId], true);
    check("re-featuring keeps the original featuredAt", (await stamps(bId)).featuredAt, bFeaturedAt);
  } finally {
    if (occasionId) await prisma.occasion.deleteMany({ where: { id: occasionId } });
    await prisma.template.deleteMany({ where: { id: { in: smokeIds } } });
    invalidateOccasionBoostCache();
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
