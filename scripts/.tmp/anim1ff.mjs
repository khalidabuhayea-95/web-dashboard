import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "1ff79028-26d9-49b8-8e60-ce0160c624b4" } });
console.log(t.name, t.updatedAt.toISOString(), JSON.stringify(t.data.meta?.import?.page), JSON.stringify(t.data.meta?.import?.source), t.data.meta?.import?.canvaUrl || t.data.meta?.import?.sourceUrl || "");
console.log(JSON.stringify(Object.keys(t.data.meta?.import || {})));
console.log(JSON.stringify(t.data.meta?.import?.warnings));
for (const o of t.data.objects) {
  console.log(JSON.stringify({ id: o.importNodeId, name: (o.layerName || "").slice(0, 22), type: o.type, ts: o.timelineStartMs, te: o.timelineEndMs, preset: o.canvaPageAnimationPreset ?? o.canvaAnimationPreset, mode: o.mediaAnimationMode, mtype: o.mediaAnimationType, anim: o.animations }));
}
await prisma.$disconnect();
