#!/usr/bin/env node
// Renders the before/after card art for the Magic Tools catalog.
//
//   node scripts/render-magic-tools.mjs --refs <dir> --out <dir> [--only a,b] [--overwrite]
//
// Runs each tool exactly the way production does — same registry, same input
// builder, same per-tool modelOptions — so a card can never advertise
// behaviour the app does not reproduce.
//
// Repair tools (enhance, unblur, colorize, relight) need a BAD before or the
// card shows nothing. Those presets declare `sample.degrade`, and the damage is
// applied to the reference photo BEFORE the tool runs: the after is the model's
// genuine output on the degraded image, so the pair stays honest.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { PRESETS } from "./magic-tools/presets.mjs";
import {
  buildMagicToolModelInput,
  getMagicToolModelDefinition,
} from "../src/lib/magicTools/models.js";
import { removeBackground } from "../src/lib/media/backgroundRemoval/index.server.js";
import { removeRasterBackgroundWithRembg } from "../src/lib/media/backgroundRemoval/providers/rembg.server.js";
import {
  createPrediction,
  downloadPredictionOutput,
  waitForPrediction,
} from "../src/lib/magicTools/predict.js";

const TEXT_TO_IMAGE_MODEL = "google/nano-banana";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[name] = true;
      continue;
    }
    args[name] = value;
    i += 1;
  }
  return args;
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function downloadOutput(prediction) {
  return (await downloadPredictionOutput(prediction)).buffer;
}

// Synthetic damage, so a repair tool has something real to repair.
async function degrade(buffer, kind) {
  if (!kind) return buffer;
  const image = sharp(buffer);
  if (kind === "grayscale") return image.greyscale().jpeg({ quality: 88 }).toBuffer();
  if (kind === "dark") {
    // Hard underexposure — a phone photo taken against the light. Mild damage
    // produces a card whose before and after look the same at thumbnail size.
    return image.linear(0.26, -22).modulate({ saturation: 0.6 }).jpeg({ quality: 80 }).toBuffer();
  }
  // "soft" and "blur" both simulate a small, over-compressed source; blur adds
  // camera shake on top.
  const width = kind === "blur" ? 300 : 420;
  let small = sharp(await image.resize(width).jpeg({ quality: 30 }).toBuffer());
  if (kind === "blur") small = small.blur(1.6);
  return small.resize(1024, null, { kernel: "cubic" }).jpeg({ quality: 78 }).toBuffer();
}

async function buildBefore(preset, { refsDir, outDir, token }) {
  const sample = preset.sample || {};

  let source;
  if (sample.generate) {
    // Generated befores are cached: they cost a prediction and never change.
    const cacheDir = path.join(outDir, "_generated");
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${preset.slug}.jpg`);
    if (fs.existsSync(cachePath)) {
      source = fs.readFileSync(cachePath);
    } else {
      const created = await createPrediction(
        TEXT_TO_IMAGE_MODEL,
        { prompt: sample.generate, output_format: "png", aspect_ratio: "3:4" },
        token
      );
      source = await downloadOutput(await waitForPrediction(created, token));
      fs.writeFileSync(cachePath, await sharp(source).jpeg({ quality: 92 }).toBuffer());
    }
  } else {
    const refPath = path.join(refsDir, sample.ref || "");
    if (!fs.existsSync(refPath)) throw new Error(`Reference not found: ${refPath}`);
    source = fs.readFileSync(refPath);
  }

  const normalized = await sharp(source)
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return degrade(normalized, sample.degrade);
}

async function runTool(preset, beforeBuffer, token) {
  const definition = getMagicToolModelDefinition(preset.model);
  if (!definition) throw new Error(`Unsupported model "${preset.model}".`);

  if (definition.provider === "local") {
    // Same engine order as src/lib/magicTools/run.server.js: rembg first, flood
    // fill only if the Python bridge is missing. A card rendered by the weaker
    // engine would promise something the app does not deliver.
    const args = { bytes: beforeBuffer, mimeType: "image/jpeg", fileName: `${preset.slug}.jpg` };
    let result;
    try {
      result = await removeRasterBackgroundWithRembg(args);
    } catch (_error) {
      result = await removeBackground(args);
    }
    return Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes || []);
  }

  const dataUri = `data:image/jpeg;base64,${beforeBuffer.toString("base64")}`;
  const input = buildMagicToolModelInput(definition, preset.prompt, dataUri, preset.modelOptions);
  const created = await createPrediction(definition.id, input, token);
  return downloadOutput(await waitForPrediction(created, token));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refsDir = path.resolve(process.cwd(), args.refs || "");
  const outDir = path.resolve(process.cwd(), args.out || "");
  if (!args.refs || !args.out) {
    console.error("Usage: --refs <dir> --out <dir> [--only slug,slug] [--overwrite]");
    process.exit(1);
  }
  if (!fs.existsSync(refsDir)) throw new Error(`Reference folder not found: ${refsDir}`);
  fs.mkdirSync(outDir, { recursive: true });

  const token = process.env.REPLICATE_API_TOKEN || loadLocalEnv().REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set.");

  let selected = PRESETS;
  if (args.only) {
    const wanted = new Set(String(args.only).split(",").map((slug) => slug.trim()));
    selected = selected.filter((preset) => wanted.has(preset.slug));
  }
  if (!args.overwrite && !args.only) {
    selected = selected.filter(
      (preset) => !fs.existsSync(path.join(outDir, `${preset.slug}.after.png`))
    );
  }
  if (!selected.length) {
    console.log("Nothing to render.");
    return;
  }

  console.log(`Rendering ${selected.length} tool card(s).`);
  const failures = [];
  for (const preset of selected) {
    try {
      const before = await buildBefore(preset, { refsDir, outDir, token });
      const after = await runTool(preset, before, token);
      fs.writeFileSync(path.join(outDir, `${preset.slug}.before.jpg`), before);
      // PNG throughout: the background remover's output is only useful with
      // its alpha channel intact.
      fs.writeFileSync(
        path.join(outDir, `${preset.slug}.after.png`),
        await sharp(after).png().toBuffer()
      );
      console.log(`  rendered ${preset.slug}  [${preset.model}]`);
    } catch (error) {
      failures.push(`${preset.slug}: ${error.message}`);
      console.log(`  FAILED   ${preset.slug}: ${error.message}`);
    }
  }
  if (failures.length) {
    console.log(`\n${failures.length} failure(s).`);
    process.exitCode = 1;
  }
}

await main();
