import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT data FROM "Template" WHERE id = '2ab2cd50-5cc1-4273-8656-e10195fd6012'`;
const data = rows[0].data;
const objs = data.objects || (((data.pages||[])[0]||{}).elements) || [];
console.log("format:", data.objects ? "objects" : "pages.elements", "count:", objs.length);
for (const [i,o] of objs.entries()) {
  const t = o.type;
  console.log(`#${i} ${t} name=${o.name||""} left=${Math.round(o.left??o.x??0)} top=${Math.round(o.top??o.y??0)} w=${Math.round(o.width||0)} h=${Math.round(o.height||0)} sx=${o.scaleX} sy=${o.scaleY} angle=${o.angle??o.rotation??0}`);
  console.log(`    stroke=${JSON.stringify(o.stroke)} strokeWidth=${o.strokeWidth} cornerRadius=${o.cornerRadius} rx=${o.rx} corners=${JSON.stringify(o.cornerRadiusCorners)}`);
  if (t==="image"||t==="video") console.log(`    crop=${JSON.stringify(o.crop||o.cropX!==undefined&&{cropX:o.cropX,cropY:o.cropY}||null)} src=${String(o.src||o.imageUri||"").slice(0,80)}`);
}
await prisma.$disconnect();
