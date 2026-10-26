import prisma from "@/lib/prisma";
import { SEARCH_TRGM_THRESHOLD_SQL, dedupingParam, scoredSearchCtes } from "@/lib/search/searchSql";
import { planSearchQuery } from "@/lib/search/searchTranslate.server";

async function main() {
  const query = process.argv[2] || "balloons";
  const plan = await planSearchQuery(query, { translate: false });
  console.log(JSON.stringify(plan.concepts.map((c: any) => c.variants.map((v: any) => `${v.kind}:${v.terms.join("+")}`))));
  const params: unknown[] = [];
  const param = dedupingParam((value: unknown) => { params.push(value); return `$${params.length}`; });
  const ctes = scoredSearchCtes({ plan, columns: { title: "search_title", tags: "search_tags" }, param, from: "editor_element_assets", where: "1=1", select: [["id", "id"]] });
  console.log("sql chars", ctes.length, "params", params.length);
  const [, rows] = await prisma.$transaction([
    prisma.$queryRawUnsafe(process.env.NOSEQ ? "SELECT set_config('enable_seqscan', 'off', true), set_config('pg_trgm.word_similarity_threshold', '0.5', true)" : "SELECT set_config('pg_trgm.word_similarity_threshold', '0.5', true)"),
    prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${ctes} SELECT count(*) FROM kept`, ...params),
  ]);
  for (const row of rows as any[]) {
    const line = row["QUERY PLAN"];
    if (/Seq Scan|Bitmap|WindowAgg|Execution|Planning|CTE|rows=/.test(line)) console.log(line.slice(0, 170));
  }
}
main().finally(() => prisma.$disconnect());
