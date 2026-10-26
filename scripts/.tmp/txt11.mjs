import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "11fe69b8-f6b4-40d0-9c23-4041172b8981" } });
for (const o of t.data.objects.filter((x) => x.type === "textbox")) {
  console.log(JSON.stringify({ id: o.importNodeId, text: o.text, fs: o.fontSize, ff: o.fontFamily, fw: o.fontWeight, cs: o.charSpacing, ls: o.letterSpacing, lh: o.lineHeight, ta: o.textAlign, dir: o.direction, spans: o.textSpans, w: o.width, l: o.left, t: o.top, h: o.height }));
}
for (const tok of ["YAFdJnPX3ZE_0", "YAFdJuZe0mI_0"]) {
  const al = await prisma.fontAlias.findMany({ where: { alias: tok }, include: { font: { select: { family: true, files: { select: { kind: true, status: true } } } } } });
  const fam = await prisma.fontFamily.findMany({ where: { family: tok }, select: { family: true } });
  console.log(tok, JSON.stringify(al.map((a) => [a.font.family, a.font.files.map((f) => f.kind + ":" + f.status)])), JSON.stringify(fam));
}
await prisma.$disconnect();
