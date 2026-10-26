import prisma from "@/lib/prisma";
async function main() {
  const t: any = await prisma.template.findUnique({ where: { id: "2ca65f69-be04-4f80-8486-cff794ce8aa2" }, select: { name: true, data: true, canvasSize: true } });
  if (!t) { console.log("missing"); return; }
  const fd = t.data; const els = fd.objects || (fd.pages || []).flatMap((p: any) => p.elements || []);
  console.log(t.name, JSON.stringify(t.canvasSize), "els", els.length, "bg", JSON.stringify(fd.background || fd.backgroundColor || fd.pages?.[0]?.background));
  for (const e of els) console.log(JSON.stringify({ id: e.importNodeId, type: e.type, name: (e.name || e.layerName || "").slice(0, 26), x: Math.round(e.x ?? e.left), y: Math.round(e.y ?? e.top), w: Math.round(e.width * Math.abs(e.scaleX || 1)), h: Math.round(e.height * Math.abs(e.scaleY || 1)), rot: Math.round(e.rotation ?? e.angle ?? 0), op: e.opacity, flip: e.flipX || e.flipY || undefined, text: e.text ? String(e.text).replace(/\n/g, "⏎").slice(0, 50) : undefined, font: e.text ? `${e.fontFamily}|${e.fontWeight}|${Math.round(e.fontSize)}|${e.textAlign ?? e.align}|ls${Math.round((e.letterSpacing ?? e.charSpacing ?? 0) * 10) / 10}` : undefined, fill: typeof e.fill === "string" ? e.fill : undefined, spans: e.textSpans ? e.textSpans.length : undefined, frame: e.frameShape ? e.frameShape.kind : undefined, prov: e.imageProvenance, fb: e.fallbackReason || undefined, video: e.type === "video" || undefined, stroke: e.strokeWidth || undefined, radius: e.cornerRadius || undefined, curve: e.textCurveEnabled ? e.textCurveAmount : undefined }));
}
main().finally(() => prisma.$disconnect());
