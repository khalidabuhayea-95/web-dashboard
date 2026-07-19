import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const revs = await prisma.$queryRaw`
  SELECT version, snapshot FROM "TemplateRevision"
  WHERE "templateId" = '494cd442-09f1-4a76-adca-632108dfad91'::uuid AND version IN (5,6,7)
  ORDER BY version ASC`;
const byV = Object.fromEntries(revs.map(r => [r.version, (r.snapshot?.data || r.snapshot || {})]));
const els = v => Object.fromEntries(((byV[v]?.pages?.[0]?.elements) || []).map(e => [e.id, e]));
for (const [a,b] of [[5,6],[6,7]]) {
  const A = els(a), B = els(b);
  console.log(`\n===== v${a} -> v${b} =====`);
  const ids = new Set([...Object.keys(A), ...Object.keys(B)]);
  let n = 0;
  for (const id of ids) {
    if (!A[id]) { console.log(`  + added ${id}`); continue; }
    if (!B[id]) { console.log(`  - removed ${id}`); continue; }
    const keys = new Set([...Object.keys(A[id]), ...Object.keys(B[id])]);
    const diffs = [...keys].filter(k => JSON.stringify(A[id][k]) !== JSON.stringify(B[id][k]));
    if (diffs.length) {
      n++;
      console.log(`  ~ ${String(A[id].text||A[id].type).slice(0,14)}: ` +
        diffs.map(k => `${k}: ${JSON.stringify(A[id][k])?.slice(0,22)} -> ${JSON.stringify(B[id][k])?.slice(0,22)}`).join(" | "));
    }
  }
  if (!n) console.log("  (no element changes)");
}
await prisma.$disconnect();
