import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT id, data FROM "Template" WHERE id::text LIKE 'a977fd3b%'`;
const objs = (rows[0].data||{}).objects||[];
console.log("extBuild:", objs.map(o=>o.extBuild).find(Boolean), "| objects:", objs.length);
const warns = (rows[0].data||{}).meta?.import?.warnings;
console.log("warnings:", JSON.stringify(warns||[]));
let mp=0, anim=0, tl=0;
objs.forEach((o,i)=>{
  if (Array.isArray(o.mediaMotionPath)) mp++;
  if (o.mediaAnimationType) anim++;
  if (Number.isFinite(Number(o.timelineStartMs))) tl++;
});
console.log(`SUMMARY: motionPaths=${mp} withAnimType=${anim} withTimeline=${tl}`);
objs.slice(0,30).forEach((o,i)=>{
  if (o.mediaAnimationType || Array.isArray(o.mediaMotionPath) || String(o.type).includes('text'))
    console.log(`#${i} [${o.type}] "${String(o.text||'').replace(/\n/g,' ').slice(0,14)}" ${o.mediaAnimationType||'-'}/${o.mediaAnimationMode||'-'} mp=${Array.isArray(o.mediaMotionPath)?o.mediaMotionPath.length:'-'} win=${o.timelineStartMs}→${o.timelineEndMs} preset=${o.canvaAnimationPreset??'-'}`);
});
await prisma.$disconnect();
