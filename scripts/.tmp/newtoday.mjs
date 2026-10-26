import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
console.log(await c.$queryRawUnsafe(`SELECT source, translation_status, count(*)::int AS rows,
  count(*) FILTER (WHERE title_ar !~ '[؀-ۿ]')::int AS title_en_only,
  count(*) FILTER (WHERE jsonb_array_length(tags_en) > 0 AND tags_ar::text !~ '[؀-ۿ]')::int AS tags_en_only,
  min(created_at) AS first, max(created_at) AS last
  FROM editor_element_assets WHERE created_at >= '2026-10-19 00:00+03' GROUP BY 1,2`));
const rows = await c.$queryRawUnsafe(`SELECT title_en, title_ar, tags_en, tags_ar FROM editor_element_assets WHERE created_at >= '2026-10-19 12:00+03' ORDER BY random() LIMIT 5`);
for (const r of rows) console.log(`${r.title_en} → ${r.title_ar} | ${r.tags_en.slice(0,4).map((t,i)=>`${t}=${r.tags_ar[i]}`).join(", ")}`);
await c.$disconnect();
