import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT data FROM "Template" WHERE id = '3ab7d0ac-a7d4-4897-a8a0-4894815d5c29'`;
const meta = rows[0].data?.meta?.import || {};
console.log("warnings:", JSON.stringify(meta.warnings || []));
console.log("recovery:", JSON.stringify(meta.recovery || meta.recovered || null));
const lt = meta.layerTree || [];
for (const l of lt) if (/LB2Ml4XWcqf6Xmbs|LBhdsLxryGdmrFP8/.test(l.id||"")) console.log("layerTree:", JSON.stringify(l).slice(0,300));
await prisma.$disconnect();
