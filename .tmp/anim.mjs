import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "ab05f538-7645-49bc-a0f2-8bfb0d378ca6" } });
const data = t.data || {};
const objs = data.objects || [];
console.log("extBuild:", objs.map(o=>o.extBuild).find(Boolean), "| objects:", objs.length);
console.log("layerStats:", JSON.stringify(data.meta?.import?.layerStats));
objs.forEach((o,i)=>{
  console.log(`#${i} [${o.type}] "${(o.layerName||o.name||o.text||'').toString().slice(0,22)}" animType=${o.mediaAnimationType||'-'} mode=${o.mediaAnimationMode||'-'} dur=${o.mediaAnimationDurationMs||'-'} preset=${o.canvaAnimationPreset??'-'}`);
});
await prisma.$disconnect();
