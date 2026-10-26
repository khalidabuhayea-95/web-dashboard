import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const [e] = await c.$queryRawUnsafe(`SELECT count(*)::int n FROM editor_element_assets WHERE translation_status = 'fallback'`);
const [t] = await c.$queryRawUnsafe(`SELECT count(*)::int n FROM "Template" WHERE jsonb_array_length("searchKeywords") = 0`);
console.log(`remaining elements=${e.n} templates=${t.n}`);
await c.$disconnect();
