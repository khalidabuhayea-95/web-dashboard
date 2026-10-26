import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const ids = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id);
const rows = await c.$queryRawUnsafe(`SELECT title_en, title_ar, tags_en, tags_ar FROM editor_element_assets WHERE id = ANY($1::uuid[]) ORDER BY random() LIMIT 14`, ids);
for (const r of rows) console.log(`${r.title_en} → ${r.title_ar}\n   ${r.tags_en.map((t, i) => `${t}=${r.tags_ar[i]}`).join(", ").slice(0, 230)}`);
const odd = await c.$queryRawUnsafe(`SELECT en.value AS en, ar.value AS ar, count(*)::int n FROM editor_element_assets, jsonb_array_elements_text(tags_en) WITH ORDINALITY en(value, k) JOIN jsonb_array_elements_text(tags_ar) WITH ORDINALITY ar(value, k) USING (k) WHERE id = ANY($1::uuid[]) AND en.value IN ('arrows','ui','interface','button','star','heart','flower','gift') GROUP BY 1,2 ORDER BY 1, 3 DESC`, ids);
console.log(odd.map((r) => `${r.en}=${r.ar}(${r.n})`).join("  "));
await c.$disconnect();
