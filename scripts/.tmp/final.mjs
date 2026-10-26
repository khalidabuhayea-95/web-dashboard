import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const [t] = await c.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE jsonb_array_length("searchKeywords") > 0)::int AS done, count(*)::int AS total FROM "Template"`);
const [e] = await c.$queryRawUnsafe(`SELECT count(*)::int total, count(*) FILTER (WHERE translation_status='fallback')::int fallback, count(*) FILTER (WHERE title_ar !~ '[؀-ۿ]')::int title_en, count(*) FILTER (WHERE jsonb_array_length(tags_en) > 0 AND tags_ar::text !~ '[؀-ۿ]')::int tags_en FROM editor_element_assets`);
console.log(t, e);
await c.$disconnect();
