import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT data FROM "Template" WHERE id = '3ab7d0ac-a7d4-4897-a8a0-4894815d5c29'`;
const objs = rows[0].data.objects || [];
console.log(objs[2].src); console.log(objs[3].src);
await prisma.$disconnect();
