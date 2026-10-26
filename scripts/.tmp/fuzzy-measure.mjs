import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
for (const [term, th] of [["balons", 0.45], ["balons", 0.5], ["aniversary", 0.6], ["weding", 0.45], ["flowr", 0.45], ["كيكا", 0.45], ["زفافف", 0.45], ["رمضاان", 0.45]]) {
  const t0 = Date.now();
  const rows = await c.$queryRawUnsafe(`SELECT title_en, round(word_similarity($1, search_title)::numeric, 2) ws FROM editor_element_assets WHERE word_similarity($1, search_title) >= $2 ORDER BY 2 DESC LIMIT 6`, term, th);
  const n = await c.$queryRawUnsafe(`SELECT count(*)::int n FROM editor_element_assets WHERE word_similarity($1, search_title) >= $2 OR word_similarity($1, search_tags) >= $2`, term, th);
  console.log(term, th, `${Date.now() - t0}ms`, "count", n[0].n, rows.map((r) => `${r.title_en}(${r.ws})`).join(" | "));
}
await c.$disconnect();
