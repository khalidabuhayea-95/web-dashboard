import prisma from "@/lib/prisma";
import fs from "node:fs";
const ID = "11fe69b8-f6b4-40d0-9c23-4041172b8981";
async function main() {
  const t: any = await prisma.template.findUnique({ where: { id: ID } });
  fs.writeFileSync(`tmp/template-11fe69b8-backup-${Date.now()}.json`, JSON.stringify(t, null, 2));
  const data = JSON.parse(JSON.stringify(t.data));
  const o = data.objects.find((x: any) => x.importNodeId === "LBntHjhwPnWSYGmD");
  // Canva: frame (112.1, 7) 1079.5x1913, clipped by the page at x = 1080. The asset is that window.
  const left = 112.1;
  const top = 7.02;
  const width = 1080 - left;
  const height = 1920 - top;
  o.left = left;
  o.top = top;
  o.scaleX = width / Number(o.width);
  o.scaleY = height / Number(o.height);
  const node = (data.meta?.import?.layerTree || []).find((n: any) => n.id === "LBntHjhwPnWSYGmD");
  if (node) node.bounds = { x: left, y: top, width, height };
  await prisma.template.update({ where: { id: ID }, data: { data } });
  const after = await prisma.template.findUnique({ where: { id: ID }, select: { updatedAt: true } });
  console.log("texture", o.left, o.top, o.scaleX.toFixed(4), o.scaleY.toFixed(4), "updatedAt", after!.updatedAt.toISOString());
}
main().finally(() => prisma.$disconnect());
