import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
console.log(await c.$queryRawUnsafe(`SELECT source, translation_status, count(*)::int, count(*) FILTER (WHERE tags_ar = tags_en AND jsonb_array_length(tags_en) > 0)::int AS tags_untranslated, count(*) FILTER (WHERE title_ar !~ '[؀-ۿ]')::int AS title_untranslated FROM editor_element_assets GROUP BY 1,2 ORDER BY 1,2`));
await c.$disconnect();
