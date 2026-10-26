import prisma from "@/lib/prisma";
import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

async function main() {
  const t = await prisma.template.findUnique({ where: { id: "2c835def-3e38-4668-8f9e-fc4949d76a19" } });
  if (!t) throw new Error("missing");
  const detail = toMobileTemplateDetailSlim(t as never, {}) as { project: { layers: Array<Record<string, unknown>> } };
  const withPath = detail.project.layers.filter((layer) => Array.isArray(layer.motionPath));
  console.log("layers", detail.project.layers.length, "with motionPath", withPath.length);
  for (const layer of withPath) {
    const path = layer.motionPath as Array<{ t: number; x: number; y: number }>;
    const transform = layer.transform as Record<string, number>;
    console.log(layer.type, layer.id, "points", path.length, "first", JSON.stringify(path[0]), "last", JSON.stringify(path[path.length - 1]), "centre", transform.x, transform.y, "flipX", transform.flipX, "window", layer.timelineStartMs, layer.timelineEndMs);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
