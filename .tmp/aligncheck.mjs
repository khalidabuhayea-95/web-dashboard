import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const revs = await prisma.$queryRaw`
  SELECT version, action, "createdAt", snapshot FROM "TemplateRevision"
  WHERE "templateId" = '494cd442-09f1-4a76-adca-632108dfad91'::uuid
  ORDER BY version ASC`;
console.log("revisions:", revs.length);
for (const r of revs) {
  const d = r.snapshot?.data || r.snapshot || {};
  const els = (d.pages?.[0]?.elements || []).filter(o => o.type === "text" && o.text);
  const desc = els.map(o => `${JSON.stringify(String(o.text).slice(0,12))}=${o.align}/w${Math.round(o.width)}/lh${Number(o.lineHeight).toFixed(2)}`).join("  ");
  console.log(`v${r.version} ${r.action} ${r.createdAt?.toISOString().slice(5,16)} :: ${desc || "(no text)"}`);
}
await prisma.$disconnect();
