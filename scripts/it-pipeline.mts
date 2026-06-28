// Full pipeline integration test: real OCR -> LaMa text-removal -> Qwen
// decompose -> assemble. Hits Replicate + R2.
//   node --env-file=.env.local --import tsx scripts/it-pipeline.mts [imagePath]
import { readFile } from "node:fs/promises";
import { imageToEditableLayers } from "@/lib/media/imageToLayers/pipeline.server";

const imagePath = process.argv[2] || ".tmp/test-design.png";
const bytes = await readFile(imagePath);
console.log(`Input: ${imagePath} (${(bytes.length / 1024).toFixed(0)} KB)`);
const t0 = Date.now();

const { canvasWidth, canvasHeight, layers, meta } = await imageToEditableLayers({
  imageBytes: bytes,
  imageMimeType: "image/png",
  imageFileName: imagePath.split("/").pop(),
  includeText: true,
});

console.log(`\n=== meta (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
console.log(JSON.stringify(meta, null, 2));

console.log(`\n=== ${layers.length} layers @ ${canvasWidth}x${canvasHeight} ===`);
for (const l of layers) {
  if (l.type === "TEXT") {
    console.log(`  [${l.zIndex}] TEXT "${l.text}" rtl=${l.isRtl} align=${l.alignment} color=${l.colorHex} center=(${Math.round(l.transform.x)},${Math.round(l.transform.y)})`);
  } else {
    console.log(`  [${l.zIndex}] ${l.type} alpha=${l.sourceHasAlpha} ${l.imageUri}`);
  }
}
console.log("\n✓ full pipeline succeeded");
