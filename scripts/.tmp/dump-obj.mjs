import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT data FROM "Template" WHERE id = $1::uuid`, process.argv[2]);
const d = rows[0].data;
const objs = d.objects || d.pages?.[0]?.objects || [];
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => typeof x === "string" && x.length > 120 ? x.slice(0, 60) + "…" : x));
for (const i of process.argv.slice(3)) {
  if (i === "warnings") { console.log(JSON.stringify(d.meta.import.warnings, null, 1)); continue; }
  if (i === "stats") { console.log(JSON.stringify(strip(d.meta.import.layerStats), null, 1), JSON.stringify(strip(d.meta.import.provenance), null, 1).slice(0, 3000)); continue; }
  if (i === "tree") { console.log(JSON.stringify(strip(d.meta.import.layerTree), null, 1).slice(0, 6000)); continue; }
  console.log("=== object", i); console.log(JSON.stringify(strip(objs[Number(i)]), null, 1));
}
await c.$disconnect();
