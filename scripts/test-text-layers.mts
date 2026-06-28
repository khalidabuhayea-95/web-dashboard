// Verify OCR blocks -> Fabric text objects -> mobile TEXT layers, using the
// real saved Surya output + synthetic image. No network.
//   npx tsx scripts/test-text-layers.mts
import { readFile } from "node:fs/promises";
import { buildTextLayerObjects } from "@/lib/media/imageToLayers/text.server";
import { assembleImageLayers } from "@/lib/media/imageToLayers/assemble.server";

const ocr = JSON.parse(await readFile(".tmp/ocr-output.json", "utf8"));
const blocks = (ocr.pages?.[0]?.text_lines || [])
  .filter((l: any) => l.text && Array.isArray(l.bbox))
  .map((l: any) => ({
    text: l.text,
    x1: l.bbox[0], y1: l.bbox[1], x2: l.bbox[2], y2: l.bbox[3],
    confidence: l.confidence || 0,
  }));
console.log(`OCR blocks: ${blocks.length}`);

const imageBytes = await readFile(".tmp/test-design.png");
const textObjects = await buildTextLayerObjects({
  blocks,
  imageBytes,
  imageMimeType: "image/png",
  ocrWidth: 1080,
  ocrHeight: 1080,
  canvasWidth: 1080,
  canvasHeight: 1080,
});

const fakeResult = {
  layers: [{ index: 0, url: "https://cdn.example/bg.png", width: 1080, height: 1080, mimeType: "image/png", sourceHasAlpha: false }],
  canvasWidth: 1080, canvasHeight: 1080, sourceWidth: 1080, sourceHeight: 1080,
  provider: "replicate", model: "qwen/qwen-image-layered", version: "", predictionId: "t",
};
const { layers } = assembleImageLayers(fakeResult as any, { textObjects });

console.log(`\nproject layers: ${layers.length} (1 image + ${textObjects.length} text)`);
for (const l of layers.filter((x: any) => x.type === "TEXT")) {
  console.log(`  TEXT "${l.text}"  rtl=${l.isRtl} align=${l.alignment} color=${l.colorHex} size=${l.size}  center=(${Math.round(l.transform.x)},${Math.round(l.transform.y)})`);
}

const errs: string[] = [];
const texts = layers.filter((x: any) => x.type === "TEXT");
if (texts.length !== blocks.length) errs.push(`expected ${blocks.length} text layers, got ${texts.length}`);
const arabic = texts.find((t: any) => /[؀-ۿ]/.test(t.text));
if (!arabic) errs.push("Arabic text layer missing");
else if (!arabic.isRtl || arabic.alignment !== "END") errs.push("Arabic not flagged RTL/END");
if (layers[0].type !== "IMAGE") errs.push("background not first");
console.log("\n" + (errs.length ? "FAIL: " + errs.join("; ") : "✓ all assertions passed"));
