import prisma from "@/lib/prisma";
import fs from "node:fs";
const ID = "2ff48616-118b-4c4a-a099-78ca0b6e4356";
// DAHNZVrSYZM's first card, read off Canva's page at 5.2 s (the import rebuilt these from the model).
const CANVA: Record<string, { fontSize: number; fontWeight: number; lineHeight: number; textAlign: string }> = {
  LBZQck65XhRSwhm3: { fontSize: 62.473, fontWeight: 700, lineHeight: 1.3967, textAlign: "center" },
  LB1RkLSZZH2Zn6PN: { fontSize: 118.972, fontWeight: 400, lineHeight: 1.3995, textAlign: "left" },
  LBM6t3rwXrrr51jL: { fontSize: 100.652, fontWeight: 400, lineHeight: 1.3967, textAlign: "center" },
  LBKxsZHNTjWLKMKt: { fontSize: 99.951, fontWeight: 400, lineHeight: 1.3986, textAlign: "center" },
};
async function main() {
  const t: any = await prisma.template.findUnique({ where: { id: ID } });
  fs.writeFileSync(`tmp/template-2ff48616-backup-${Date.now()}.json`, JSON.stringify(t, null, 2));
  const data = JSON.parse(JSON.stringify(t.data));
  for (const o of data.objects) {
    const want = CANVA[String(o.importNodeId || "")];
    if (!want) continue;
    console.log(o.importNodeId, "before", o.fontSize, o.fontWeight, o.lineHeight, o.textAlign);
    Object.assign(o, want);
  }
  await prisma.template.update({ where: { id: ID }, data: { data } });
  const after = await prisma.template.findUnique({ where: { id: ID }, select: { updatedAt: true } });
  console.log("updatedAt", after!.updatedAt.toISOString());
}
main().finally(() => prisma.$disconnect());
