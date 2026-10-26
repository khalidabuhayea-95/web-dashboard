// One-off repair for Canva DAHNlB6Y2KI imports: the two door groups carry a custom motion path
// that never reached the door layers inside them. Paths decoded in-page from Canva's model
// (2026-10-19) with the shipped decoder; [t ms, x px, y px].
import prisma from "@/lib/prisma";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

const TEMPLATE_IDS = ["ed956f9a-5d59-4207-93c4-336984d04335", "fd123f6b-412d-4c07-858f-301e573435e2", "9869d36d-e7eb-471c-bd5f-3f917d3ce32c"];
const LEFT = [[0,0,0],[246,-17,0],[492,-34,0],[608,-42,0],[695,-48,0],[796,-55,0],[999,-69,0],[1100,-76,0],[1230,-85,0],[1346,-93,0],[1650,-114,0],[1853,-128,0],[2026,-140,0],[2157,-149,0],[2200,-152,0],[2359,-163,0],[2504,-173,0],[2692,-186,0],[2866,-198,0],[3011,-208,0],[3257,-225,0],[3402,-235,0],[3603,-248,-3],[3719,-256,-3],[3965,-273,-3],[4168,-287,-3],[4269,-294,-3],[4371,-301,-3],[4573,-315,-3],[4718,-325,-3],[4819,-332,-3],[5080,-350,-3],[5167,-356,-3],[5283,-364,-3],[5398,-372,-3],[5529,-381,-3],[5673,-391,-3],[5775,-398,-3],[5934,-409,-3],[6122,-422,-3],[6252,-431,-3],[6455,-445,-3],[6687,-461,-3],[6773,-467,-3],[6923,-476,-8],[7166,-492,-12],[7516,-516,-10],[7617,-523,-10]];
const RIGHT = [[0,0,0],[247,16,0],[479,31,0],[695,45,0],[803,52,0],[957,62,0],[1235,80,0],[1374,89,0],[1606,104,0],[1822,118,0],[2038,132,0],[2192,142,0],[2408,156,0],[2609,169,0],[2779,180,0],[2918,189,0],[3057,198,0],[3211,208,0],[3257,211,0],[3474,225,0],[3628,235,0],[3767,244,0],[3906,253,0],[4045,262,0],[4184,271,0],[4276,277,0],[4462,289,0],[4601,298,0],[4709,305,0],[4863,315,0],[5017,325,0],[5156,334,0],[5434,352,0],[5620,364,0],[5820,377,0],[5975,387,0],[6175,400,0],[6330,410,0],[6484,420,0],[6623,429,0],[6777,439,0],[6932,449,0],[7086,459,0],[7225,468,0],[7379,478,0],[7488,485,0],[7642,495,0],[7750,502,0]];
const PATHS: Record<string, number[][]> = { LB4PXRZxwjZlg805: LEFT, LBVCLDMmlV7Js6n0: RIGHT };

async function main() {
  for (const id of TEMPLATE_IDS) {
    const rows = (await prisma.$queryRawUnsafe(`SELECT data::text AS data FROM "Template" WHERE id = $1::uuid`, id)) as Array<{ data: string }>;
    if (!rows.length) { console.log(id, "missing"); continue; }
    const data = JSON.parse(rows[0].data);
    let changed = 0;
    for (const object of data.objects as Array<Record<string, unknown>>) {
      const path = PATHS[String(object.importParentId || "")];
      if (!path) continue;
      object.mediaMotionPath = path.map(([t, x, y]) => ({ t, x, y }));
      changed++;
      console.log(id.slice(0, 8), object.importNodeId, object.layerName, "→", path[path.length - 1].slice(1).join(","), "px over", path[path.length - 1][0], "ms");
    }
    if (changed && process.argv.includes("--write")) {
      await prisma.$transaction([
        preserveTemplateUpdatedAt(),
        prisma.$executeRawUnsafe(`UPDATE "Template" SET data = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(data), id),
      ]);
      console.log(id.slice(0, 8), `wrote ${changed}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((error) => { console.error(error); process.exit(1); });
