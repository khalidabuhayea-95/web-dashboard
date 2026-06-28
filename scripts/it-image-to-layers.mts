// Throwaway integration test: real decompose -> R2 upload -> assemble.
//   node --env-file=.env.local --import tsx scripts/it-image-to-layers.mts [imagePath]
import { readFile } from "node:fs/promises";
import { decomposeImageToLayers } from "@/lib/media/imageToLayers/index.server";
import { assembleImageLayersTemplate } from "@/lib/media/imageToLayers/assemble.server";

const imagePath = process.argv[2] || "public/object-before.png";
const bytes = await readFile(imagePath);
console.log(`Input: ${imagePath} (${(bytes.length / 1024).toFixed(0)} KB)`);

const result = await decomposeImageToLayers({
  imageBytes: bytes,
  imageMimeType: "image/png",
  imageFileName: imagePath.split("/").pop(),
  numLayers: 4,
});

console.log(`\nDecomposed: ${result.layers.length} layers @ ${result.canvasWidth}x${result.canvasHeight} (source ${result.sourceWidth}x${result.sourceHeight})`);
for (const l of result.layers) {
  console.log(`  [${l.index}] ${l.width}x${l.height} alpha=${l.sourceHasAlpha} -> ${l.url}`);
}

const template = assembleImageLayersTemplate(result, { title: "Imported image" });
console.log(`\nAssembled project: ${template.project.layers.length} layers, bg=${JSON.stringify(template.project.background)}`);
console.log(`  layer0 type=${template.project.layers[0].type} imageUri=${template.project.layers[0].imageUri}`);
console.log(`  layer0 transform=${JSON.stringify(template.project.layers[0].transform)}`);
console.log("\n✓ end-to-end decompose -> upload -> assemble succeeded");
