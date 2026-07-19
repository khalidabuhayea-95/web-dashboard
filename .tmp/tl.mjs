import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT id, data FROM "Template" WHERE id::text LIKE 'fde3d25b%'`;
const objs = (rows[0].data||{}).objects||[];
console.log("extBuild:", objs.map(o=>o.extBuild).find(Boolean), "| objects:", objs.length);
const warns = ((rows[0].data||{}).meta?.import?.warnings || []).filter(w=>/SKIP|frame/i.test(w));
console.log("skip warnings:", JSON.stringify(warns));
let mp=0, anim=0, inout=0;
objs.forEach(o=>{ if (Array.isArray(o.mediaMotionPath)) mp++; if (o.mediaAnimationType) anim++; if (o.mediaAnimationMode==="IN_OUT") inout++; });
console.log(`SUMMARY: total=${objs.length} motionPaths=${mp} withAnim=${anim} inOut=${inout}`);
objs.forEach((o,i)=>{
  if (o.mediaAnimationType || Array.isArray(o.mediaMotionPath))
    console.log(`#${i} [${o.type}] "${String(o.text||'').replace(/\n/g,' ').slice(0,14)}" ${o.mediaAnimationType||'-'}/${o.mediaAnimationMode||'-'} dur=${o.mediaAnimationDurationMs||'-'} out=${o.mediaAnimationOutDurationMs||'-'} mp=${Array.isArray(o.mediaMotionPath)?o.mediaMotionPath.length+'pts→x'+Math.round(o.mediaMotionPath[o.mediaMotionPath.length-1].x):'-'} win=${o.timelineStartMs}→${o.timelineEndMs}`);
});
await prisma.$disconnect();
