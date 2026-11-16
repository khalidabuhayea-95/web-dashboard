/**
 * The ichkil ONNX file (21 MB): where it lives, and fetching it from Hugging Face pinned to one
 * commit and verified by SHA-256. It is not committed to git.
 *
 *   - Docker: `node scripts/fetch-tashkeel-model.mjs` bakes it into the image at build time.
 *   - CI: the same script, cached.
 *   - Dev: fetched on first use into .models/ (gitignored).
 *
 * The vocabulary and label count (config.json, 3 KB) ARE committed: ichkil-config.json.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const ICHKIL_MODEL = Object.freeze({
  repo: "ichkil/ichkil",
  version: "0.3.0",
  // The v0.3.0 tag's commit, so a moved tag can never change what we load.
  revision: "ff8783fff6f6986929d8986983279d2f307d7bed",
  sha256: "9779e1aca89cebc77a9b92037b7d700c422cdf6c3774d4883f4652f641f3f705",
  bytes: 22284311,
});

export function ichkilModelUrl() {
  return `https://huggingface.co/${ICHKIL_MODEL.repo}/resolve/${ICHKIL_MODEL.revision}/model.onnx`;
}

/** ICHKIL_MODEL_PATH, or .models/ichkil-<version>.onnx under the app root. */
export function ichkilModelPath() {
  return (
    process.env.ICHKIL_MODEL_PATH ||
    path.join(process.cwd(), ".models", `ichkil-${ICHKIL_MODEL.version}.onnx`)
  );
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function isValidModelFile(filePath) {
  try {
    const info = await stat(filePath);
    if (info.size !== ICHKIL_MODEL.bytes) return false;
    return (await sha256File(filePath)) === ICHKIL_MODEL.sha256;
  } catch {
    return false;
  }
}

let verifiedPath = "";

/**
 * Path to a verified model file. Downloads it if missing, unless `download` is false. A file
 * that fails the checksum is replaced, never loaded.
 */
export async function ensureIchkilModel({ download = true, fetchImpl = fetch } = {}) {
  const target = ichkilModelPath();
  if (verifiedPath === target) return target;
  if (await isValidModelFile(target)) {
    verifiedPath = target;
    return target;
  }
  if (!download) {
    throw new Error(`ichkil model missing or corrupt at ${target} (run: node scripts/fetch-tashkeel-model.mjs)`);
  }

  const response = await fetchImpl(ichkilModelUrl());
  if (!response.ok) {
    throw new Error(`ichkil model download failed: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ICHKIL_MODEL.sha256) {
    throw new Error(`ichkil model checksum mismatch: expected ${ICHKIL_MODEL.sha256}, got ${digest}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.partial`;
  try {
    await writeFile(partial, bytes);
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
  verifiedPath = target;
  return target;
}
