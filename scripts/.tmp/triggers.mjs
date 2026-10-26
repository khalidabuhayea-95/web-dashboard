import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
console.log(await c.$queryRawUnsafe(`SELECT event_object_table, trigger_name, action_timing, event_manipulation FROM information_schema.triggers WHERE event_object_table IN ('editor_element_assets','Template')`));
await c.$disconnect();
