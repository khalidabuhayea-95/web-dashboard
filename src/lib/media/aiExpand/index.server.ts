import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { getAiExpandModelDefinition } from "./models.js";
import { normalizeAiExpandInput } from "./normalize.server";
import {
  createReplicateAiExpandPrediction,
  downloadReplicateOutput,
  getReplicateAiExpandMetadata,
} from "./providers/replicate.server";
import { waitForReplicatePrediction } from "./providers/replicate.server";
import {
  createAiExpandSignedInputUrl,
  deleteAiExpandStoredObjects,
  uploadAiExpandInputAsset,
} from "./storage.server";

const logger = createLogger("media.ai-expand");

let canvasLibPromise: Promise<{ createCanvas: any; loadImage: any } | null> | null = null;

function createDataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function roundDownToMultiple(value: number, multiple: number) {
  const safeValue = Math.max(multiple, Math.floor(Number(value) || multiple));
  return Math.max(multiple, safeValue - (safeValue % multiple));
}

function computeDiffusionInputDimensions(width: number, height: number, multiple = 64) {
  const maxEdge = 1024;
  const longEdge = Math.max(width, height, 1);
  const scale = Math.min(1, maxEdge / longEdge);
  const scaledWidth = Math.max(64, Math.round(width * scale));
  const scaledHeight = Math.max(64, Math.round(height * scale));

  return {
    width: roundDownToMultiple(scaledWidth, multiple),
    height: roundDownToMultiple(scaledHeight, multiple),
  };
}

async function getCanvasLib() {
  if (canvasLibPromise) return canvasLibPromise;
  canvasLibPromise = import("canvas")
    .then((module) => ({
      createCanvas: module.createCanvas,
      loadImage: module.loadImage,
    }))
    .catch((_error) => null);
  return canvasLibPromise;
}

async function resizeOutputToTarget({
  imageBytes,
  imageMimeType,
  targetWidth,
  targetHeight,
  outputFileName,
}: {
  imageBytes: Buffer;
  imageMimeType: string;
  targetWidth: number;
  targetHeight: number;
  outputFileName: string;
}) {
  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    return {
      bytes: imageBytes,
      mimeType: imageMimeType || "image/png",
      fileName: outputFileName,
      width: targetWidth,
      height: targetHeight,
    };
  }

  const decoded = await canvasLib.loadImage(
    createDataUrl(imageBytes, imageMimeType || "image/png")
  );
  const canvas = canvasLib.createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded, 0, 0, targetWidth, targetHeight);

  return {
    bytes: canvas.toBuffer("image/png"),
    mimeType: "image/png",
    fileName: outputFileName,
    width: targetWidth,
    height: targetHeight,
  };
}

async function resizeProviderAsset({
  bytes,
  mimeType,
  fileName,
  targetWidth,
  targetHeight,
  smoothing,
}: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  targetWidth: number;
  targetHeight: number;
  smoothing: boolean;
}) {
  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    return {
      bytes,
      mimeType,
      fileName,
      width: targetWidth,
      height: targetHeight,
      size: bytes.length,
    };
  }

  const decoded = await canvasLib.loadImage(createDataUrl(bytes, mimeType || "image/png"));
  const canvas = canvasLib.createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = smoothing;
  context.imageSmoothingQuality = smoothing ? "high" : "low";
  context.drawImage(decoded, 0, 0, targetWidth, targetHeight);

  const outputBytes = canvas.toBuffer(mimeType === "image/jpeg" ? "image/jpeg" : "image/png");
  return {
    bytes: outputBytes,
    mimeType: mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
    fileName,
    width: targetWidth,
    height: targetHeight,
    size: outputBytes.length,
  };
}

export async function expandImageWithAi({
  imageBytes,
  imageMimeType,
  imageFileName,
  targetWidth,
  targetHeight,
  modelId,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  targetWidth: number;
  targetHeight: number;
  modelId?: string;
}) {
  const normalized = await normalizeAiExpandInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    targetWidth,
    targetHeight,
  });

  if (!normalized.requiresExpansion) {
    const providerMeta = getReplicateAiExpandMetadata(modelId);
    return {
      bytes: normalized.providerCanvasImage.bytes,
      mimeType: normalized.providerCanvasImage.mimeType,
      fileName: normalized.outputFileName,
      width: normalized.targetWidth,
      height: normalized.targetHeight,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: "",
    };
  }

  const modelDefinition = getAiExpandModelDefinition(modelId);
  let providerCanvasImage = normalized.providerCanvasImage;
  let providerMask = normalized.providerMask;
  let providerTargetWidth = normalized.targetWidth;
  let providerTargetHeight = normalized.targetHeight;

  const requestId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  const stagedInputs: Array<{ bucket: string; path: string }> = [];
  try {
    const stagedImage = await uploadAiExpandInputAsset({
      jobId: requestId,
      kind: "image",
      bytes: normalized.image.bytes,
      mimeType: normalized.image.mimeType,
      fileName: normalized.image.fileName,
      width: normalized.image.width,
      height: normalized.image.height,
    });
    stagedInputs.push({ bucket: stagedImage.bucket, path: stagedImage.path });

    const stagedCanvas = await uploadAiExpandInputAsset({
      jobId: requestId,
      kind: "canvas",
      bytes: providerCanvasImage.bytes,
      mimeType: providerCanvasImage.mimeType,
      fileName: providerCanvasImage.fileName,
      width: providerCanvasImage.width,
      height: providerCanvasImage.height,
    });
    stagedInputs.push({ bucket: stagedCanvas.bucket, path: stagedCanvas.path });

    const stagedMask = await uploadAiExpandInputAsset({
      jobId: requestId,
      kind: "mask",
      bytes: providerMask.bytes,
      mimeType: providerMask.mimeType,
      fileName: providerMask.fileName,
      width: providerMask.width,
      height: providerMask.height,
    });
    stagedInputs.push({ bucket: stagedMask.bucket, path: stagedMask.path });

    const [imageUrl, canvasImageUrl, maskUrl] = await Promise.all([
      createAiExpandSignedInputUrl({
        bucket: stagedImage.bucket,
        path: stagedImage.path,
      }),
      createAiExpandSignedInputUrl({
        bucket: stagedCanvas.bucket,
        path: stagedCanvas.path,
      }),
      createAiExpandSignedInputUrl({
        bucket: stagedMask.bucket,
        path: stagedMask.path,
      }),
    ]);

    const providerMeta = getReplicateAiExpandMetadata(modelId);
    const prediction = await createReplicateAiExpandPrediction({
      imageUrl,
      canvasImageUrl,
      maskUrl,
      targetWidth: providerTargetWidth,
      targetHeight: providerTargetHeight,
      placedImageX: normalized.placedImageX,
      placedImageY: normalized.placedImageY,
      placedImageWidth: normalized.placedImageWidth,
      placedImageHeight: normalized.placedImageHeight,
      modelId,
    });
    const completedPrediction = await waitForReplicatePrediction({
      predictionId: prediction.id,
    });
    const downloadedOutput = await downloadReplicateOutput({
      outputUrl: completedPrediction.outputUrl,
      fileName: normalized.outputFileName,
    });

    const resizedOutput =
      downloadedOutput.width === normalized.targetWidth &&
      downloadedOutput.height === normalized.targetHeight
        ? {
            bytes: downloadedOutput.bytes,
            mimeType: downloadedOutput.mimeType,
            fileName: downloadedOutput.fileName,
            width: normalized.targetWidth,
            height: normalized.targetHeight,
          }
        : await resizeOutputToTarget({
            imageBytes: downloadedOutput.bytes,
            imageMimeType: downloadedOutput.mimeType,
            targetWidth: normalized.targetWidth,
            targetHeight: normalized.targetHeight,
            outputFileName: normalized.outputFileName,
          });

    return {
      bytes: resizedOutput.bytes,
      mimeType: resizedOutput.mimeType,
      fileName: resizedOutput.fileName,
      width: resizedOutput.width,
      height: resizedOutput.height,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: prediction.id,
    };
  } finally {
    if (stagedInputs.length > 0) {
      await deleteAiExpandStoredObjects(stagedInputs).catch((error) => {
        logger.warn("Failed to clean up staged AI Expand inputs", {
          requestId,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
  }
}
