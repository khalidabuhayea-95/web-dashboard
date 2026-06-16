import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { normalizeEditImageInput } from "./normalize.server";
import {
  createReplicateEditImagePrediction,
  downloadReplicateOutput,
  getReplicateEditImageMetadata,
  waitForReplicatePrediction,
} from "./providers/replicate.server";
import {
  createEditImageSignedInputUrl,
  deleteEditImageStoredObjects,
  uploadEditImageInputAsset,
} from "./storage.server";

const logger = createLogger("media.image-edit");

export async function editImageWithPrompt({
  imageBytes,
  imageMimeType,
  imageFileName,
  prompt,
  modelId,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  prompt?: unknown;
  modelId?: string;
}) {
  const normalized = await normalizeEditImageInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    prompt,
  });

  const requestId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  const stagedInputs: Array<{ bucket: string; path: string }> = [];
  try {
    const stagedImage = await uploadEditImageInputAsset({
      jobId: requestId,
      bytes: normalized.image.bytes,
      mimeType: normalized.image.mimeType,
      fileName: normalized.image.fileName,
      width: normalized.image.width,
      height: normalized.image.height,
    });
    stagedInputs.push({ bucket: stagedImage.bucket, path: stagedImage.path });

    const imageUrl = await createEditImageSignedInputUrl({
      bucket: stagedImage.bucket,
      path: stagedImage.path,
    });

    const providerMeta = getReplicateEditImageMetadata(modelId);
    const prediction = await createReplicateEditImagePrediction({
      imageUrl,
      prompt: normalized.prompt,
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
      width: downloadedOutput.width || normalized.image.width,
      height: downloadedOutput.height || normalized.image.height,
      prompt: normalized.prompt,
      inputWidth: normalized.image.width,
      inputHeight: normalized.image.height,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: prediction.id,
    };
  } finally {
    if (stagedInputs.length > 0) {
      await deleteEditImageStoredObjects(stagedInputs).catch((error) => {
        logger.warn("Failed to clean up staged image edit inputs", {
          requestId,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
  }
}
