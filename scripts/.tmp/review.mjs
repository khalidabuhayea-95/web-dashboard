import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const ids = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id);
const rows = await c.$queryRawUnsafe(`SELECT title_en, title_ar, tags_en, tags_ar, translation_status FROM editor_element_assets WHERE id = ANY($1::uuid[])`, ids);
for (const r of rows.slice(0, 18)) console.log(`${r.title_en} → ${r.title_ar} [${r.translation_status}]\n   ${r.tags_en.map((t, i) => `${t}=${r.tags_ar[i]}`).join(", ")}`);
await c.$disconnect();
