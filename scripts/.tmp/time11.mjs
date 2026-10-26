import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "11fe69b8-f6b4-40d0-9c23-4041172b8981" } });
for (const o of t.data.objects) {
  console.log(JSON.stringify({ id: o.importNodeId, name: (o.layerName || "").slice(0, 20), op: o.opacity, ts: o.timelineStartMs, te: o.timelineEndMs, hidden: o.layerHidden, vis: o.visible, anim: o.animations && JSON.stringify(o.animations).slice(0, 160), mam: o.mediaAnimationMode, mat: o.mediaAnimationType }));
}
console.log(JSON.stringify(t.data.meta?.import?.page));
await prisma.$disconnect();
