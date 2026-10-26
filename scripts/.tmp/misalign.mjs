import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
console.log("new today", await c.$queryRawUnsafe(`SELECT source, translation_status, count(*)::int, min(created_at) AS first, max(created_at) AS last FROM editor_element_assets WHERE created_at > '2026-10-19 06:00+00' GROUP BY 1,2`));
console.log("length mismatch", await c.$queryRawUnsafe(`SELECT source, count(*)::int AS rows, count(*) FILTER (WHERE jsonb_array_length(tags_en) <> jsonb_array_length(tags_ar))::int AS mismatched FROM editor_element_assets GROUP BY 1`));
console.log("arrows pairs", await c.$queryRawUnsafe(`SELECT ar.value AS ar, count(*)::int FROM editor_element_assets, jsonb_array_elements_text(tags_en) WITH ORDINALITY en(value, n) JOIN jsonb_array_elements_text(tags_ar) WITH ORDINALITY ar(value, n) USING (n) WHERE en.value = 'arrows' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`));
console.log("arrows pairs, aligned rows only", await c.$queryRawUnsafe(`SELECT ar.value AS ar, count(*)::int FROM editor_element_assets, jsonb_array_elements_text(tags_en) WITH ORDINALITY en(value, n) JOIN jsonb_array_elements_text(tags_ar) WITH ORDINALITY ar(value, n) USING (n) WHERE en.value = 'arrows' AND jsonb_array_length(tags_en) = jsonb_array_length(tags_ar) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`));
await c.$disconnect();
