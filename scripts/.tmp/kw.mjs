import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
console.log(await c.$queryRawUnsafe(`SELECT name, "searchKeywords", "updatedAt" FROM "Template" WHERE jsonb_array_length("searchKeywords") > 0`));
await c.$disconnect();
