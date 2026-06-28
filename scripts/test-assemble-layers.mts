// Throwaway: verify assembleImageLayersTemplate output matches the
// /api/mobile/templates/{id} shape, using fake layer URLs (no network).
//   npx tsx scripts/test-assemble-layers.mts
import { assembleImageLayersTemplate } from "@/lib/media/imageToLayers/assemble.server";

const fakeResult = {
  layers: [
    { index: 0, url: "https://cdn.example/bg.png", width: 736, height: 576, mimeType: "image/png", sourceHasAlpha: false },
    { index: 1, url: "https://cdn.example/obj-1.png", width: 736, height: 576, mimeType: "image/png", sourceHasAlpha: true },
    { index: 2, url: "https://cdn.example/obj-2.png", width: 736, height: 576, mimeType: "image/png", sourceHasAlpha: true },
  ],
  canvasWidth: 736,
  canvasHeight: 576,
  sourceWidth: 900,
  sourceHeight: 700,
  provider: "replicate",
  model: "qwen/qwen-image-layered",
  version: "",
  predictionId: "test123",
};

const template = assembleImageLayersTemplate(fakeResult as any, { title: "Imported image" });
const project = template.project;

console.log("=== top-level template keys ===");
console.log(Object.keys(template).join(", "));
console.log("\n=== project envelope ===");
console.log("canvasWidth:", project.canvasWidth, "canvasHeight:", project.canvasHeight);
console.log("background:", JSON.stringify(project.background));
console.log("layer count:", project.layers.length);
console.log("\n=== layer[0] (background image) ===");
console.log(JSON.stringify(project.layers[0], null, 2));
console.log("\n=== layer[1] (object, transform only) ===");
console.log("type:", project.layers[1].type, "zIndex:", project.layers[1].zIndex);
console.log("transform:", JSON.stringify(project.layers[1].transform));
console.log("sourceHasAlpha:", project.layers[1].sourceHasAlpha, "imageUri:", project.layers[1].imageUri);

// Sanity assertions
const errs: string[] = [];
if (project.layers.length !== 3) errs.push("expected 3 layers");
if (project.layers[0].type !== "IMAGE") errs.push("layer0 not IMAGE");
if (project.layers[0].imageUri !== "https://cdn.example/bg.png") errs.push("bg imageUri mismatch");
if (project.layers[1].zIndex !== 1) errs.push("zIndex not preserved");
const t = project.layers[0].transform;
if (Math.round(t.x) !== 368 || Math.round(t.y) !== 288) errs.push(`center wrong: ${t.x},${t.y}`);
console.log("\n=== assertions ===");
console.log(errs.length ? "FAIL: " + errs.join("; ") : "✓ all assertions passed");
