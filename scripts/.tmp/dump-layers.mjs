import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();

const rows = await c.$queryRawUnsafe(`SELECT data FROM "Template" WHERE id = $1::uuid`, process.argv[2]);
const d = rows[0].data;
const objs = d.objects || d.pages?.[0]?.objects || [];
console.log("meta.import keys", Object.keys(d.meta?.import || {}));
console.log("page durationMs", d.meta?.import?.page?.durationMs, "timeline", JSON.stringify(d.timeline));
for (const [i, o] of objs.entries()) {
  const t = o.timing || o.timeline || {};
  const keys = Object.keys(o).filter(k => /start|end|duration|time|window|scene|moment|capture/i.test(k));
  console.log(i, o.type, JSON.stringify((o.name || o.text || "").slice(0,30)), `x=${Math.round(o.x)} y=${Math.round(o.y)} w=${Math.round(o.width*(o.scaleX||1))} h=${Math.round(o.height*(o.scaleY||1))}`, JSON.stringify(Object.fromEntries(keys.map(k=>[k,o[k]]))), JSON.stringify(o.meta?.import?.canva ? Object.keys(o.meta.import.canva) : o.meta ? Object.keys(o.meta): ""), (o.src||o.image||"").slice(-40));
}
await c.$disconnect();
