import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const rows = await c.$queryRawUnsafe(`SELECT data FROM "Template" WHERE id = $1::uuid`, process.argv[2]);
for (const o of rows[0].data.objects) {
  const hasAnim = Boolean(o.animations && (o.animations.entrance || o.animations.exit || o.animations.loop));
  const path = Array.isArray(o.mediaMotionPath) ? o.mediaMotionPath.length : 0;
  if (o.canvaAnimationPreset != null || o.canvaPageAnimationPreset != null || hasAnim || path)
    console.log(o.importNodeId, (o.layerName || "").slice(0, 26), "preset=", o.canvaAnimationPreset ?? o.canvaPageAnimationPreset, "anim=", hasAnim ? [o.animations.entrance?.type, o.animations.exit?.type].join("/") : "-", "path=", path, (o.canvaAnimationPreset != null && !hasAnim && !path) ? "  <-- DROPPED" : "");
}
await c.$disconnect();
