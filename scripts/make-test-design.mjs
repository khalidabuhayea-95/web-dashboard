// Generate a synthetic flat "design" with Arabic + English text + a shape,
// so the image->layers text pipeline can be exercised without a real sample.
//   node scripts/make-test-design.mjs
import { writeFile, mkdir } from "node:fs/promises";

const { createCanvas } = await import("canvas");
const W = 1080;
const H = 1080;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// Background
const grad = ctx.createLinearGradient(0, 0, W, H);
grad.addColorStop(0, "#0f766e");
grad.addColorStop(1, "#115e59");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, W, H);

// A decorative circle (an "object")
ctx.fillStyle = "#fbbf24";
ctx.beginPath();
ctx.arc(W / 2, 430, 220, 0, Math.PI * 2);
ctx.fill();

// English headline
ctx.fillStyle = "#ffffff";
ctx.textAlign = "center";
ctx.font = "bold 130px sans-serif";
ctx.fillText("SUMMER SALE", W / 2, 800);

// Discount
ctx.fillStyle = "#fde68a";
ctx.font = "bold 96px sans-serif";
ctx.fillText("50% OFF", W / 2, 920);

// Arabic line (shaping depends on installed fonts; fine for a smoke test)
ctx.fillStyle = "#ffffff";
ctx.font = "bold 90px sans-serif";
ctx.fillText("تخفيضات الصيف", W / 2, 1010);

await mkdir(".tmp", { recursive: true });
const out = ".tmp/test-design.png";
await writeFile(out, canvas.toBuffer("image/png"));
console.log("wrote", out, `${W}x${H}`);
