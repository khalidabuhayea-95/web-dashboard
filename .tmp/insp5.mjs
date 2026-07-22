import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT data FROM "Template" WHERE id = '3ab7d0ac-a7d4-4897-a8a0-4894815d5c29'`;
const objs = rows[0].data.objects || [];
for (const i of [2,3]) {
  const o = objs[i];
  const slim = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string" && v.length > 80) slim[k] = v.slice(0,60)+"…";
    else slim[k] = v;
  }
  console.log(`--- #${i} ---`);
  console.log(JSON.stringify(slim, null, 1));
}
await prisma.$disconnect();
