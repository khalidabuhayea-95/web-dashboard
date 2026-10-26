import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const q = (s) => c.$queryRawUnsafe(s);
console.log(await q(`SELECT source, count(*)::int AS total, count(*) FILTER (WHERE tags_ar::text ~ '[؀-ۿ]')::int AS tags_ar_has_arabic, count(*) FILTER (WHERE title_ar ~ '[؀-ۿ]')::int AS title_ar_has_arabic, count(*) FILTER (WHERE tags_ar = tags_en)::int AS tags_ar_equals_en FROM editor_element_assets GROUP BY 1`));
console.log(await q(`SELECT category_value, count(*)::int FROM editor_element_assets GROUP BY 1 ORDER BY 2 DESC LIMIT 15`));
console.log("distinct en tags", await q(`SELECT count(DISTINCT t)::int FROM editor_element_assets, jsonb_array_elements_text(tags_en) t`));
console.log("distinct template tag tokens", await q(`SELECT count(DISTINCT t)::int FROM "Template", jsonb_array_elements_text(tags) t`));
console.log("pg version", await q(`SELECT version()`));
await c.$disconnect();
