import prisma from "@/lib/prisma";
import fs from "node:fs";
const ID = "2ca65f69-be04-4f80-8486-cff794ce8aa2";
// Canva DAHNZYYmqNA, measured on the editing copy (design px): font = CSS size × inner text scale,
// box = the design model's frame. The import read the animation player's copy (zoom 0.267708
// inside every element, Breathe frame at ×1.061).
const CANVA: Record<string, { font?: number; left: number; top: number; width: number; height: number }> = {
  LB3Bl8pdHGKrPg7r: { left: 747.4325479791576, top: 535.0774996637479, width: 864, height: 843.48 },
  LBf3B5ZrsdJ4jN6S: { left: -524.6295788566306, top: 538.26, width: 864, height: 843.48 },
  LB93t7VxhpzyQzqP: { font: 136 / 3, left: 237.55206298828125, top: 354.7872103254558, width: 604.8958740234375, height: 53.93334 },
  LBkVDwHKWxHnbT4b: { font: 125.9654, left: 249.04788472449286, top: 432.47776132341585, width: 581.9042305510143, height: 150.48223867658433 },
  LBFTwTBj3NbDNypp: { font: 171.9608, left: 483.16819328857514, top: 831.5774911603282, width: 215.45610687022852, height: 206.19938229537686 },
  LBkXWyzrwbRQ3BFJ: { font: 212.7074, left: 453.5732141572857, top: 703.96, width: 114.24708572789253, height: 255.2349823206564 },
  LBDXcV50Wsh9fsnH: { font: 136 / 3, left: 448.089, top: 1058.777, width: 239.464, height: 53.933 },
  LBS2drPCWMMY16rX: { font: 136 / 3, left: 219.003, top: 1239.317, width: 641.993, height: 116.933 },
  LB1MCv163J5JDmxN: { font: 136 / 3, left: 200.455, top: 1695.067, width: 641.993, height: 53.933 },
  LBP306Kjry0XFPC6: { font: 85.6807, left: 309.081, top: 1405.74, width: 461.839, height: 101.864 },
};
async function main() {
  const t: any = await prisma.template.findUnique({ where: { id: ID } });
  fs.writeFileSync(`tmp/template-2ca65f69-backup-${Date.now()}.json`, JSON.stringify(t, null, 2));
  const data = JSON.parse(JSON.stringify(t.data));
  const tree = new Map<string, any>((data.meta?.import?.layerTree || []).map((n: any) => [n.id, n]));
  let texts = 0;
  let images = 0;
  for (const o of data.objects) {
    const want = CANVA[String(o.importNodeId || "")];
    if (!want) continue;
    if (o.type === "textbox") {
      const layer = tree.get(o.importNodeId);
      const importZoom = Number(o.fontSize) / want.font!;
      // background.js: left = x − 1, width = round(w) + 2, top = y + glyph nudge (read in the
      // player's screen px, so it carried the zoom too).
      const nudge = (Number(o.top) - Number(layer.bounds.y)) / importZoom;
      o.fontSize = Math.round(want.font! * 1e4) / 1e4;
      o.left = want.left - 1;
      o.top = want.top + nudge;
      o.width = Math.round(want.width) + 2;
      o.height = Math.round(want.height);
      texts += 1;
      console.log(o.importNodeId, "font", o.fontSize, "nudge", nudge.toFixed(2), "box", [o.left, o.top, o.width, o.height].map((v: number) => Math.round(v * 100) / 100).join(","));
    } else if (o.type === "image") {
      o.left = want.left;
      o.top = want.top;
      o.scaleX = want.width / Number(o.width);
      o.scaleY = want.height / Number(o.height);
      images += 1;
      console.log(o.importNodeId, "image", o.left, o.top, o.scaleX, o.scaleY);
    }
  }
  await prisma.template.update({ where: { id: ID }, data: { data } });
  const after = await prisma.template.findUnique({ where: { id: ID }, select: { updatedAt: true } });
  console.log("texts", texts, "images", images, "updatedAt", after!.updatedAt.toISOString());
}
main().finally(() => prisma.$disconnect());
