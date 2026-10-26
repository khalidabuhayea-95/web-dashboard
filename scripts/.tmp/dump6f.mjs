import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "736ad734-0a9b-4934-9dbc-1acbdafb2fa1" } });
console.log(t.name, JSON.stringify(t.canvasSize), t.updatedAt.toISOString());
const d = t.data;
console.log(JSON.stringify(d.meta?.import?.page), JSON.stringify(d.meta?.import?.warnings));
console.log("bg", JSON.stringify(d.background || d.backgroundColor || d.meta?.background || null).slice(0, 300));
for (const o of d.objects) {
  const r = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
  console.log(JSON.stringify({ type: o.type, id: o.importNodeId, name: o.layerName, kind: o.importKind, text: o.text?.slice(0, 40), l: r(o.left), t: r(o.top), w: r(o.width), h: r(o.height), sx: r(o.scaleX), sy: r(o.scaleY), a: r(o.angle), fs: r(o.fontSize), ff: o.fontFamily, fw: o.fontWeight, fill: typeof o.fill === "string" ? o.fill : o.fill ? "obj" : undefined, op: o.opacity, ext: o.extBuild, spans: o.textSpans?.length, anim: o.animations ? Object.fromEntries(Object.entries(o.animations).map(([k, v]) => [k, v && v.type])) : undefined, src: typeof o.src === "string" ? o.src.slice(0, 60) : undefined }));
}
await prisma.$disconnect();
