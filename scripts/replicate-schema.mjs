// Inspect any Replicate model's input schema + default example.
//   node scripts/replicate-schema.mjs <owner/model>
import { existsSync, readFileSync } from "node:fs";

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
const model = process.argv[2];
if (!token || !model) {
  console.error("need token + <owner/model>");
  process.exit(1);
}
const res = await fetch(`${API}/models/${model}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
if (!res.ok) {
  console.error(model, "->", res.status, await res.text());
  process.exit(1);
}
const data = await res.json();
console.log(`=== ${model} ===`);
console.log("desc:", data.description);
console.log("run_count:", data.run_count);
const props = data?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties;
console.log("INPUT props:", props ? Object.keys(props).join(", ") : "(none in latest_version)");
if (props) {
  for (const [k, v] of Object.entries(props)) {
    console.log(`  - ${k}: ${v.type || v.allOf ? (v.type || "enum/ref") : "?"}${v.default !== undefined ? ` (default ${JSON.stringify(v.default)})` : ""}${v.description ? " — " + String(v.description).slice(0, 70) : ""}`);
  }
}
console.log("default_example input:", JSON.stringify(data?.default_example?.input || "(none)", null, 2));
const out = data?.default_example?.output;
console.log("default_example output (truncated):", JSON.stringify(out, null, 2)?.slice(0, 900));
