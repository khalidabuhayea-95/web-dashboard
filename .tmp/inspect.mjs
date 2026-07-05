import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "bfe61005-045c-4f92-8b7d-c0de8622b00f" } });
const data = t.data || {};
const objs = data.objects || [];
console.log("objects:", objs.length, "| extBuild:", objs.map(o=>o.extBuild).find(Boolean));
console.log("bgColor:", data.backgroundColor);
console.log("warnings:", (data.meta?.import?.warnings||[]).join(" | "));
console.log("=== objects (bottom→top) ===");
objs.forEach((o,i)=>{
  const sx=o.scaleX??1, sy=o.scaleY??1;
  const w=Math.round((o.width??0)*Math.abs(sx)), h=Math.round((o.height??0)*Math.abs(sy));
  const isText = /text/.test(o.type||"");
  const name = (o.layerName||o.titleEn||o.name||'').slice(0,26);
  console.log(`#${i} [${o.type}] "${name}" ${w}x${h}@(${Math.round(o.left)},${Math.round(o.top)}) op=${o.opacity??1} ${o.angle?'ang='+Math.round(o.angle):''} ${isText?'"'+(o.text||'').slice(0,18)+'"':'prov='+(o.imageProvenance||'-')}`);
});
console.log("=== layerTree names ===");
for (const n of (data.meta?.import?.layerTree||[])) console.log(`  ${n.id}: "${(n.name||'').slice(0,30)}" ${Math.round(n.bounds?.width)}x${Math.round(n.bounds?.height)}`);
await prisma.$disconnect();
