import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT name, status FROM "Template" WHERE jsonb_array_length("searchKeywords") = 0 ORDER BY random() LIMIT 15`);
for (const r of rows) console.log(r.status, "|", r.name);
await c.$disconnect();
