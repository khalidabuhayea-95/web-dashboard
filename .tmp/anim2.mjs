import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT id, data FROM "Template" WHERE id::text LIKE 'e7ce7bdc%' OR id::text LIKE 'f85ab2fc%'`;
const by = {}; for (const r of rows) by[r.id.slice(0,8)] = (r.data||{}).objects||[];
const P = by["e7ce7bdc"], C = by["f85ab2fc"];
const idsOf = (objs) => new Set(objs.map(o=>String(o.importNodeId||"")));
const Pi = idsOf(P), Ci = idsOf(C);
console.log("prev:", P.length, "curr:", C.length);
const missing = [...Pi].filter(id=>!Ci.has(id));
console.log("missing importNodeIds:", missing);
for (const m of missing) {
  const o = P.find(x=>x.importNodeId===m);
  console.log(` -> type=${o.type} mp=${Array.isArray(o.mediaMotionPath)?o.mediaMotionPath.length+"pts":"-"} win=${o.timelineStartMs}→${o.timelineEndMs} left=${Math.round(o.left)} top=${Math.round(o.top)} w=${Math.round(o.width*(o.scaleX||1))} h=${Math.round(o.height*(o.scaleY||1))} fromModel=${o.fromModel||o.importKind||''} src=${String(o.src||'').slice(0,40)}`);
}
await prisma.$disconnect();
