import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT data FROM "Template" WHERE id = '2ab2cd50-5cc1-4273-8656-e10195fd6012'`;
const objs = rows[0].data.objects;
console.log(JSON.stringify({p2: objs[2].src, p3: objs[3].src, meta2: {prov: objs[2].imageProvenance, lossy: objs[2].snapshotIsLossyFallback}, meta3: {prov: objs[3].imageProvenance, lossy: objs[3].snapshotIsLossyFallback}}));
await prisma.$disconnect();
