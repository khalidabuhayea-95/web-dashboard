import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: "f85ab2fc-bba4-4232-bc6b-282c285dc8a2" } });
const objs = (t.data||{}).objects||[];
console.log("extBuild:", objs.map(o=>o.extBuild).find(Boolean), "| objects:", objs.length);
let mp=0, anim=0, inout=0;
objs.forEach((o,i)=>{
  const hasMp = Array.isArray(o.mediaMotionPath);
  if (hasMp) mp++;
  if (o.mediaAnimationType) anim++;
  if (o.mediaAnimationMode==="IN_OUT") inout++;
  if (hasMp || o.mediaAnimationType) {
    const path = hasMp ? ` PATH(${o.mediaMotionPath.length}pts span=${Math.round(o.mediaMotionPath[o.mediaMotionPath.length-1].t/100)/10}s dx=${Math.round(o.mediaMotionPath[o.mediaMotionPath.length-1].x)},dy=${Math.round(o.mediaMotionPath[o.mediaMotionPath.length-1].y)})` : "";
    console.log(`#${i} [${o.type}] "${String(o.text||'').replace(/\n/g,' ').slice(0,14)}" ${o.mediaAnimationType||''}/${o.mediaAnimationMode||''} dur=${o.mediaAnimationDurationMs||''} out=${o.mediaAnimationOutDurationMs||''} preset=${o.canvaAnimationPreset??''}${path} win=${o.timelineStartMs}→${o.timelineEndMs}`);
  }
});
console.log(`\nSUMMARY: motionPaths=${mp} withType=${anim} inOut=${inout}`);
await prisma.$disconnect();
