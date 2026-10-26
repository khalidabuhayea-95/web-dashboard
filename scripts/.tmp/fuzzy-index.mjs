import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
for (const term of ["balons", "weding", "flowr", "aniversary"]) {
  const t0 = Date.now();
  const [, rows] = await c.$transaction([
    c.$executeRawUnsafe(`SET LOCAL pg_trgm.word_similarity_threshold = 0.5`),
    c.$queryRawUnsafe(`SELECT count(*)::int n FROM editor_element_assets WHERE $1 <% search_title OR $1 <% search_tags`, term),
  ]);
  const t1 = Date.now();
  const plan = await c.$transaction([
    c.$executeRawUnsafe(`SET LOCAL pg_trgm.word_similarity_threshold = 0.5`),
    c.$queryRawUnsafe(`EXPLAIN ANALYZE SELECT count(*) FROM editor_element_assets WHERE $1 <% search_title OR $1 <% search_tags`, term),
  ]);
  console.log(term, rows[0].n, `${t1 - t0}ms`, plan[1].map((r) => r["QUERY PLAN"]).filter((l) => /Bitmap|Seq|Execution/.test(l)).join(" || "));
}
await c.$disconnect();
