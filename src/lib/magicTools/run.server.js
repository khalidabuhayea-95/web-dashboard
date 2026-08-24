// Runs one magic tool over an image. Two providers sit behind one call:
// Replicate for the hosted models, and our own in-process background remover,
// which costs nothing and never sends the photo anywhere.
//
// The Replicate plumbing lives in ./predict.js, shared with
// scripts/render-magic-tools.mjs so a card can never be produced by a different
// code path than the app uses.

import { removeBackground } from "@/lib/media/backgroundRemoval/index.server";
import { removeRasterBackgroundWithRembg } from "@/lib/media/backgroundRemoval/providers/rembg.server";
import { buildMagicToolModelInput, getMagicToolModelDefinition } from "./models";
import { createPrediction, downloadPredictionOutput, waitForPrediction } from "./predict";

// Background removal, best engine first.
//
// The default pipeline in lib/media/backgroundRemoval is an edge flood fill: it
// samples colours from the image border and deletes everything similar. That is
// instant and fine for a cut-out already on flat white, but measured against
// real inputs on 2026-08-16 it fails exactly where users need it — a product on
// a kitchen counter came back with holes punched through the walls, and even on
// a plain terracotta backdrop it ate the blender's glass jug, because the
// backdrop showing THROUGH the glass matched the background model.
//
// rembg (u2net, already installed in .venv-rembg) segments the subject instead
// of matching colours and got both cases right. It costs ~16s of local CPU and
// no money. Flood fill stays as the fallback for when the Python bridge is
// unavailable, so the tool degrades instead of failing.
//
// Scoped deliberately to this tool: /api/mobile/media/remove-background keeps
// its current engine until that switch is made on purpose.
async function removeBackgroundBestEffort(imageBuffer, imageMime) {
  try {
    return await removeRasterBackgroundWithRembg({
      bytes: imageBuffer,
      mimeType: imageMime || "image/jpeg",
      fileName: "magic-tool-input.jpg",
    });
  } catch (_error) {
    return removeBackground({
      bytes: imageBuffer,
      mimeType: imageMime || "image/jpeg",
      fileName: "magic-tool-input.jpg",
    });
  }
}

// Returns { buffer, mimeType, model, predictionId }.
export async function runMagicTool({ modelId, prompt, modelOptions, imageBuffer, imageMime }) {
  const definition = getMagicToolModelDefinition(modelId);
  if (!definition) throw new Error(`Unsupported model "${modelId}".`);
  if (!imageBuffer?.length) throw new Error("Magic tools need an input image.");

  if (definition.provider === "local") {
    const result = await removeBackgroundBestEffort(imageBuffer, imageMime);
    return {
      buffer: Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes || []),
      // Transparency is the whole point, so this path stays PNG downstream.
      mimeType: result.mimeType || "image/png",
      model: definition.id,
      predictionId: null,
    };
  }

  const token = String(process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN is not configured.");

  const imageDataUri = `data:${imageMime || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const input = buildMagicToolModelInput(definition, prompt, imageDataUri, modelOptions);

  const created = await createPrediction(definition.id, input, token);
  const finished = await waitForPrediction(created, token);
  const { buffer, mimeType } = await downloadPredictionOutput(finished);

  return { buffer, mimeType, model: definition.id, predictionId: finished.id };
}
