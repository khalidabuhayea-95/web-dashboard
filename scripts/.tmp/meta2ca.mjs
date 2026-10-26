import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "2ca65f69-be04-4f80-8486-cff794ce8aa2" } });
const d = t.data;
console.log(JSON.stringify(d.meta).slice(0, 3000));
console.log(t.canvasSize, t.createdAt, t.updatedAt);
const o = d.objects.find((x) => x.text && x.text.includes("بكل"));
console.log(JSON.stringify(o).slice(0, 4000));
await prisma.$disconnect();
