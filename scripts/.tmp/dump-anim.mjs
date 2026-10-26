import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT data FROM "Template" WHERE id = $1::uuid`, process.argv[2]);
const objs = rows[0].data.objects;
for (const i of process.argv.slice(3).map(Number)) {
  const o = objs[i];
  const keep = Object.fromEntries(Object.entries(o).filter(([k]) => /anim|motion|timeline|canva|entrance|exit|effect|clip|mask|crop|fallback/i.test(k)));
  console.log("=== ", i, o.layerName, JSON.stringify(keep, (k, v) => typeof v === "string" && v.length > 200 ? v.slice(0, 80) + "…" : v, 1));
}
await c.$disconnect();
