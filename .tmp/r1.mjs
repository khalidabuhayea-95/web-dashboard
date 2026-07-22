import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT name, data FROM "Template" WHERE id = '7da9ad95-3712-4053-b2c3-225bf2789ca8'::uuid`;
const data = rows[0].data||{};
console.log("name:", rows[0].name);
const objs = data.objects || (((data.pages||[])[0]||{}).elements)||[];
console.log("objects:", objs.length, "| build:", objs[0]?.extBuild);
objs.forEach((o,i)=>{
  const w=Math.round((o.width||0)*(o.scaleX||1)),h=Math.round((o.height||0)*(o.scaleY||1));
  const extra=[];
  if(o.stroke && o.strokeWidth) extra.push(`stroke=${o.stroke}/${o.strokeWidth}`);
  if(o.cornerRadius) extra.push(`radius=${o.cornerRadius}`);
  if(o.rx||o.ry) extra.push(`rx/ry=${o.rx}/${o.ry}`);
  console.log(`[${i}] ${String(o.type).padEnd(7)} ${String(w+"×"+h).padEnd(9)} ${(o.layerName||'').slice(0,22).padEnd(22)} ${extra.join(" ")} [${(o.importNodeId||'').slice(0,14)}]`);
});
await prisma.$disconnect();
