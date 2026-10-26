import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "2ca65f69-be04-4f80-8486-cff794ce8aa2" } });
const keys = Object.keys(t);
console.log(keys.join(","));
const json = t.canvasJson || t.json || t.data;
const pick = (o) => o;
const d = typeof json === "string" ? JSON.parse(json) : json;
console.log(Object.keys(d || {}));
const objs = d?.objects || d?.pages?.[0]?.objects || [];
for (const o of objs) {
  if (o.type?.includes("text") || o.text) console.log(JSON.stringify({ id: o.id, type: o.type, text: o.text, left: o.left, top: o.top, w: o.width, h: o.height, sx: o.scaleX, sy: o.scaleY, fs: o.fontSize, ff: o.fontFamily, fw: o.fontWeight, lh: o.lineHeight, cs: o.charSpacing, angle: o.angle, canvaId: o.canvaElementId || o.importMeta?.canvaId, dbg: o.importDebug ? Object.keys(o.importDebug) : undefined }));
}
await prisma.$disconnect();
