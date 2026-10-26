import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import vm from "node:vm";
const ID = "1ff79028-26d9-49b8-8e60-ce0160c624b4";
const source = fs.readFileSync("extensions/canva-importer/background.js", "utf8");
const start = source.indexOf("// ── canva-animation-mapping:start");
const end = source.indexOf("// ── canva-animation-mapping:end");
const mapping = vm.runInNewContext(
  `${source.slice(source.lastIndexOf("\n", start) + 1, end)}\n;({ applyCanvaPageAnimations, drainCanvaAnimationImportWarnings });`,
  {}
);
// DAHNZYC32A0's page model as Canva holds it (read live from the design, 2026-10-14).
const rows = `LBntHjhwPnWSYGmD,rect,112.075,7.022,1079.547,1912.978,0,,1;LB3gDb1vpxn7CtM2,rect,108,1183.44,864,736.56,0,,1;LBnZ1wjv58PxkpLX,rect,965.552,1706.453,352.364,350.602,65.263,,1;LBQzcYVr7kp1y9qg,rect,824.3,1751.102,313.867,312.297,65.263,,1;LBCp4XXngS6LqbkY,rect,673.139,1751.102,313.867,312.297,65.263,,1;LBW42ctb8R92Sxdx,rect,512.07,1706.453,352.364,350.602,65.263,,1;LBpgtkT84jrMfvLp,rect,950.188,1764.61,160.955,155.39,0,,1;LBsYbvK8kSbpSQnT,rect,1030.666,1764.61,160.955,155.39,0,,1;LBmpbdzZq1scPTmN,rect,838.567,1764.61,160.955,155.39,0,,1;LB36cSwxnKq4WYvS,rect,716.754,1764.61,160.955,155.39,0,,1;LBBD4PTcpLFXcPFF,rect,402.842,1764.61,160.955,155.39,0,,1;LBmhpkyM94JdHz6L,rect,217.229,1709.765,346.552,344.82,-49.746,,1;LBR0vBnYgLNyxy7n,rect,68.61,1747.59,346.552,344.82,-49.746,,1;LB0PTCn2KDnXBjH0,rect,-138.61,1669.895,346.552,344.82,-49.746,,1;LBl2fv4S6hsSMtG0,rect,634.72,1764.61,160.955,155.39,0,,1;LBq1q635t370337S,rect,540,1764.61,160.955,155.39,0,,1;LB8JYVvB5TJK8f1c,rect,483.319,1764.61,160.955,155.39,0,,1;LBpRR26d7YHwsmfH,rect,322.364,1764.61,160.955,155.39,0,,1;LBSr69TrC11nSvtt,rect,241.886,1764.61,160.955,155.39,0,,1;LBYDz4cS9dmm2H8b,rect,161.409,1764.61,160.955,155.39,0,,1;LBYXcRb7DLqWgTKp,rect,80.931,1764.61,160.955,155.39,0,,1;LBWKdKc7lRh147Q1,rect,0.453,1764.61,160.955,155.39,0,,1;LB4fBxL3m2yNWJkT,rect,294.214,1309.58,340.506,338.803,0,,1;LBgylgrPj9pYbjVD,rect,450.225,1309.58,340.506,338.803,0,,1;LB22kh9f1XcjdWqh,rect,469.626,1254.625,256.16,254.88,65.263,,1;LBQ93xFnVn4jVWKM,rect,341.241,1260.299,256.16,254.88,-59.125,,1;LBz857Xj62njVDlL,rect,909.481,1604.909,256.16,254.88,-43.777,,1;LBjsdWlGh6XRmmxg,rect,-95.009,1599.361,268.109,254.88,65.263,,1;LBqM8M202h31p5dP,rect,187.563,754.824,698.691,15.244,0,2333333,1;LB4y085xsHs7CfHy,rect,280.549,110.606,516.049,516.049,0,2333333,1;LBRMLLKBHBTbGL9t,text,198.423,786.861,702.028,46.796,0,2333333,0;LBGthygndZ8xBx0n,text,80.931,687.49,905.178,57.484,0,2333333,0;LBMb7ZFrLNHlwnLL,text,202.2,867.2,672.7,92.8,0,2333333,0;LBLFJrdFQtlYcfJY,text,197.2,998,672.7,88.4,0,2333333,0`;
const pageModel = { __pageAnimation: { preset: 17 }, __pageDurationMs: 15000, __pageWidth: 1080, __pageHeight: 1920 };
rows.split(";").forEach((row, zOrder) => {
  const [id, type, left, top, width, height, rotation, startUs, media] = row.split(",");
  pageModel[id] = {
    type,
    left: Number(left),
    top: Number(top),
    width: Number(width),
    height: Number(height),
    rotation: Number(rotation),
    zOrder,
    ...(startUs ? { startUs: Number(startUs) } : {}),
    ...(media === "1" ? { hasMediaFill: true } : {}),
    ...(type === "text" ? { text: { fontSize: 36 } } : {}),
  };
});
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: ID } });
fs.writeFileSync(`tmp/template-1ff79028-backup-${Date.now()}.json`, JSON.stringify(t, null, 2));
const data = JSON.parse(JSON.stringify(t.data));
const layers = data.objects.map((o) => ({ id: o.importNodeId, kind: o.type === "textbox" ? "text" : "image", animation: null }));
const result = mapping.applyCanvaPageAnimations(data.objects, layers, pageModel, { pageDurationMs: 15000, pageWidth: 1080, pageHeight: 1920, hasNextPage: false });
const warnings = mapping.drainCanvaAnimationImportWarnings();
for (const o of data.objects.slice(0, 6).concat(data.objects.slice(-6))) {
  const loop = o.animations?.loop;
  console.log(o.importNodeId, o.timelineStartMs, o.timelineEndMs, JSON.stringify(o.animations?.entrance), loop ? `${loop.type} s=${loop.params?.r1From} y=${loop.params?.y1From}->${loop.params?.y1To} start=${loop.params?.r1Start} dur=${loop.params?.r1Dur}` : null);
}
console.log("warnings", JSON.stringify(warnings), "applied", JSON.stringify(result).slice(0, 200));
if (process.argv[2] === "--write") {
  // Keep the import's own warning list in step with what the page now plays.
  const meta = data.meta?.import;
  if (meta && Array.isArray(meta.warnings)) {
    meta.warnings = meta.warnings.filter((w) => !/Photo Flow|page photo preset 17/.test(w)).concat(warnings.filter((w) => /Photo Flow/.test(w)).map((w) => `Animation: ${w}`));
  }
  await prisma.template.update({ where: { id: ID }, data: { data } });
  const after = await prisma.template.findUnique({ where: { id: ID }, select: { updatedAt: true } });
  console.log("written", after.updatedAt.toISOString());
}
await prisma.$disconnect();
