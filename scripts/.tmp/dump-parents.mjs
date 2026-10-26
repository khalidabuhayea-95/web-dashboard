import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT data FROM "Template" WHERE id = $1::uuid`, process.argv[2]);
const objs = rows[0].data.objects;
for (const [i, o] of objs.entries()) console.log(i, o.type, o.importNodeId, "parent=", o.importParentId, o.layerName || (o.text||"").slice(0,20), `${o.timelineStartMs}-${o.timelineEndMs}`, "fallback=", o.fallback, o.fallbackReason||"");
await c.$disconnect();
