import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT title_en, title_ar, tags_en::text te, tags_ar::text ta FROM editor_element_assets WHERE translation_status = 'translated' AND source = 'freepik' AND title_ar ~ '[؀-ۿ]' ORDER BY created_at DESC LIMIT 12`);
for (const r of rows) console.log(`${r.title_en} → ${r.title_ar}  |  ${r.te.slice(0, 70)} → ${r.ta.slice(0, 70)}`);
await c.$disconnect();
