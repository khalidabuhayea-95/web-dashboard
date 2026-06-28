import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { normalizeImageToLayersInput } from "./normalize.server";
import {
  createReplicateImageToLayersPrediction,
  downloadReplicateOutput,
  getReplicateImageToLayersMetadata,
  waitForReplicatePrediction,
} from "./providers/replicate.server";
import {
  createImageToLayersSignedInputUrl,
  deleteImageToLayersStoredObjects,
  uploadImageToLayersInputAsset,
  uploadImageToLayersLayerAsset,
} from "./storage.server";

const logger = createLogger("media.image-to-layers");
const REPLICATE_IMAGE_TO_LAYERS_MAX_LONG_EDGE = 1536;
// Layers whose visible (non-transparent) area is below this fraction are
// treated as empty/hallucinated and dropped, so the final count reflects the
// actual image content rather than the requested ceiling.
const MIN_VISIBLE_COVERAGE = 0.002;

let canvasLibPromise: Promise<{ loadImage: any; createCanvas: any } | null> | null = null;

async function getCanvasLib() {
  if (canvasLibPromise) return canvasLibPromise;
  canvasLibPromise = import("canvas")
    .then((module) => ({ loadImage: module.loadImage, createCanvas: module.createCanvas }))
    .catch(() => null);
  return canvasLibPromise;
}

// Fraction of pixels with meaningful alpha. Returns 1 (keep) if it can't decode.
async function visibleCoverage(bytes: Buffer, mimeType: string): Promise<number> {
  const canvasLib = await getCanvasLib();
  if (!canvasLib?.loadImage || !canvasLib?.createCanvas) return 1;
  try {
    const image = await canvasLib.loadImage(
      `data:${mimeType || "image/png"};base64,${bytes.toString("base64")}`
    );
    const w = Math.max(1, Math.round(image.width));
    const h = Math.max(1, Math.round(image.height));
    const canvas = canvasLib.createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let visible = 0;
    let sampled = 0;
    // Sample every 4th pixel (step 16 bytes) for speed; read the alpha channel.
    for (let i = 3; i < data.length; i += 16) {
      sampled += 1;
      if (data[i] > 16) visible += 1;
    }
    return sampled ? visible / sampled : 1;
  } catch {
    return 1;
  }
}

export type DecomposedLayer = {
  index: number;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  sourceHasAlpha: boolean;
};

export type DecomposeImageToLayersResult = {
  layers: DecomposedLayer[];
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  provider: string;
  model: string;
  version: string;
  predictionId: string;
};

export async function decomposeImageToLayers({
  imageBytes,
  imageMimeType,
  imageFileName,
  modelId,
  numLayers,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  modelId?: string;
  numLayers?: number;
}): Promise<DecomposeImageToLayersResult> {
  const normalized = await normalizeImageToLayersInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    maxLongEdge: REPLICATE_IMAGE_TO_LAYERS_MAX_LONG_EDGE,
  });

  const requestId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  const stagedInputs: Array<{ bucket: string; path: string }> = [];
  try {
    const selectedModelId = String(modelId || "").trim();

    const stagedImage = await uploadImageToLayersInputAsset({
      jobId: requestId,
      bytes: normalized.providerImage.bytes,
      mimeType: normalized.providerImage.mimeType,
      fileName: normalized.providerImage.fileName,
      width: normalized.providerImage.width,
      height: normalized.providerImage.height,
    });
    stagedInputs.push({ bucket: stagedImage.bucket, path: stagedImage.path });

    const imageUrl = await createImageToLayersSignedInputUrl({
      bucket: stagedImage.bucket,
      path: stagedImage.path,
    });

    const providerMeta = getReplicateImageToLayersMetadata(selectedModelId);
    const prediction = await createReplicateImageToLayersPrediction({
      imageUrl,
      numLayers,
      modelId: selectedModelId,
    });
    const completedPrediction = await waitForReplicatePrediction({
      predictionId: prediction.id,
    });

    // qwen-image-layered returns layers back-to-front, so array order maps onto
    // z-order (0 = bottom). Download all, then drop near-empty layers so the
    // final count reflects the actual image content, not the requested ceiling.
    const downloads = await Promise.all(
      completedPrediction.outputUrls.map((outputUrl, index) =>
        downloadReplicateOutput({
          outputUrl,
          fileName: `${normalized.outputBaseName}-layer-${String(index).padStart(2, "0")}`,
        })
      )
    );
    const coverages = await Promise.all(
      downloads.map((download) => visibleCoverage(download.bytes, download.mimeType))
    );
    let kept = downloads.filter((_, index) => coverages[index] >= MIN_VISIBLE_COVERAGE);
    if (!kept.length) kept = downloads; // never drop everything
    const droppedCount = downloads.length - kept.length;

    // Persist survivors in order; re-index so z-order stays contiguous.
    const layers: DecomposedLayer[] = await Promise.all(
      kept.map(async (downloaded, index) => {
        const uploaded = await uploadImageToLayersLayerAsset({
          jobId: requestId,
          index,
          bytes: downloaded.bytes,
          mimeType: downloaded.mimeType,
          // Storage already prefixes the path with `layer-NN`, so pass the bare
          // base name to avoid a doubled `layer-NN-..-layer-NN` filename.
          fileName: normalized.outputBaseName,
          width: downloaded.width,
          height: downloaded.height,
        });
        return {
          index,
          url: uploaded.assetUrl,
          width: downloaded.width || normalized.providerImage.width,
          height: downloaded.height || normalized.providerImage.height,
          mimeType: downloaded.mimeType,
          // Every decomposed layer is an RGBA cut-out; alpha defines its shape.
          sourceHasAlpha: true,
        };
      })
    );

    // All layers come back at a single consistent resolution, so the first
    // layer's dimensions define the assembled canvas.
    const canvasWidth = layers[0]?.width || normalized.providerImage.width;
    const canvasHeight = layers[0]?.height || normalized.providerImage.height;

    logger.info("Decomposed image into layers", {
      requestId,
      predictionId: prediction.id,
      model: providerMeta.model,
      rawLayerCount: downloads.length,
      droppedEmptyLayers: droppedCount,
      layerCount: layers.length,
      canvasWidth,
      canvasHeight,
    });

    return {
      layers,
      canvasWidth,
      canvasHeight,
      sourceWidth: normalized.sourceWidth,
      sourceHeight: normalized.sourceHeight,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: prediction.id,
    };
  } finally {
    if (stagedInputs.length > 0) {
      await deleteImageToLayersStoredObjects(stagedInputs).catch((error) => {
        logger.warn("Failed to clean up staged image layering inputs", {
          requestId,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
  }
}
