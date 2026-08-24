#!/usr/bin/env node
// Batch-render the AI Tools seed catalog into before/after card art.
//
// This is an authoring tool, not a product route: it talks to Replicate directly so
// it needs no dev server, no bearer token and no credit metering. Feed it a folder of
// your OWN licensed reference photos — one per reference kind — and it renders every
// matching preset, writes the paired card art, and emits a catalog.json ready to
// import into the AiTemplate table (see scripts/seed-ai-templates.mjs).
//
//   node scripts/render-ai-templates.mjs --refs ./refs --out ./out --dry-run
//   node scripts/render-ai-templates.mjs --refs ./refs --out ./out --category ai-styles
//   node scripts/render-ai-templates.mjs --refs ./refs --out ./out --only style-anime-cel
//
// Reference folder must contain a file named after each kind it needs to cover, e.g.
//   refs/portrait.jpg  refs/product.jpg  refs/food.jpg
//   refs/apparel.jpg   refs/damaged.jpg  refs/crowded.jpg

import fs from "node:fs";
import path from "node:path";
import { PRESETS, REFERENCE_KINDS } from "./ai-templates/presets.mjs";
import {
  AI_TEMPLATE_MODEL_IDS,
  DEFAULT_AI_TEMPLATE_MODEL_ID,
  aiTemplateModelIncompatibility,
  buildAiTemplateModelInput,
  getAiTemplateModelDefinition,
} from "../src/lib/aiTemplates/models.js";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 240000;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function parseArgs(argv) {
  const args = { concurrency: 3, model: DEFAULT_AI_TEMPLATE_MODEL_ID };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (name === "dry-run") {
      args.dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    // A flag with no value (or followed by another flag) is a boolean switch —
    // without this, a trailing "--overwrite" was silently dropped.
    if (value === undefined || value.startsWith("--")) {
      args[name] = true;
      continue;
    }
    args[name] = name === "concurrency" ? Number(value) : value;
    i += 1;
  }
  return args;
}

function usage() {
  console.error(
    [
      "Usage: node scripts/render-ai-templates.mjs --refs <dir> --out <dir> [options]",
      "",
      "  --refs <dir>          folder of reference photos, one per kind",
      "  --out <dir>           where card art and catalog.json are written",
      "  --only <slug>         render a single preset",
      "  --category <slug>     render one category only",
      `  --model <id>          one of: ${AI_TEMPLATE_MODEL_IDS.join(", ")}`,
      `                        (default ${DEFAULT_AI_TEMPLATE_MODEL_ID})`,
      "  --concurrency <n>     parallel renders (default 3)",
      "  --overwrite           re-render presets that already have an after image",
      "  --dry-run             print the payloads, call nothing, spend nothing",
      "",
      `Reference kinds: ${REFERENCE_KINDS.join(", ")}`,
    ].join("\n")
  );
}

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  return content.split("\n").reduce((acc, line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) return acc;
    acc[match[1]] = match[2].trim();
    return acc;
  }, {});
}

// A kind may have several sample photos so the finished cards do not all show
// the same face. Variants are files named "<kind>__<tag>.<ext>"; a plain
// "<kind>.<ext>" still works as the single-photo case.
function referenceVariants(refsDir, kind) {
  return fs
    .readdirSync(refsDir)
    .filter((file) => {
      const base = path.basename(file, path.extname(file));
      return (
        IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()) &&
        (base === kind || base.startsWith(`${kind}__`))
      );
    })
    .sort()
    .map((file) => path.join(refsDir, file));
}

// Curated pick first: a preset may name its exact variant via referenceTag
// ("<kind>__<tag>"). Otherwise fall back to the deterministic hash pick, so
// the same preset always draws the same variant across re-renders.
function findReference(refsDir, kind, seedText = "", referenceTag = "") {
  if (referenceTag) {
    for (const extension of IMAGE_EXTENSIONS) {
      const candidate = path.join(refsDir, `${kind}__${referenceTag}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
    // A named tag that is missing is an authoring mistake — fail loudly rather
    // than silently rendering with a random substitute.
    throw new Error(`Reference "${kind}__${referenceTag}" not found in ${refsDir}`);
  }
  const variants = referenceVariants(refsDir, kind);
  if (!variants.length) return null;
  let hash = 0;
  for (const character of seedText) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return variants[hash % variants.length];
}

// The library keeps runtime variables in square brackets (the PDF's convention),
// e.g. "[COUNTRY] flag colors" — the app substitutes them per user. Models fail
// on the literal bracket, so sample art renders with a representative value.
const SAMPLE_VARIABLES = {
  // Spelled out so the model renders the right flag — a bare demonym let it
  // default to whatever flag it liked (US/Canada turned up in the first pass).
  "[COUNTRY]": "Saudi Arabian (green flag with white Arabic script and a sword)",
};

function resolveVariables(prompt) {
  let out = prompt;
  for (const [token, value] of Object.entries(SAMPLE_VARIABLES)) {
    out = out.split(token).join(value);
  }
  return out;
}

function toDataUri(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function replicateRequest(pathname, token, init = {}) {
  // Accounts with a low balance are throttled to 6 predictions/minute (burst 1),
  // so a batch render must absorb 429s rather than fail the preset.
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${REPLICATE_API_BASE}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (response.status === 429 && attempt < 8) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.title || `Replicate request failed (${response.status}).`);
    }
    return payload;
  }
}

async function waitForPrediction(prediction, token) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = prediction;
  while (current.status !== "succeeded") {
    if (current.status === "failed" || current.status === "canceled") {
      throw new Error(current.error || `Prediction ${current.status}.`);
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the prediction.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await replicateRequest(`/predictions/${current.id}`, token);
  }
  return current;
}

function resolveOutputUrl(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  throw new Error("Prediction succeeded but returned no image URL.");
}

async function renderPreset(preset, context) {
  const { token, refsDir, outDir, dryRun } = context;

  // A preset may pin its own model (e.g. baked Arabic calligraphy needs
  // nano-banana-pro); an explicit --model on the command line overrides that
  // for whole-run experiments, otherwise the CLI model is just the fallback.
  const modelId = context.forcedModelId || preset.model || context.defaultModelId;
  const definition = getAiTemplateModelDefinition(modelId);
  if (!definition) {
    throw new Error(`Unsupported model "${modelId}" on ${preset.slug}.`);
  }

  const incompatibility = aiTemplateModelIncompatibility(modelId, preset.reference);
  if (incompatibility) throw new Error(incompatibility);

  const generateOnly = preset.reference === "none";
  const referencePath = generateOnly
    ? null
    : findReference(refsDir, preset.reference, preset.slug, preset.referenceTag || "");
  if (!generateOnly && !referencePath) {
    throw new Error(`No reference image for kind "${preset.reference}" in ${refsDir}`);
  }

  if (dryRun) {
    console.log(`\n· ${preset.slug}  [${preset.category}]  ${modelId}`);
    console.log(`  reference: ${referencePath ? path.basename(referencePath) : "(text-to-image)"}`);
    console.log(`  ${preset.prompt.slice(0, 150)}${preset.prompt.length > 150 ? "…" : ""}`);
    return { ...preset, skipped: true };
  }

  const input = buildAiTemplateModelInput(
    definition,
    resolveVariables(preset.prompt),
    referencePath ? toDataUri(referencePath) : null
  );
  const created = await replicateRequest(`/models/${modelId}/predictions`, token, {
    method: "POST",
    headers: { prefer: "wait" },
    body: JSON.stringify({ input }),
  });
  const finished = await waitForPrediction(created, token);

  const imageResponse = await fetch(resolveOutputUrl(finished.output));
  if (!imageResponse.ok) {
    throw new Error(`Could not download the rendered image (${imageResponse.status}).`);
  }

  const afterPath = path.join(outDir, `${preset.slug}.after.png`);
  fs.writeFileSync(afterPath, Buffer.from(await imageResponse.arrayBuffer()));

  let beforePath = null;
  if (referencePath) {
    beforePath = path.join(outDir, `${preset.slug}.before${path.extname(referencePath)}`);
    fs.copyFileSync(referencePath, beforePath);
  }

  console.log(`  rendered ${preset.slug} → ${path.basename(afterPath)}`);
  return {
    slug: preset.slug,
    category: preset.category,
    titleEn: preset.titleEn,
    titleAr: preset.titleAr,
    model: modelId,
    prompt: preset.prompt,
    creditCost: preset.creditCost,
    isPremium: preset.isPremium,
    beforeFile: beforePath ? path.basename(beforePath) : null,
    afterFile: path.basename(afterPath),
    predictionId: finished.id,
  };
}

async function runPool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index]) };
      } catch (error) {
        results[index] = { ok: false, slug: items[index].slug, error: error.message };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.refs || !args.out) {
    usage();
    process.exit(1);
  }

  const refsDir = path.resolve(process.cwd(), args.refs);
  const outDir = path.resolve(process.cwd(), args.out);
  if (!fs.existsSync(refsDir)) {
    throw new Error(`Reference folder not found: ${refsDir}`);
  }

  const definition = getAiTemplateModelDefinition(args.model);
  if (!definition) {
    throw new Error(
      `Unsupported model "${args.model}". Known: ${AI_TEMPLATE_MODEL_IDS.join(", ")}`
    );
  }

  let selected = PRESETS;
  if (args.category) selected = selected.filter((preset) => preset.category === args.category);
  if (args.only) {
    const wanted = new Set(String(args.only).split(",").map((slug) => slug.trim()));
    selected = selected.filter((preset) => wanted.has(preset.slug));
  }
  if (!selected.length) {
    throw new Error("No presets matched that filter.");
  }

  // Renders cost money, so a bulk run resumes rather than repeating work: skip
  // anything that already has an after image. Naming a single preset with
  // --only is an explicit request to redo it, so that always re-renders.
  if (!args.overwrite && !args.only && !args.dryRun) {
    const before = selected.length;
    selected = selected.filter(
      (preset) => !fs.existsSync(path.join(outDir, `${preset.slug}.after.png`))
    );
    const skipped = before - selected.length;
    if (skipped) console.log(`Skipping ${skipped} preset(s) already rendered (--overwrite to redo).`);
    if (!selected.length) {
      console.log("Everything in that selection is already rendered.");
      return;
    }
  }

  const env = loadLocalEnv();
  const token = process.env.REPLICATE_API_TOKEN || env.REPLICATE_API_TOKEN;
  if (!token && !args.dryRun) {
    throw new Error("REPLICATE_API_TOKEN is not set in the environment or .env.local.");
  }

  if (!args.dryRun) fs.mkdirSync(outDir, { recursive: true });

  console.log(
    `${args.dryRun ? "Dry run:" : "Rendering"} ${selected.length} preset(s) on ${args.model}` +
      `${args.dryRun ? "" : ` at concurrency ${args.concurrency}`}`
  );

  const modelForced = process.argv.includes("--model");
  const results = await runPool(selected, args.concurrency, (preset) =>
    renderPreset(preset, {
      token,
      forcedModelId: modelForced ? args.model : null,
      defaultModelId: args.model,
      refsDir,
      outDir,
      dryRun: args.dryRun,
    })
  );

  const failures = results.filter((result) => !result.ok);
  const catalog = results.filter((result) => result.ok && !result.value.skipped).map((result) => result.value);

  if (catalog.length) {
    const catalogPath = path.join(outDir, "catalog.json");
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`\nWrote ${catalog.length} entries to ${catalogPath}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} preset(s) failed:`);
    for (const failure of failures) console.error(`  ${failure.slug}: ${failure.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
