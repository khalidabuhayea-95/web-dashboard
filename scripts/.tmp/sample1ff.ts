import prisma from "@/lib/prisma";
import { resolveTimelinePlaybackState } from "@/lib/editor/animationSlots";
import { resolvePlaybackVisualState } from "@/lib/editor/animationVisual";
const ID = "1ff79028-26d9-49b8-8e60-ce0160c624b4";
async function main() {
  const t: any = await prisma.template.findUnique({ where: { id: ID } });
  const pick = ["LB3gDb1vpxn7CtM2", "LBntHjhwPnWSYGmD", "LBpgtkT84jrMfvLp", "LBWKdKc7lRh147Q1"];
  for (const id of pick) {
    const o = t.data.objects.find((x: any) => x.importNodeId === id);
    const w = Number(o.width) * Number(o.scaleX || 1);
    const h = Number(o.height) * Number(o.scaleY || 1);
    const row = [0, 160, 240, 320, 400, 481, 3000, 14900].map((ms) => {
      const pb = resolveTimelinePlaybackState(false, o.timelineStartMs ?? 0, o.timelineEndMs ?? 15000, o.animations, ms, 15000);
      const v = resolvePlaybackVisualState(pb, w, h);
      return `${ms}ms:${pb.isVisible ? `a${v.alphaMultiplier.toFixed(2)} s${v.scaleMultiplier.toFixed(3)} y${v.translationY.toFixed(1)} x${v.translationX.toFixed(1)}` : "hidden"}`;
    });
    console.log(id.slice(0, 8), row.join(" | "));
  }
}
main().finally(() => prisma.$disconnect());
