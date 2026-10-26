// One-off repair for template 9869d36d (Canva DAHNlB6Y2KI): group children imported with their
// group-LOCAL timing. Windows below are the Canva model's group starts, read in-page.
import prisma from "@/lib/prisma";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

const TEMPLATE_ID = "9869d36d-e7eb-471c-bd5f-3f917d3ce32c";
const WINDOWS: Record<string, [number, number]> = {
  LBgwrfVZYJ4VvmSs: [10458, 20916],
  LBx2y27Rh5lmXSLX: [20917, 31375],
};

async function main() {
const rows = (await prisma.$queryRawUnsafe(
  `SELECT data::text AS data FROM "Template" WHERE id = $1::uuid`,
  TEMPLATE_ID
)) as Array<{ data: string }>;
const data = JSON.parse(rows[0].data);
let changed = 0;
for (const object of data.objects as Array<Record<string, unknown>>) {
  const window = WINDOWS[String(object.importParentId || "")];
  if (!window) continue;
  if (object.timelineStartMs === window[0] && object.timelineEndMs === window[1]) continue;
  console.log(`${object.importNodeId} ${object.layerName}: ${object.timelineStartMs}-${object.timelineEndMs} → ${window[0]}-${window[1]}`);
  object.timelineStartMs = window[0];
  object.timelineEndMs = window[1];
  changed++;
}
if (changed > 0 && process.argv.includes("--write")) {
  await prisma.$transaction([
    preserveTemplateUpdatedAt(),
    prisma.$executeRawUnsafe(`UPDATE "Template" SET data = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(data), TEMPLATE_ID),
  ]);
  console.log(`wrote ${changed} object(s)`);
} else {
  console.log(`${changed} object(s) would change (dry run)`);
}
await prisma.$disconnect();
}
main().catch((error) => { console.error(error); process.exit(1); });
