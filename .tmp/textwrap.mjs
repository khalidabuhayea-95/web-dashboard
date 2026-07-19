import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT id, name, data FROM "Template" WHERE id = '494cd442-09f1-4a76-adca-632108dfad91'::uuid`;
const d = rows[0].data || {};
for (const p of d.pages || []) {
  console.log(`PAGE ${p.width}x${p.height}  elements=${(p.elements||[]).length}`);
  for (const o of p.elements || []) {
    if (o.type !== "text" || !o.text) continue;
    const w = Number(o.width)||0, sx = Number(o.scaleX ?? 1), h = Number(o.height)||0, sy = Number(o.scaleY ?? 1);
    console.log("\n--- " + JSON.stringify(String(o.text).replace(/\n/g,"\\n").slice(0,55)));
    console.log("    " + JSON.stringify({
      width: Math.round(w), height: Math.round(h),
      scaleX: +sx.toFixed(3), scaleY: +sy.toFixed(3),
      displayWidth: Math.round(w*sx),
      pctOfCanvas: +((w*sx)/p.width*100).toFixed(1) + "%",
      fontSize: +(Number(o.fontSize)||0).toFixed(2),
      lineHeight: o.lineHeight, align: o.align||o.textAlign, isRtl: o.isRtl,
      fontFamily: o.fontFamily, x: Math.round(o.x), y: Math.round(o.y), angle: o.angle||o.rotation||0,
      MOBILE_scaleX: +((Math.abs(sx)*Math.max(w,1))/250).toFixed(3),
      MOBILE_scaleY: +((Math.abs(sy)*Math.max(h,1))/110).toFixed(3),
    }));
  }
}
await prisma.$disconnect();
