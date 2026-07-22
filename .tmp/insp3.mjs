import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT data FROM "Template" WHERE id = '3ab7d0ac-a7d4-4897-a8a0-4894815d5c29'`;
const objs = rows[0].data.objects || [];
console.log("build:", objs.find(o=>o.extBuild)?.extBuild);
for (const [i,o] of objs.entries()) {
  if (o.type !== "image" && o.type !== "video") continue;
  console.log(`#${i} ${o.type} "${(o.name||"").slice(0,40)}" ${Math.round(o.width)}x${Math.round(o.height)} sx=${(o.scaleX??1).toFixed(2)}`);
  console.log(`    stroke=${JSON.stringify(o.stroke)} strokeWidth=${JSON.stringify(o.strokeWidth)} cornerRadius=${JSON.stringify(o.cornerRadius)} prov=${o.imageProvenance} fbReason=${o.fallbackReason||""}`);
}
await prisma.$disconnect();
