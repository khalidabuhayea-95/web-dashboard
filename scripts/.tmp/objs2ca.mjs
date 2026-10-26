import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "2ca65f69-be04-4f80-8486-cff794ce8aa2" } });
for (const o of t.data.objects) {
  const { src, text, animations, ...rest } = o;
  console.log(JSON.stringify({ type: o.type, id: o.importNodeId, name: o.layerName, left: o.left, top: o.top, w: o.width, h: o.height, sx: o.scaleX, sy: o.scaleY, angle: o.angle, crop: [o.cropX, o.cropY], wrapWidth: o.wrapWidth, textSpans: o.textSpans, anim: animations && Object.fromEntries(Object.entries(animations).map(([k, v]) => [k, v && v.type])) }));
}
console.log(Object.keys(t.data.objects[0]).join(","));
await prisma.$disconnect();
