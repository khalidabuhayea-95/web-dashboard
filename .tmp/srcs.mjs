import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT id, data FROM "Template" WHERE id::text LIKE 'fde3d25b%'`;
const objs = (rows[0].data||{}).objects||[];
const flowers = objs.filter(o=>["LBDCNbKp","LBbBGjMb"].some(p=>String(o.importNodeId||"").startsWith(p)));
flowers.forEach(o=>{
  console.log(`${o.importNodeId}: angle=${o.angle} flipX=${o.flipX} flipY=${o.flipY} prov=${o.imageProvenance} fallback=${o.fallbackReason||o.fallback} left=${Math.round(o.left)} top=${Math.round(o.top)} w=${Math.round(o.width*(o.scaleX||1))} h=${Math.round(o.height*(o.scaleY||1))}`);
});
// also: does any object carry the video-ish media or full-canvas at window 0-14900?
const fullCanvas = objs.filter(o=>o.type==='image' && Math.round(o.width*(o.scaleX||1))>1000 && Math.round(o.height*(o.scaleY||1))>1800);
console.log("full-canvas images:", fullCanvas.map(o=>`${o.importNodeId} win=${o.timelineStartMs}→${o.timelineEndMs} prov=${o.imageProvenance}`));
await prisma.$disconnect();
