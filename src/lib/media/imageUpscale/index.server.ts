import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { getImageUpscaleModelDefinition } from "./models.js";
import { normalizeImageUpscaleInput } from "./normalize.server";
import {
  getSelfhostImageUpscaleMetadata,
  upscaleImageViaSelfhost,
} from "./providers/selfhost.server";
import {
  createReplicateUpscalePrediction,
  downloadReplicateOutput,
  getReplicateImageUpscaleMetadata,
  waitForReplicatePrediction,
} from "./providers/replicate.server";
import {
  createImageUpscaleSignedInputUrl,
  deleteImageUpscaleStoredObjects,
  uploadImageUpscaleInputAsset,
} from "./storage.server";

const logger = createLogger("media.image-upscale");

export async function upscaleImageWithAi({
  imageBytes,
  imageMimeType,
  imageFileName,
  scale,
  modelId,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  scale?: unknown;
  modelId?: string;
}) {
  const normalized = await normalizeImageUpscaleInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    scale,
  });

  const requestId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  // Our own worker takes the bytes directly — no R2 staging, no signed URL,
  // no polling. Same branch shape as object removal.
  const selfhostDefinition = getImageUpscaleModelDefinition(String(modelId || "").trim());
  if (selfhostDefinition?.provider === "selfhost") {
    const providerMeta = getSelfhostImageUpscaleMetadata();
    const upscaled = await upscaleImageViaSelfhost({
      imageBytes: normalized.image.bytes,
      scale: normalized.scale,
    });
    return {
      bytes: upscaled.bytes,
      mimeType: upscaled.mimeType,
      fileName: normalized.outputFileName,
      width: normalized.image.width * normalized.scale,
      height: normalized.image.height * normalized.scale,
      scale: normalized.scale,
      inputWidth: normalized.image.width,
      inputHeight: normalized.image.height,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: requestId,
    };
  }

  const stagedInputs: Array<{ bucket: string; path: string }> = [];
  try {
    const stagedImage = await uploadImageUpscaleInputAsset({
      jobId: requestId,
      bytes: normalized.image.bytes,
      mimeType: normalized.image.mimeType,
      fileName: normalized.image.fileName,
      width: normalized.image.width,
      height: normalized.image.height,
    });
    stagedInputs.push({ bucket: stagedImage.bucket, path: stagedImage.path });

    const imageUrl = await createImageUpscaleSignedInputUrl({
      bucket: stagedImage.bucket,
      path: stagedImage.path,
    });

    const providerMeta = getReplicateImageUpscaleMetadata(modelId);
    const prediction = await createReplicateUpscalePrediction({
      imageUrl,
      scale: normalized.scale,
      modelId,
    });
    const completedPrediction = await waitForReplicatePrediction({
      predictionId: prediction.id,
    });
    const downloadedOutput = await downloadReplicateOutput({
      outputUrl: completedPrediction.outputUrl,
      fileName: normalized.outputFileName,
    });

    return {
      bytes: downloadedOutput.bytes,
      mimeType: downloadedOutput.mimeType,
      fileName: downloadedOutput.fileName,
      width: downloadedOutput.width,
      height: downloadedOutput.height,
      scale: normalized.scale,
      inputWidth: normalized.image.width,
      inputHeight: normalized.image.height,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: prediction.id,
    };
  } finally {
    if (stagedInputs.length > 0) {
      await deleteImageUpscaleStoredObjects(stagedInputs).catch((error) => {
        logger.warn("Failed to clean up staged image upscale inputs", {
          requestId,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
  }
}
