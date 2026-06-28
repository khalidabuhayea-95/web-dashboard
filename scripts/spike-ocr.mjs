// Run an OCR model on an image and dump the raw output structure.
//   node scripts/spike-ocr.mjs <owner/model> <imagePath> [imageFieldName]
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const API = "https://api.replicate.com/v1";
function loadToken() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN.trim();
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*REPLICATE_API_TOKEN\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, "").trim();
    }
  }
  return "";
}
const token = loadToken();
const [, , model, imagePath, fieldArg] = process.argv;
if (!token || !model || !imagePath) {
  console.error("usage: node scripts/spike-ocr.mjs <owner/model> <imagePath> [imageField]");
  process.exit(1);
}
const field = fieldArg || (model.includes("datalab") ? "file" : "image");
const bytes = await readFile(imagePath);
const dataUri = `data:image/png;base64,${bytes.toString("base64")}`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

const input = { [field]: dataUri };
if (model.includes("easyocr")) {
  input.languages = "custom";
  input.custom_languages = "ar,en";
  input.include_bboxes = true;
  input.min_confidence = 0.2;
}
if (model.includes("datalab")) {
  input.return_pages = true;
}

// Community models must run by pinned version via the global endpoint.
const modelRes = await fetch(`${API}/models/${model}`, { headers });
const modelData = await modelRes.json();
const versionId = modelData?.latest_version?.id;
console.log("version:", versionId || "(none — trying bare slug)");
const createRes = versionId
  ? await fetch(`${API}/predictions`, {
      method: "POST",
      headers: { ...headers, "Cancel-After": "5m" },
      body: JSON.stringify({ version: versionId, input }),
    })
  : await fetch(`${API}/models/${model}/predictions`, {
      method: "POST",
      headers: { ...headers, "Cancel-After": "5m" },
      body: JSON.stringify({ input }),
    });
const created = await createRes.json();
if (!createRes.ok) {
  console.error("create failed", createRes.status, JSON.stringify(created, null, 2));
  process.exit(1);
}
let pred = created;
const startedAt = Date.now();
while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
  if (Date.now() - startedAt > 180000) { console.error("timeout"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
  pred = await (await fetch(`${API}/predictions/${created.id}`, { headers })).json();
  process.stdout.write(`\r  ${pred.status}   `);
}
console.log(`\nstatus: ${pred.status} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
if (pred.status !== "succeeded") {
  console.error("error:", pred.error, "\nlogs:\n", String(pred.logs || "").slice(-1500));
  process.exit(1);
}
const { writeFile } = await import("node:fs/promises");
await writeFile(".tmp/ocr-output.json", JSON.stringify(pred.output, null, 2));
console.log("=== full output saved to .tmp/ocr-output.json ===");

// Compact, line-level summary so we can read what was actually detected.
const out = pred.output;
if (out?.pages?.[0]?.text_lines) {
  console.log("\n=== Surya text lines (bbox | text) ===");
  for (const page of out.pages) {
    for (const line of page.text_lines || []) {
      const b = line.bbox || [];
      console.log(`  [${b.map((n) => Math.round(n)).join(",")}] conf=${(line.confidence ?? 0).toFixed(2)}  "${line.text}"`);
    }
  }
} else if (out?.metadata) {
  const meta = typeof out.metadata === "string" ? JSON.parse(out.metadata) : out.metadata;
  console.log("\n=== EasyOCR regions ===");
  for (const r of meta.regions || []) {
    console.log(`  [${r.x1},${r.y1},${r.x2},${r.y2}] conf=${(r.confidence ?? 0).toFixed(2)}  "${r.text}"`);
  }
} else {
  console.log(JSON.stringify(out, null, 2).slice(0, 2000));
}
