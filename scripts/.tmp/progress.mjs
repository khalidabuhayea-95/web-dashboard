import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
console.log(await c.$queryRawUnsafe(`SELECT translation_status, count(*)::int, count(*) FILTER (WHERE title_ar !~ '[؀-ۿ]')::int AS title_en_only, count(*) FILTER (WHERE jsonb_array_length(tags_en) > 0 AND tags_ar::text !~ '[؀-ۿ]')::int AS tags_en_only FROM editor_element_assets GROUP BY 1`));
console.log(await c.$queryRawUnsafe(`SELECT count(*)::int AS total, count(*) FILTER (WHERE jsonb_array_length("searchKeywords") > 0)::int AS with_keywords FROM "Template"`));
await c.$disconnect();
