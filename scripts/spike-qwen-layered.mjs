// Throwaway spike: explore qwen/qwen-image-layered on Replicate.
//   node scripts/spike-qwen-layered.mjs schema
//   node scripts/spike-qwen-layered.mjs run <imagePath> [numLayers]
// Reads REPLICATE_API_TOKEN from env or .env.local. Never prints the token.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const MODEL = "qwen/qwen-image-layered";
const API = "https://api.replicate.com/v1";

function loadToken() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN.trim();
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    const txt = readFileSync(f, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*REPLICATE_API_TOKEN\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, "").trim();
    }
  }
  return "";
}

const token = loadToken();
if (!token) {
  console.error("No REPLICATE_API_TOKEN found in env or .env.local");
  process.exit(1);
}

const authHeaders = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function getSchema() {
  const res = await fetch(`${API}/models/${MODEL}`, { headers: authHeaders });
  if (!res.ok) {
    console.error("model fetch failed", res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  console.log("=== MODEL:", data.name, "===");
  console.log("description:", data.description);
  console.log("model top-level keys:", Object.keys(data).join(", "));
  console.log("default_example present:", Boolean(data.default_example));

  const v = data.latest_version || {};
  console.log("latest_version keys:", Object.keys(v).join(", "));
  console.log("latest_version.id:", v.id);
  const schema = v?.openapi_schema?.components?.schemas || {};
  console.log("\n=== INPUT schema ===");
  console.log(JSON.stringify(schema.Input ?? "(none)", null, 2));
  console.log("\n=== OUTPUT schema ===");
  console.log(JSON.stringify(schema.Output ?? "(none)", null, 2));

  console.log("\n=== DEFAULT EXAMPLE (real run input/output) ===");
  const ex = data.default_example || {};
  console.log("example input:", JSON.stringify(ex.input, null, 2));
  console.log("example output:", JSON.stringify(ex.output, null, 2));
}

function mimeFor(p) {
  const e = p.toLowerCase().split(".").pop();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  return "application/octet-stream";
}

async function run(imagePath, numLayers) {
  const bytes = await readFile(imagePath);
  const dataUri = `data:${mimeFor(imagePath)};base64,${bytes.toString("base64")}`;
  console.log(`Input: ${imagePath} (${(bytes.length / 1024).toFixed(0)} KB)`);

  // Discover the real input field name from schema, fall back to "image".
  const res = await fetch(`${API}/models/${MODEL}`, { headers: authHeaders });
  const data = await res.json();
  const props = data?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {};
  const keys = Object.keys(props);
  console.log("input fields:", keys.join(", ") || "(unknown)");
  const imageKey = keys.find((k) => /image|img/i.test(k)) || "image";
  const layersKey = keys.find((k) => /layer|num|count/i.test(k));

  const input = { [imageKey]: dataUri, output_format: "png", go_fast: true, description: "auto" };
  input[layersKey || "num_layers"] = Number(numLayers) || 4;
  console.log("input keys sent:", Object.keys(input).join(", "), "| num_layers:", input[layersKey || "num_layers"]);

  const createRes = await fetch(`${API}/models/${MODEL}/predictions`, {
    method: "POST",
    headers: { ...authHeaders, "Cancel-After": "5m" },
    body: JSON.stringify({ input }),
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    console.error("create failed", createRes.status, JSON.stringify(created, null, 2));
    process.exit(1);
  }
  console.log("prediction id:", created.id, "status:", created.status);

  let pred = created;
  const startedAt = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() - startedAt > 240_000) {
      console.error("timeout");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
    const pr = await fetch(`${API}/predictions/${created.id}`, { headers: authHeaders });
    pred = await pr.json();
    process.stdout.write(`\r  status: ${pred.status}   `);
  }
  console.log("\nfinal status:", pred.status, `(${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  if (pred.status !== "succeeded") {
    console.error("error:", pred.error);
    console.error("logs:\n", pred.logs);
    process.exit(1);
  }

  console.log("\n=== RAW OUTPUT shape ===");
  console.log(JSON.stringify(pred.output, null, 2).slice(0, 2000));

  // Normalize output to a list of URLs.
  const urls = [];
  const collect = (v) => {
    if (!v) return;
    if (typeof v === "string") urls.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === "object") {
      if (typeof v.url === "string") urls.push(v.url);
      else Object.values(v).forEach(collect);
    }
  };
  collect(pred.output);
  console.log(`\n=== ${urls.length} output URL(s) ===`);
  urls.forEach((u, i) => console.log(`  [${i}] ${u}`));

  const outDir = ".tmp/qwen-spike";
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(urls[i]);
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (r.headers.get("content-type") || "").includes("png") ? "png" : "img";
    const fp = path.join(outDir, `layer-${String(i).padStart(2, "0")}.${ext}`);
    await writeFile(fp, buf);
    console.log(`  saved ${fp} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nDone. Layers in ${outDir}/  | metrics: predict_time=${pred.metrics?.predict_time}s`);
}

const [, , mode, arg1, arg2] = process.argv;
if (mode === "schema") await getSchema();
else if (mode === "run" && arg1) await run(arg1, arg2);
else {
  console.log("usage:\n  node scripts/spike-qwen-layered.mjs schema\n  node scripts/spike-qwen-layered.mjs run <imagePath> [numLayers]");
}
