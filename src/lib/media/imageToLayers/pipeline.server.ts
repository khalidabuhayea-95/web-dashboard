import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logging/logger";

import { assembleImageLayers } from "./assemble.server";
import { decomposeImageToLayers } from "./index.server";
import { normalizeImageToLayersInput } from "./normalize.server";
import { extractTextBlocks } from "./ocr.server";
import {
  createImageToLayersSignedInputUrl,
  deleteImageToLayersStoredObjects,
  uploadImageToLayersInputAsset,
} from "./storage.server";
import { buildTextLayerObjects } from "./text.server";
import { removeTextRegions } from "./textRemoval.server";

const logger = createLogger("media.image-to-layers.pipeline");
const MAX_LONG_EDGE = 1536;

export type ImageToEditableLayersResult = {
  // Coordinate space the layer transforms live in (the client maps this group
  // onto the source layer's region when exploding one layer into many).
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  layers: Record<string, unknown>[];
  meta: {
    provider: string;
    model: string;
    predictionId: string;
    layerCount: number;
    textBlockCount: number;
    textRemoved: boolean;
  };
};

export async function imageToEditableLayers({
  imageBytes,
  imageMimeType,
  imageFileName,
  modelId,
  numLayers,
  includeText = true,
}: {
  imageBytes: Buffer;
  imageMimeType?: string;
  imageFileName?: string;
  modelId?: string;
  numLayers?: number;
  includeText?: boolean;
}): Promise<ImageToEditableLayersResult> {
  // Normalize once so OCR, text-removal, and the color sample all share one
  // pixel space; the cleaned image is then decomposed by the layered model.
  const normalized = await normalizeImageToLayersInput({
    imageBytes,
    imageMimeType,
    imageFileName,
    maxLongEdge: MAX_LONG_EDGE,
  });
  const { providerImage } = normalized;
  const ocrWidth = providerImage.width;
  const ocrHeight = providerImage.height;

  const requestId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : randomUUID();

  // --- Text stage (best-effort): OCR the original, then erase it so it isn't
  // duplicated. Any failure falls back to movable-only (text stays baked in). ---
  let blocks: Awaited<ReturnType<typeof extractTextBlocks>> = [];
  let cleanedBytes = providerImage.bytes;
  let cleanedMimeType = providerImage.mimeType;
  let textRemoved = false;

  if (includeText) {
    const staged: Array<{ bucket: string; path: string }> = [];
    try {
      const stagedImage = await uploadImageToLayersInputAsset({
        jobId: `${requestId}-ocr`,
        bytes: providerImage.bytes,
        mimeType: providerImage.mimeType,
        fileName: providerImage.fileName,
        width: ocrWidth,
        height: ocrHeight,
      });
      staged.push({ bucket: stagedImage.bucket, path: stagedImage.path });
      const ocrUrl = await createImageToLayersSignedInputUrl(stagedImage);

      blocks = await extractTextBlocks({ imageUrl: ocrUrl });

      if (blocks.length) {
        const removal = await removeTextRegions({
          imageBytes: providerImage.bytes,
          imageMimeType: providerImage.mimeType,
          blocks,
          width: ocrWidth,
          height: ocrHeight,
        });
        cleanedBytes = removal.bytes;
        cleanedMimeType = removal.mimeType;
        textRemoved = removal.removed;
      }
    } catch (error) {
      // Fall back to movable-only so the request still succeeds.
      logger.warn("Text stage failed; falling back to movable-only", {
        requestId,
        error: error instanceof Error ? error.message : String(error || ""),
      });
      blocks = [];
      cleanedBytes = providerImage.bytes;
      cleanedMimeType = providerImage.mimeType;
      textRemoved = false;
    } finally {
      if (staged.length) {
        await deleteImageToLayersStoredObjects(staged).catch(() => {});
      }
    }
  }

  // --- Decomposition: layered model runs on the (text-free) image. ---
  const decomposition = await decomposeImageToLayers({
    imageBytes: cleanedBytes,
    imageMimeType: cleanedMimeType,
    imageFileName: providerImage.fileName,
    modelId,
    numLayers,
  });

  // --- Editable text overlay: OCR boxes scaled into the final canvas space. ---
  const textObjects = blocks.length
    ? await buildTextLayerObjects({
        blocks,
        imageBytes: providerImage.bytes, // sample colour from the original (with text)
        imageMimeType: providerImage.mimeType,
        ocrWidth,
        ocrHeight,
        canvasWidth: decomposition.canvasWidth,
        canvasHeight: decomposition.canvasHeight,
      })
    : [];

  const assembled = assembleImageLayers(decomposition, { textObjects });

  logger.info("Image to editable layers completed", {
    requestId,
    predictionId: decomposition.predictionId,
    layerCount: assembled.layers.length,
    textBlockCount: blocks.length,
    textRemoved,
    canvasWidth: assembled.canvasWidth,
    canvasHeight: assembled.canvasHeight,
  });

  return {
    canvasWidth: assembled.canvasWidth,
    canvasHeight: assembled.canvasHeight,
    sourceWidth: decomposition.sourceWidth,
    sourceHeight: decomposition.sourceHeight,
    layers: assembled.layers,
    meta: {
      provider: decomposition.provider,
      model: decomposition.model,
      predictionId: decomposition.predictionId,
      layerCount: assembled.layers.length,
      textBlockCount: blocks.length,
      textRemoved,
    },
  };
}
