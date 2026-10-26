import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "11fe69b8-f6b4-40d0-9c23-4041172b8981" } });
const id = process.argv[2];
const o = t.data.objects.find((x) => x.importNodeId === id);
const { animations, src, rasterPalette, ...rest } = o;
console.log(JSON.stringify(rest, null, 0));
console.log(JSON.stringify((t.data.meta?.import?.layerTree || []).find((n) => n.id === id)));
await prisma.$disconnect();
