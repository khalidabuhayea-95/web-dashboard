/**
 * Read-only smoke test of the smart search against the configured database: runs representative
 * Arabic / English / dialect / typo / mixed queries through the real template and element search
 * (translation included) and prints counts, the top hits and timings. Fails when a query that
 * must find something finds nothing.
 *
 *   npm run smoke:search
 */
import prisma from "@/lib/prisma";
import { listImportedElementAssets } from "@/lib/editor/importedElements.server";
import { findTemplateSearchMatches } from "@/lib/mobile/templateSearch.server";
import { prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

const TEMPLATE_QUERIES = [
  "دعوة زفاف",
  "wedding invitation",
  "عيد ميلاد",
  "birthday",
  "انستا ستوري",
  "رمضان كريم",
  "ramadan",
  "منيو مطعم",
  "تخفيضات",
  "graduation",
  "weding",
  "بطاقة شكر",
];
const ELEMENT_QUERIES = ["كيكة", "cake", "بالون", "balloons", "فانوس", "ورد", "بالوردي", "قلب", "heart", "نجوم", "baloons", "هدية"];

async function main() {
  // The same taxonomy object the list routes pass (prepareMobileTaxonomy of the settings).
  const taxonomy = prepareMobileTaxonomy(await getTemplateTaxonomySettings()) as any;
  let failures = 0;

  console.log("── Templates (published)");
  for (const query of TEMPLATE_QUERIES) {
    const started = Date.now();
    const result = await findTemplateSearchMatches({ query, statuses: ["published"], taxonomy });
    const ms = Date.now() - started;
    const top = [...result.matches.keys()].slice(0, 3);
    const names = top.length
      ? ((await prisma.template.findMany({ where: { id: { in: top } }, select: { id: true, name: true } })) as Array<{ id: string; name: string }>)
      : [];
    const byId = new Map(names.map((row) => [row.id, row.name]));
    console.log(`${query.padEnd(20)} ${String(result.matches.size).padStart(5)} hits  ${String(ms).padStart(5)} ms  ${top.map((id) => byId.get(id)?.slice(0, 40)).join(" | ")}`);
    if (result.matches.size === 0) failures += 1;
  }

  console.log("── Elements");
  for (const query of ELEMENT_QUERIES) {
    const started = Date.now();
    const result = await listImportedElementAssets({ source: "all", query, page: 1, pageSize: 3 });
    const ms = Date.now() - started;
    console.log(
      `${query.padEnd(20)} ${String(result.total).padStart(5)} hits  ${String(ms).padStart(5)} ms  ${result.items
        .map((item: any) => `${item.titleEn} / ${item.titleAr}`.slice(0, 40))
        .join(" | ")}`
    );
    if (result.total === 0) failures += 1;
  }

  if (failures) {
    console.error(`${failures} query(ies) found nothing`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
