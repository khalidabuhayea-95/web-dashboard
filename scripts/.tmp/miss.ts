import prisma from "@/lib/prisma";
import { keywordTargets } from "@/lib/search/templateKeywords.server";
async function main() {
  const rows = (await prisma.$queryRawUnsafe(`SELECT name, "searchKeywords" k FROM "Template"`)) as any[];
  const has = (k: any, re: RegExp) => Array.isArray(k) && k.some((w: string) => re.test(w));
  const miss = rows.filter((r) => { const t = keywordTargets(r.name); return (t.includes("ar") && !has(r.k, /[؀-ۿ]/)) || (t.includes("en") && !has(r.k, /[a-z]/)); });
  const kinds = { psdOrUntitled: 0, other: 0 };
  const samples: string[] = [];
  for (const r of miss) { if (/\.psd|بدون عنوان|untitled|^\d/i.test(r.name)) kinds.psdOrUntitled++; else { kinds.other++; if (samples.length < 12) samples.push(`${r.name.slice(0, 70)} → [${r.k.join(", ")}]`); } }
  console.log(kinds); console.log(samples.join("\n"));
  await prisma.$disconnect();
}
main();
