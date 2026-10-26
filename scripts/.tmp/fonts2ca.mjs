import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
for (const q of ["yackognngau4", "yackognga", "yaexhrditjw", "droid kufi", "droidkufi", "dg ghareeb", "dgghareeb"]) {
  const fam = await prisma.fontFamily.findMany({ where: { OR: [{ normalizedFamily: { contains: q } }, { family: { contains: q, mode: "insensitive" } }] }, include: { aliases: true, files: { select: { kind: true, fontWeight: true, status: true, publicUrl: true } } } });
  const al = await prisma.fontAlias.findMany({ where: { normalizedAlias: { contains: q } }, include: { font: { select: { family: true } } } });
  console.log(q, JSON.stringify(fam.map(f => ({ family: f.family, norm: f.normalizedFamily, css: f.cssFontFamily, aliases: f.aliases.map(a => a.alias), files: f.files.map(x => x.kind + ":" + x.status) }))), JSON.stringify(al.map(a => a.alias + "->" + a.font.family)));
}
await prisma.$disconnect();
