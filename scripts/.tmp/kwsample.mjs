import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT name, "searchKeywords" k FROM "Template" WHERE jsonb_array_length("searchKeywords") > 0 ORDER BY random() LIMIT 10`);
for (const r of rows) console.log(`${r.name.slice(0, 60)}\n   → ${r.k.join(", ")}`);
const [s] = await c.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE jsonb_array_length("searchKeywords") > 0)::int done, count(*)::int total FROM "Template"`);
console.log(s);
await c.$disconnect();
