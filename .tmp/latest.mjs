import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const ts = await prisma.template.findMany({ orderBy: { createdAt: "desc" }, take: 4, select: { id: true, createdAt: true, data: true } });
for (const t of ts) {
  const objs = (t.data||{}).objects||[];
  const build = objs.map(o=>o.extBuild).find(Boolean);
  const mp = objs.filter(o=>Array.isArray(o.mediaMotionPath)).length;
  const inout = objs.filter(o=>o.mediaAnimationMode==="IN_OUT").length;
  console.log(`${t.id.slice(0,8)} ${t.createdAt.toISOString().slice(0,16)} build=${build} objs=${objs.length} motionPath=${mp} inOut=${inout}`);
}
await prisma.$disconnect();
