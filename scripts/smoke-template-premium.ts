// End-to-end check that toggling a template's Pro flag leaves it looking unedited to the app.
//
// Creates a throwaway published template with a ready preview recorded at the same instant as
// its (backdated) save, toggles Pro on and off through the writer the dashboard route uses
// (setTemplatePremium), and asserts that `updatedAt` / `version` never move and the home-feed
// rails keep serving the ready preview. A final control shows what the old plain Prisma
// `update` did: the bump makes the app drop the preview. Cleans up in `finally`.
//
//   npm run smoke:template-premium
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { GET as bySubCategoryGet } from "@/app/api/mobile/templates/by-subcategory/route";
import { prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import prisma from "@/lib/prisma";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";
import { setTemplatePremium } from "@/lib/templates/premium.server";
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

type RailTemplate = { id: string; isPremium?: boolean; preview?: { status?: string } };

/** The template's entry in the home-feed rails. `query` narrows the rails to it, however full they are. */
async function railEntry(categoryId: string, subCategoryValue: string, id: string, name: string): Promise<RailTemplate | undefined> {
  const response = await bySubCategoryGet(
    request(`/api/mobile/templates/by-subcategory?categoryId=${categoryId}&query=${encodeURIComponent(name)}`)
  );
  const payload = await response.json();
  const rail = (payload.subCategories as any[]).find((item: any) => item.subCategory.value === subCategoryValue);
  return ((rail?.templates ?? []) as RailTemplate[]).find((template) => template.id === id);
}

async function stamps(id: string): Promise<{ updatedAt: string; version: number }> {
  const row = await prisma.template.findUnique({ where: { id }, select: { updatedAt: true, version: true } });
  return { updatedAt: row.updatedAt.toISOString(), version: row.version };
}

async function main(): Promise<void> {
  const settings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(settings);
  const category = taxonomy.categories[taxonomy.categories.length - 1];
  const subCategory = category?.subCategories?.[0];
  if (!category || !subCategory) throw new Error("Need at least one published category with a sub category.");
  const pair = { category: String(category.value), subCategory: String(subCategory.value) };
  console.log(`Rail ${pair.category}::${pair.subCategory}\n`);

  const id = randomUUID();
  const name = `smoke-premium-${id.slice(0, 8)}`;
  const backdated = new Date("2020-01-01T00:00:00Z");
  const select = { id: true, isPremium: true };
  const entry = () => railEntry(String(category.id), pair.subCategory, id, name);

  try {
    await prisma.template.create({
      data: {
        id,
        ownerId: randomUUID(),
        name,
        slug: name,
        status: "published",
        canvasSize: { width: 1080, height: 1080 },
        tags: [name],
        data: {},
        ...normalizeCategoryFields({ categories: [pair] }, settings),
        previewStatus: "ready",
        previewVideoUrl: "https://example.com/smoke-premium.mp4",
        previewPosterUrl: "https://example.com/smoke-premium.jpg",
        previewVersion: 1,
        previewUpdatedAt: backdated,
      },
    });
    // The preview was recorded at the same instant as the save. The table trigger stamps
    // now() on every update unless the transaction opts out, so the backdate needs it too.
    await prisma.$transaction([
      preserveTemplateUpdatedAt(),
      prisma.template.update({ where: { id }, data: { updatedAt: backdated } }),
    ]);
    const before = await stamps(id);
    check("the backdate sticks", before.updatedAt, backdated.toISOString());
    const baseline = await entry();
    check("baseline: listed free, with a ready preview", [baseline?.isPremium, baseline?.preview?.status], [false, "ready"]);

    console.log("\nPro on");
    check("the writer returns the flagged row", await setTemplatePremium(id, true, select), { id, isPremium: true });
    check("updatedAt and version are unchanged", await stamps(id), before);
    const on = await entry();
    check("rails: Pro, and the preview is still ready", [on?.isPremium, on?.preview?.status], [true, "ready"]);

    console.log("\nPro off");
    check("the writer returns the cleared row", await setTemplatePremium(id, false, select), { id, isPremium: false });
    check("updatedAt and version are unchanged", await stamps(id), before);
    const off = await entry();
    check("rails: free again, and the preview is still ready", [off?.isPremium, off?.preview?.status], [false, "ready"]);

    console.log("\nControl: the old write");
    await prisma.template.update({ where: { id }, data: { isPremium: true } });
    check("a plain Prisma update moves updatedAt", (await stamps(id)).updatedAt !== before.updatedAt, true);
    check("and the app loses the preview — what the fix prevents", (await entry())?.preview?.status ?? null, null);
  } finally {
    await prisma.template.deleteMany({ where: { id } });
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
