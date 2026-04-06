import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { normalizeObjectRemovalInput } from "./normalize.server";
import {
  createReplicateObjectRemovalPrediction,
  downloadReplicateOutput,
  getReplicateObjectRemovalMetadata,
  waitForReplicatePrediction,
} from "./providers/replicate.server";
import {
  createObjectRemovalSignedInputUrl,
  deleteObjectRemovalStoredObjects,
  uploadObjectRemovalInputAsset,
} from "./storage.server";

const logger = createLogger("media.object-remove");

export async function removeObjectFromImage({
  imageBytes,
  imageMimeType,
  imageFileName,
  maskBytes,
  maskMimeType,
  maskFileName,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  maskBytes: Buffer;
  maskMimeType?: string;
  maskFileName?: string;
}) {
  const normalized = await normalizeObjectRemovalInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    maskBytes,
    maskMimeType,
    maskFileName,
  });

  const requestId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  const stagedInputs: Array<{ bucket: string; path: string }> = [];
  try {
    const stagedImage = await uploadObjectRemovalInputAsset({
      jobId: requestId,
      kind: "image",
      bytes: normalized.image.bytes,
      mimeType: normalized.image.mimeType,
      fileName: normalized.image.fileName,
      width: normalized.image.width,
      height: normalized.image.height,
    });
    stagedInputs.push({ bucket: stagedImage.bucket, path: stagedImage.path });

    const stagedMask = await uploadObjectRemovalInputAsset({
      jobId: requestId,
      kind: "mask",
      bytes: normalized.mask.bytes,
      mimeType: normalized.mask.mimeType,
      fileName: normalized.mask.fileName,
      width: normalized.mask.width,
      height: normalized.mask.height,
    });
    stagedInputs.push({ bucket: stagedMask.bucket, path: stagedMask.path });

    const [imageUrl, maskUrl] = await Promise.all([
      createObjectRemovalSignedInputUrl({
        bucket: stagedImage.bucket,
        path: stagedImage.path,
      }),
      createObjectRemovalSignedInputUrl({
        bucket: stagedMask.bucket,
        path: stagedMask.path,
      }),
    ]);

    const prediction = await createReplicateObjectRemovalPrediction({
      imageUrl,
      maskUrl,
    });
    const completedPrediction = await waitForReplicatePrediction({
      predictionId: prediction.id,
    });
    const downloadedOutput = await downloadReplicateOutput({
      outputUrl: completedPrediction.outputUrl,
      fileName: normalized.outputFileName,
    });
    const providerMeta = getReplicateObjectRemovalMetadata();

    return {
      bytes: downloadedOutput.bytes,
      mimeType: downloadedOutput.mimeType,
      fileName: downloadedOutput.fileName,
      width: downloadedOutput.width || normalized.image.width,
      height: downloadedOutput.height || normalized.image.height,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: prediction.id,
    };
  } finally {
    if (stagedInputs.length > 0) {
      await deleteObjectRemovalStoredObjects(stagedInputs).catch((error) => {
        logger.warn("Failed to clean up staged object removal inputs", {
          requestId,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
  }
}
