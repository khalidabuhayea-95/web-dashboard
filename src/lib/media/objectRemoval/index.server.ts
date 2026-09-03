import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { getObjectRemovalModelDefinition } from "./models.js";
import { normalizeObjectRemovalInput } from "./normalize.server";
import {
  getSelfhostObjectRemovalMetadata,
  removeObjectViaSelfhost,
} from "./providers/selfhost.server";
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
const REPLICATE_OBJECT_REMOVE_MAX_LONG_EDGE = 1440;
const RGB_ONLY_OBJECT_REMOVAL_MODEL_IDS = new Set(["zylim0702/remove-object"]);

let canvasLibPromise: Promise<{ createCanvas: any; loadImage: any } | null> | null = null;

function createDataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
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

async function compositeObjectRemovalOutput({
  baseImage,
  editedCrop,
  cropRegion,
  outputFileName,
}: {
  baseImage: {
    bytes: Buffer;
    mimeType: string;
    width: number;
    height: number;
  };
  editedCrop: {
    bytes: Buffer;
    mimeType: string;
  };
  cropRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  outputFileName: string;
}) {
  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    return {
      bytes: editedCrop.bytes,
      mimeType: editedCrop.mimeType || "image/png",
      fileName: outputFileName,
      width: cropRegion.width,
      height: cropRegion.height,
    };
  }

  const [base, overlay] = await Promise.all([
    canvasLib.loadImage(createDataUrl(baseImage.bytes, baseImage.mimeType || "image/png")),
    canvasLib.loadImage(createDataUrl(editedCrop.bytes, editedCrop.mimeType || "image/png")),
  ]);

  const canvas = canvasLib.createCanvas(baseImage.width, baseImage.height);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(base, 0, 0, baseImage.width, baseImage.height);
  context.drawImage(
    overlay,
    cropRegion.x,
    cropRegion.y,
    cropRegion.width,
    cropRegion.height
  );

  const bytes = canvas.toBuffer("image/png");
  return {
    bytes,
    mimeType: "image/png",
    fileName: outputFileName,
    width: baseImage.width,
    height: baseImage.height,
  };
}

async function encodeProviderImageAsJpeg(image: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
}) {
  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    return {
      ...image,
      mimeType: "image/jpeg",
      fileName: image.fileName.replace(/\.[a-z0-9]+$/i, ".jpg"),
    };
  }

  const decoded = await canvasLib.loadImage(
    createDataUrl(image.bytes, image.mimeType || "image/png")
  );
  const canvas = canvasLib.createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(decoded, 0, 0, image.width, image.height);

  return {
    bytes: canvas.toBuffer("image/jpeg", { quality: 0.92 }),
    mimeType: "image/jpeg",
    fileName: image.fileName.replace(/\.[a-z0-9]+$/i, ".jpg"),
    width: image.width,
    height: image.height,
    size: 0,
  };
}

export async function removeObjectFromImage({
  imageBytes,
  imageMimeType,
  imageFileName,
  maskBytes,
  maskMimeType,
  maskFileName,
  modelId,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  maskBytes: Buffer;
  maskMimeType?: string;
  maskFileName?: string;
  modelId?: string;
}) {
  const normalized = await normalizeObjectRemovalInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    maskBytes,
    maskMimeType,
    maskFileName,
    maxLongEdge: REPLICATE_OBJECT_REMOVE_MAX_LONG_EDGE,
  });

  const requestId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  // Self-hosted models skip the staging/signed-URL dance entirely: bytes go
  // straight to our worker and come straight back. They also get the FULL
  // frame, not the padded crop the hosted providers receive: the crop exists
  // to shrink per-image upload/cost on Replicate, but LaMa fills a hole from
  // whatever context it can see, and inside a tight crop that context is
  // mostly the hole itself — the result was a washed-out smear where the
  // object used to be. Our worker charges nothing per pixel, so it sees the
  // whole picture and returns the whole picture (no re-composite needed).
  const selfhostDefinition = getObjectRemovalModelDefinition(String(modelId || "").trim());
  if (selfhostDefinition?.provider === "selfhost") {
    const providerMeta = getSelfhostObjectRemovalMetadata();
    const removed = await removeObjectViaSelfhost({
      imageBytes: normalized.image.bytes,
      maskBytes: normalized.mask.bytes,
    });
    return {
      bytes: removed.bytes,
      mimeType: removed.mimeType,
      fileName: normalized.outputFileName,
      width: normalized.image.width,
      height: normalized.image.height,
      provider: providerMeta.provider,
      model: providerMeta.model,
      version: providerMeta.version,
      predictionId: requestId,
    };
  }

  const stagedInputs: Array<{ bucket: string; path: string }> = [];
  try {
    const selectedModelId = String(modelId || "").trim();
    const stagedImage = await uploadObjectRemovalInputAsset({
      jobId: requestId,
      kind: "image",
      bytes: normalized.providerImage.bytes,
      mimeType: normalized.providerImage.mimeType,
      fileName: normalized.providerImage.fileName,
      width: normalized.providerImage.width,
      height: normalized.providerImage.height,
    });
    stagedInputs.push({ bucket: stagedImage.bucket, path: stagedImage.path });

    const stagedMask = await uploadObjectRemovalInputAsset({
      jobId: requestId,
      kind: "mask",
      bytes: normalized.providerMask.bytes,
      mimeType: normalized.providerMask.mimeType,
      fileName: normalized.providerMask.fileName,
      width: normalized.providerMask.width,
      height: normalized.providerMask.height,
    });
    stagedInputs.push({ bucket: stagedMask.bucket, path: stagedMask.path });

    const needsRgbProviderImage = RGB_ONLY_OBJECT_REMOVAL_MODEL_IDS.has(selectedModelId);
    const rgbProviderImage = needsRgbProviderImage
      ? await encodeProviderImageAsJpeg(normalized.providerImage)
      : null;
    const stagedRgbImage = rgbProviderImage
      ? await uploadObjectRemovalInputAsset({
          jobId: requestId,
          kind: "image-rgb",
          bytes: rgbProviderImage.bytes,
          mimeType: rgbProviderImage.mimeType,
          fileName: rgbProviderImage.fileName,
          width: rgbProviderImage.width,
          height: rgbProviderImage.height,
        })
      : null;
    if (stagedRgbImage) {
      stagedInputs.push({ bucket: stagedRgbImage.bucket, path: stagedRgbImage.path });
    }

    const [imageUrl, maskUrl, rgbImageUrl] = await Promise.all([
      createObjectRemovalSignedInputUrl({
        bucket: stagedImage.bucket,
        path: stagedImage.path,
      }),
      createObjectRemovalSignedInputUrl({
        bucket: stagedMask.bucket,
        path: stagedMask.path,
      }),
      stagedRgbImage
        ? createObjectRemovalSignedInputUrl({
            bucket: stagedRgbImage.bucket,
            path: stagedRgbImage.path,
          })
        : Promise.resolve(""),
    ]);

    const providerMeta = getReplicateObjectRemovalMetadata(selectedModelId);
    const prediction = await createReplicateObjectRemovalPrediction({
      imageUrl: needsRgbProviderImage && rgbImageUrl ? rgbImageUrl : imageUrl,
      maskUrl,
      modelId: selectedModelId,
    });
    const completedPrediction = await waitForReplicatePrediction({
      predictionId: prediction.id,
    });
    const downloadedOutput = await downloadReplicateOutput({
      outputUrl: completedPrediction.outputUrl,
      fileName: normalized.outputFileName,
    });
    const compositedOutput = normalized.cropRegion
      ? await compositeObjectRemovalOutput({
          baseImage: {
            bytes: normalized.image.bytes,
            mimeType: normalized.image.mimeType,
            width: normalized.image.width,
            height: normalized.image.height,
          },
          editedCrop: {
            bytes: downloadedOutput.bytes,
            mimeType: downloadedOutput.mimeType,
          },
          cropRegion: normalized.cropRegion,
          outputFileName: normalized.outputFileName,
        })
      : {
          bytes: downloadedOutput.bytes,
          mimeType: downloadedOutput.mimeType,
          fileName: downloadedOutput.fileName,
          width: downloadedOutput.width || normalized.image.width,
          height: downloadedOutput.height || normalized.image.height,
        };
    return {
      bytes: compositedOutput.bytes,
      mimeType: compositedOutput.mimeType,
      fileName: compositedOutput.fileName,
      width: compositedOutput.width,
      height: compositedOutput.height,
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
