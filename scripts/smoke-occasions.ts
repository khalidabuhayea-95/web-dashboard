// End-to-end check of the occasions calendar and the seasonal boost against the configured
// database.
//
// Creates a throwaway occasion whose boost window covers today, links a throwaway
// published template (and a draft one that must never surface), an element and an AI
// template when the catalogue has any, then calls the real mobile routes in-process and
// asserts that linked content comes first, drafts stay hidden, `total` is unchanged,
// categories hoist only when asked, and that disabling the boost restores today's output
// byte for byte. Cleans up in `finally`.
//
//   npm run smoke:occasions
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { GET as bySubCategoryGet } from "@/app/api/mobile/templates/by-subcategory/route";
import { GET as taxonomyGet } from "@/app/api/mobile/templates/taxonomy/route";
import { GET as elementsGet } from "@/app/api/mobile/elements/route";
import { buildAiToolsCatalog } from "@/lib/mobile/aiTools.server";
import { prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import { buildMobileTemplatesListResponse } from "@/lib/mobile/templateList";
import { buildOccasionBoostSnapshot, getActiveOccasionBoost, invalidateOccasionBoostCache } from "@/lib/occasions/boost.server";
import { OCCASIONS_TIME_ZONE, todayInTimeZone } from "@/lib/occasions/dates";
import { linkOccasionItem, listHydratedOccasionItems } from "@/lib/occasions/items.server";
import { countOccasionReminders, listUpcomingOccasions } from "@/lib/occasions/occasions.server";
import prisma from "@/lib/prisma";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";
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

async function rails(categoryId: string, take: number) {
  const payload = await json(await bySubCategoryGet(request(`/api/mobile/templates/by-subcategory?categoryId=${categoryId}&templatesPerSubCategory=${take}`)));
  return payload.subCategories as Array<{ category: { value: string }; subCategory: { value: string }; templates: Array<{ id: string; isFeatured?: boolean }> }>;
}

async function main(): Promise<void> {
  const todayIso = todayInTimeZone(OCCASIONS_TIME_ZONE);
  const settings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(settings);
  const category = taxonomy.categories[taxonomy.categories.length - 1];
  const subCategory = category?.subCategories?.[0];
  if (!category || !subCategory) throw new Error("Need at least one published category with a sub category.");
  const pair = { category: String(category.value), subCategory: String(subCategory.value) };
  const pairKey = `${pair.category}::${pair.subCategory}`;
  console.log(`Today ${todayIso} (${OCCASIONS_TIME_ZONE}); rail ${pairKey}\n`);

  const ownerId = randomUUID();
  const publishedId = randomUUID();
  const draftId = randomUUID();
  const suffix = publishedId.slice(0, 8);
  const categoryFields = normalizeCategoryFields({ categories: [pair] }, settings);
  const baseRow = { ownerId, canvasSize: { width: 1080, height: 1080 }, tags: ["smoke-occasion"], data: {} };

  let occasionId: string | null = null;

  try {
    await prisma.template.create({
      data: { ...baseRow, id: publishedId, status: "published", name: `smoke-occasion-boost-${suffix}`, slug: `smoke-occasion-boost-${suffix}`, ...categoryFields },
    });
    await prisma.template.create({
      data: { ...baseRow, id: draftId, status: "draft", name: `smoke-occasion-draft-${suffix}`, slug: `smoke-occasion-draft-${suffix}`, ...categoryFields },
    });
    // Old enough that recency order alone would never put it first. The table trigger stamps
    // now() on every update unless the transaction opts out.
    await prisma.$transaction([
      preserveTemplateUpdatedAt(),
      prisma.template.updateMany({ where: { id: { in: [publishedId, draftId] } }, data: { updatedAt: new Date("2020-01-01T00:00:00Z") } }),
    ]);

    invalidateOccasionBoostCache();
    const baselineRails = JSON.stringify(await rails(String(category.id), 5));
    const baselineTaxonomy = JSON.stringify(await json(await taxonomyGet(request("/api/mobile/templates/taxonomy"))));
    const baselineList = await json(await buildMobileTemplatesListResponse(request(`/api/mobile/templates?categoryId=${category.id}&pageSize=5`)));
    const baselineRail = (await rails(String(category.id), 5)).find((rail) => rail.subCategory.value === pair.subCategory);
    const railSize = baselineRail?.templates.length ?? 0;
    if (railSize >= 2) {
      check("baseline: the old smoke template is NOT first in its rail", baselineRail?.templates[0]?.id !== publishedId, true);
    } else {
      console.log("skip  baseline ordering check (rail has fewer than 2 templates)");
    }

    // A live occasion: starts today, runs three days, boosted for a month before.
    const occasion = await prisma.occasion.create({
      data: {
        slug: `smoke-occasion-${suffix}`,
        titleEn: `Smoke occasion ${suffix}`,
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
    // String(): the shared prisma client is typed `any`, and only a real string narrows
    // `occasionId` for the calls below.
    occasionId = String(occasion.id);

    console.log("\nReminders");
    const reminders = await countOccasionReminders(todayIso);
    check("a live occasion with nothing linked needs content", reminders.needsContent >= 1, true);
    check("it counts as live", reminders.live >= 1, true);
    const upcoming = await listUpcomingOccasions({ todayIso });
    const mine = upcoming.find((item: any) => item.id === occasionId);
    check("it is listed as upcoming, phase live, needsContent", [mine?.next?.phase, mine?.needsContent], ["live", true]);

    console.log("\nLinks");
    await linkOccasionItem(occasionId, "template", publishedId);
    await linkOccasionItem(occasionId, "template", draftId);
    await linkOccasionItem(occasionId, "template", publishedId); // idempotent
    const hydrated = await listHydratedOccasionItems(occasionId);
    check("two links hydrate with titles", hydrated.map((item) => item.title).sort(), [`smoke-occasion-boost-${suffix}`, `smoke-occasion-draft-${suffix}`].sort());
    check("linking clears needsContent", (await countOccasionReminders(todayIso)).needsContent, reminders.needsContent - 1);

    console.log("\nSnapshot");
    const snapshot = await buildOccasionBoostSnapshot(todayIso);
    check("snapshot is active", snapshot.isEmpty, false);
    check("snapshot carries both template ids", [publishedId, draftId].every((id) => snapshot.templateIdSet.has(id)), true);
    check("snapshot maps the published template to its rail", (snapshot.templateIdsByPair[pairKey] || []).includes(publishedId), true);

    console.log("\nHome feed (by-subcategory)");
    invalidateOccasionBoostCache();
    const boostedRails = await rails(String(category.id), 5);
    const rail = boostedRails.find((item) => item.subCategory.value === pair.subCategory);
    // Featured templates outrank the boost, so "first" means first after any featured ones.
    const railNonFeatured = rail?.templates.filter((t) => !t.isFeatured) ?? [];
    if (railNonFeatured.length > 0) {
      check("boosted template is first in its rail after any featured ones", railNonFeatured[0]?.id, publishedId);
    } else {
      console.log("skip  boosted-first rail check (featured templates fill the rail)");
    }
    check("draft template never surfaces for the anonymous audience", rail?.templates.some((t) => t.id === draftId), false);
    check("rail keeps its size", rail?.templates.length, Math.min(5, railSize));
    check("template order in other rails is untouched", JSON.stringify(boostedRails.filter((r) => r.subCategory.value !== pair.subCategory)), JSON.stringify(JSON.parse(baselineRails).filter((r: any) => r.subCategory.value !== pair.subCategory)));

    console.log("\nFlat list + search");
    const boostedList = await json(await buildMobileTemplatesListResponse(request(`/api/mobile/templates?categoryId=${category.id}&pageSize=5`)));
    const firstGroup = boostedList.templatesBySubCategory.find((group: any) => group.subCategoryValue === pair.subCategory);
    const groupNonFeatured = (firstGroup?.templates ?? []).filter((t: any) => !t.isFeatured);
    if (groupNonFeatured.length > 0) {
      check("pinned template is first in the grouped list after any featured ones", groupNonFeatured[0]?.id, publishedId);
    } else {
      console.log("skip  pinned-first list check (featured templates fill the page)");
    }
    check("total is unchanged by pinning", boostedList.total, baselineList.total);
    const pageTwo = await json(await buildMobileTemplatesListResponse(request(`/api/mobile/templates?categoryId=${category.id}&pageSize=5&page=2`)));
    const pageTwoIds = pageTwo.templatesBySubCategory.flatMap((group: any) => group.templates.map((t: any) => t.id));
    check("the pinned row is not repeated on page 2", pageTwoIds.includes(publishedId), false);
    const search = await json(await buildMobileTemplatesListResponse(request("/api/mobile/templates/search?query=smoke-occasion"), { searchMode: "queryOnly" }));
    const searchIds = search.templatesBySubCategory.flatMap((group: any) => group.templates.map((t: any) => t.id));
    check("search returns the boosted template and hides the draft", [searchIds.includes(publishedId), searchIds.includes(draftId)], [true, false]);

    console.log("\nCategory hoist");
    await linkOccasionItem(occasionId, "template-category", pair.category);
    invalidateOccasionBoostCache();
    const hoisted = await json(await taxonomyGet(request("/api/mobile/templates/taxonomy")));
    check("linked category is first in /taxonomy", hoisted.categories[0]?.value, pair.category);
    const hoistedRails = await rails(String(""), 5).catch(() => null);
    if (hoistedRails) {
      check("linked category's rails come first in the home feed", hoistedRails[0]?.category.value, pair.category);
    }
    await prisma.occasion.update({ where: { id: occasionId }, data: { hoistCategories: false } });
    invalidateOccasionBoostCache();
    check("hoistCategories=false restores the taxonomy order", JSON.stringify(await json(await taxonomyGet(request("/api/mobile/templates/taxonomy")))), baselineTaxonomy);
    await prisma.occasionItem.deleteMany({ where: { occasionId, kind: "template-category" } });
    await prisma.occasion.update({ where: { id: occasionId }, data: { hoistCategories: true } });

    console.log("\nElements");
    const elementRows = (await prisma.$queryRawUnsafe("SELECT id FROM editor_element_assets ORDER BY updated_at ASC LIMIT 1").catch(() => [])) as Array<{ id: string }>;
    if (elementRows.length) {
      const elementId = String(elementRows[0].id);
      await linkOccasionItem(occasionId, "element", elementId);
      invalidateOccasionBoostCache();
      const elements = await json(await elementsGet(request("/api/mobile/elements?pageSize=5")));
      check("oldest element is first once linked", elements.elements[0]?.id, elementId);
      const elementsBaseline = await json(await elementsGet(request("/api/mobile/elements?pageSize=5&category=__none__")));
      check("a category filter still returns a well-formed page", Array.isArray(elementsBaseline.elements), true);
    } else {
      console.log("skip  no elements in this database");
    }

    console.log("\nAI tools");
    const aiRow = await prisma.aiTemplate.findFirst({
      where: { published: true, afterUrl: { not: null } },
      orderBy: { sortOrder: "desc" },
      select: { id: true, slug: true, category: { select: { slug: true } } },
    });
    if (aiRow) {
      await linkOccasionItem(occasionId, "ai-template", aiRow.id);
      invalidateOccasionBoostCache();
      const catalog = await buildAiToolsCatalog();
      const firstTemplateSection = catalog.sections.find((section) => section.kind === "template");
      check("its category is the first template section", firstTemplateSection?.id, `template:${aiRow.category.slug}`);
      check("the linked AI template is first inside it", firstTemplateSection?.tools[0]?.slug, aiRow.slug);
      check("payload still carries no prompt", /"prompt"/i.test(JSON.stringify(catalog)), false);
    } else {
      console.log("skip  no published AI templates with art in this database");
    }

    console.log("\nOff switch");
    await prisma.occasion.update({ where: { id: occasionId }, data: { boostEnabled: false } });
    invalidateOccasionBoostCache();
    const activeAfterOff = await getActiveOccasionBoost();
    check("the smoke occasion no longer contributes", activeAfterOff.templateIdSet.has(publishedId), false);
    // Other real occasions may be live today; only compare byte-for-byte when nothing else boosts.
    if (activeAfterOff.isEmpty) {
      check("home feed is byte-identical to the baseline with the boost off", JSON.stringify(await rails(String(category.id), 5)), baselineRails);
      check("/taxonomy is byte-identical to the baseline with the boost off", JSON.stringify(await json(await taxonomyGet(request("/api/mobile/templates/taxonomy")))), baselineTaxonomy);
    } else {
      console.log(`skip  byte-identical checks (${activeAfterOff.occasions.map((o) => o.slug).join(", ")} still active with linked content)`);
    }
  } finally {
    if (occasionId) await prisma.occasion.deleteMany({ where: { id: occasionId } });
    await prisma.template.deleteMany({ where: { id: { in: [publishedId, draftId] } } });
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
