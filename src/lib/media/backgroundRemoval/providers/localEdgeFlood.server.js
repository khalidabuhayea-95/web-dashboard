import {
  createProcessingFailedError,
  createProviderUnavailableError,
  createUnprocessableImageError,
  createUnsupportedImageTypeError,
} from "../errors.js";

const ALLOWED_RASTER_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_PROCESSABLE_PIXELS = 7_500_000;
const DEFAULT_MAX_SIDE = 4096;
const MODEL_DISTANCE_MIN_SQ = 22 * 22;
const MAX_BACKGROUND_MODELS = 4;

let sharpPromise = null;

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeOutputFileName(value) {
  const baseName = String(value || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${baseName || "image"}-no-bg.png`;
}

async function loadSharp() {
  if (sharpPromise) return sharpPromise;

  sharpPromise = import("sharp")
    .then((module) => module?.default || module)
    .catch((error) => {
      sharpPromise = null;
      throw createProviderUnavailableError(
        error instanceof Error && error.message
          ? `Background removal image engine is unavailable: ${error.message}`
          : "Background removal image engine is unavailable."
      );
    });

  return sharpPromise;
}

function quantizeChannel(value) {
  return clampNumber(Math.round(Number(value) || 0), 0, 0, 255) >> 4;
}

function maxChannel(r, g, b) {
  return Math.max(r, g, b);
}

function minChannel(r, g, b) {
  return Math.min(r, g, b);
}

function colorSpread(r, g, b) {
  return maxChannel(r, g, b) - minChannel(r, g, b);
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(value) {
  return clampNumber(Math.round(Number(value) || 0), 0, 0, 255);
}

function colorDistanceSquared(r, g, b, model) {
  const dr = r - model.r;
  const dg = g - model.g;
  const db = b - model.b;
  return dr * dr + dg * dg + db * db;
}

function buildBackgroundModel(rgba, width, height) {
  const edgeBand = clampNumber(Math.round(Math.min(width, height) * 0.02), 2, 1, 8);
  const buckets = new Map();
  let totalSamples = 0;
  let transparentEdgePixels = 0;
  let nearWhiteCount = 0;
  let nearWhiteTotalR = 0;
  let nearWhiteTotalG = 0;
  let nearWhiteTotalB = 0;

  const includePixel = (x, y) => {
    const index = (y * width + x) * 4;
    const alpha = rgba[index + 3];
    if (alpha <= 8) {
      transparentEdgePixels += 1;
      return;
    }

    totalSamples += 1;
    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];
    const spread = colorSpread(r, g, b);
    const pixelLuma = luma(r, g, b);
    const key = `${quantizeChannel(r)}:${quantizeChannel(g)}:${quantizeChannel(b)}`;
    const bucket = buckets.get(key) || {
      count: 0,
      rTotal: 0,
      gTotal: 0,
      bTotal: 0,
      samples: [],
      whiteLikeCount: 0,
    };
    bucket.count += 1;
    bucket.rTotal += r;
    bucket.gTotal += g;
    bucket.bTotal += b;
    bucket.samples.push([r, g, b]);
    if (pixelLuma >= 234 && spread <= 28) {
      bucket.whiteLikeCount += 1;
      nearWhiteCount += 1;
      nearWhiteTotalR += r;
      nearWhiteTotalG += g;
      nearWhiteTotalB += b;
    }
    buckets.set(key, bucket);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < edgeBand || y < edgeBand || x >= width - edgeBand || y >= height - edgeBand) {
        includePixel(x, y);
      }
    }
  }

  if (buckets.size === 0) {
    return {
      edgeBand,
      hasTransparentEdges: transparentEdgePixels > 0,
      transparentEdgePixels,
      nearWhiteRatio: 0,
      models: [],
    };
  }

  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  const dominant = sortedBuckets[0] || null;
  if (!dominant || dominant.count < Math.max(24, Math.round(totalSamples * 0.12))) {
    return {
      edgeBand,
      hasTransparentEdges: transparentEdgePixels > 0,
      transparentEdgePixels,
      nearWhiteRatio: nearWhiteCount / Math.max(1, totalSamples),
      models: [],
    };
  }

  const models = [];
  const dominantCount = dominant.count;

  const addModel = (avg, bucketCount, samples, whiteLikeCount) => {
    if (!avg || !samples || samples.length === 0) return;
    if (models.some((model) => colorDistanceSquared(avg.r, avg.g, avg.b, model) < MODEL_DISTANCE_MIN_SQ)) {
      return;
    }

    const distances = samples
      .map(([r, g, b]) => Math.sqrt(colorDistanceSquared(r, g, b, avg)))
      .sort((a, b) => a - b);
    const percentile85 = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.85))] || 0;
    const percentile95 = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] || percentile85;
    const spread = colorSpread(avg.r, avg.g, avg.b);
    const avgLuma = luma(avg.r, avg.g, avg.b);
    const isWhiteLike =
      avgLuma >= 232 &&
      spread <= 28 &&
      whiteLikeCount >= Math.max(4, Math.round(bucketCount * 0.28));
    const seedBoost = isWhiteLike ? 24 : 18;
    const fillBoost = isWhiteLike ? 42 : 30;
    const featherBoost = isWhiteLike ? 70 : 50;

    models.push({
      ...avg,
      count: bucketCount,
      luma: avgLuma,
      spread,
      isWhiteLike,
      thresholdSq: Math.pow(clampNumber(percentile85 + seedBoost, isWhiteLike ? 34 : 28, 18, 96), 2),
      fillThresholdSq: Math.pow(clampNumber(percentile95 + fillBoost, isWhiteLike ? 56 : 44, 28, 144), 2),
      featherThresholdSq: Math.pow(clampNumber(percentile95 + featherBoost, isWhiteLike ? 84 : 64, 36, 196), 2),
    });
  };

  for (let index = 0; index < sortedBuckets.length; index += 1) {
    const bucket = sortedBuckets[index];
    if (!bucket || bucket.count < Math.max(12, Math.round(totalSamples * 0.035))) continue;
    if (index > 0 && bucket.count < Math.max(10, Math.round(dominantCount * 0.18))) continue;

    addModel(
      {
        r: Math.round(bucket.rTotal / bucket.count),
        g: Math.round(bucket.gTotal / bucket.count),
        b: Math.round(bucket.bTotal / bucket.count),
      },
      bucket.count,
      bucket.samples,
      bucket.whiteLikeCount
    );
    if (models.length >= MAX_BACKGROUND_MODELS) break;
  }

  const nearWhiteRatio = nearWhiteCount / Math.max(1, totalSamples);
  if (
    nearWhiteCount >= Math.max(16, Math.round(totalSamples * 0.2)) &&
    !models.some((model) => model.isWhiteLike)
  ) {
    addModel(
      {
        r: Math.round(nearWhiteTotalR / nearWhiteCount),
        g: Math.round(nearWhiteTotalG / nearWhiteCount),
        b: Math.round(nearWhiteTotalB / nearWhiteCount),
      },
      nearWhiteCount,
      Array.from({ length: Math.min(nearWhiteCount, 64) }, () => [
        Math.round(nearWhiteTotalR / nearWhiteCount),
        Math.round(nearWhiteTotalG / nearWhiteCount),
        Math.round(nearWhiteTotalB / nearWhiteCount),
      ]),
      nearWhiteCount
    );
  }

  return {
    edgeBand,
    hasTransparentEdges: transparentEdgePixels > 0,
    transparentEdgePixels,
    nearWhiteRatio,
    models,
  };
}

function countBackgroundNeighbors(mask, x, y, width, height) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      if (mask[nextY * width + nextX] === 1) count += 1;
    }
  }
  return count;
}

function findBestBackgroundMatch(rgba, pixelIndex, backgroundInfo, mode, preferredModelIndex = -1) {
  const rgbaIndex = pixelIndex * 4;
  const alpha = rgba[rgbaIndex + 3];
  if (alpha <= 8) {
    return {
      matched: true,
      modelIndex: preferredModelIndex >= 0 ? preferredModelIndex : 0,
      distanceSq: 0,
    };
  }

  const models = Array.isArray(backgroundInfo?.models) ? backgroundInfo.models : [];
  if (models.length === 0) {
    return {
      matched: false,
      modelIndex: -1,
      distanceSq: Number.POSITIVE_INFINITY,
    };
  }

  const r = rgba[rgbaIndex];
  const g = rgba[rgbaIndex + 1];
  const b = rgba[rgbaIndex + 2];
  const pixelLuma = luma(r, g, b);
  const pixelSpread = colorSpread(r, g, b);
  let best = null;

  const checkModel = (modelIndex) => {
    const model = models[modelIndex];
    if (!model) return;

    let thresholdSq = model.thresholdSq;
    if (mode === "fill") thresholdSq = model.fillThresholdSq;
    if (mode === "feather") thresholdSq = model.featherThresholdSq;

    let distanceSq = colorDistanceSquared(r, g, b, model);
    if (model.isWhiteLike && pixelLuma >= model.luma - 18 && pixelSpread <= model.spread + 18) {
      thresholdSq += mode === "seed" ? 18 * 18 : mode === "fill" ? 26 * 26 : 34 * 34;
      distanceSq = Math.max(0, distanceSq - 10 * 10);
    }

    if (distanceSq > thresholdSq) return;
    if (!best || distanceSq < best.distanceSq) {
      best = {
        matched: true,
        modelIndex,
        distanceSq,
      };
    }
  };

  if (preferredModelIndex >= 0) {
    checkModel(preferredModelIndex);
    if (best) return best;
  }

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    checkModel(modelIndex);
  }

  return (
    best || {
      matched: false,
      modelIndex: -1,
      distanceSq: Number.POSITIVE_INFINITY,
    }
  );
}

function decontaminateEdgePixel(rgba, rgbaIndex, model) {
  const alpha = rgba[rgbaIndex + 3] / 255;
  if (!(alpha > 0 && alpha < 1)) return false;

  const nextR = clampByte((rgba[rgbaIndex] - model.r * (1 - alpha)) / alpha);
  const nextG = clampByte((rgba[rgbaIndex + 1] - model.g * (1 - alpha)) / alpha);
  const nextB = clampByte((rgba[rgbaIndex + 2] - model.b * (1 - alpha)) / alpha);

  rgba[rgbaIndex] = nextR;
  rgba[rgbaIndex + 1] = nextG;
  rgba[rgbaIndex + 2] = nextB;
  return true;
}

function removeBackgroundFromRgba(originalRgba, matchRgba, width, height, backgroundInfo) {
  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);
  const assignedModels = new Int16Array(totalPixels);
  assignedModels.fill(-1);
  const queue = new Int32Array(totalPixels);
  const queueModels = new Int16Array(totalPixels);
  let head = 0;
  let tail = 0;
  let originalTransparentPixels = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    if (originalRgba[pixel * 4 + 3] <= 8) {
      originalTransparentPixels += 1;
    }
  }

  const edgeBand = backgroundInfo.edgeBand || 1;
  const models = Array.isArray(backgroundInfo?.models) ? backgroundInfo.models : [];
  if (models.length === 0) {
    return {
      mask,
      assignedModels,
      removedPixels: 0,
      originalTransparentPixels,
      featheredPixels: 0,
      decontaminatedPixels: 0,
    };
  }

  const tryEnqueue = (pixelIndex, mode, preferredModelIndex = -1) => {
    if (pixelIndex < 0 || pixelIndex >= totalPixels) return;
    if (mask[pixelIndex] === 1) return;
    const match = findBestBackgroundMatch(matchRgba, pixelIndex, backgroundInfo, mode, preferredModelIndex);
    if (!match.matched) return;
    mask[pixelIndex] = 1;
    assignedModels[pixelIndex] = match.modelIndex;
    queue[tail] = pixelIndex;
    queueModels[tail] = match.modelIndex;
    tail += 1;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < edgeBand || y < edgeBand || x >= width - edgeBand || y >= height - edgeBand) {
        tryEnqueue(y * width + x, "seed");
      }
    }
  }

  while (head < tail) {
    const pixelIndex = queue[head];
    const preferredModelIndex = queueModels[head];
    head += 1;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    if (x > 0) tryEnqueue(pixelIndex - 1, "fill", preferredModelIndex);
    if (x + 1 < width) tryEnqueue(pixelIndex + 1, "fill", preferredModelIndex);
    if (y > 0) tryEnqueue(pixelIndex - width, "fill", preferredModelIndex);
    if (y + 1 < height) tryEnqueue(pixelIndex + width, "fill", preferredModelIndex);
  }

  let removedPixels = 0;
  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    if (mask[pixelIndex] !== 1) continue;
    const rgbaIndex = pixelIndex * 4;
    if (originalRgba[rgbaIndex + 3] > 0) {
      removedPixels += 1;
    }
    originalRgba[rgbaIndex] = 0;
    originalRgba[rgbaIndex + 1] = 0;
    originalRgba[rgbaIndex + 2] = 0;
    originalRgba[rgbaIndex + 3] = 0;
  }

  let featheredPixels = 0;
  let decontaminatedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (mask[pixelIndex] === 1) continue;
      const backgroundNeighborCount = countBackgroundNeighbors(mask, x, y, width, height);
      if (backgroundNeighborCount <= 0) continue;

      const rgbaIndex = pixelIndex * 4;
      const alpha = originalRgba[rgbaIndex + 3];
      if (alpha <= 0) continue;

      const match = findBestBackgroundMatch(matchRgba, pixelIndex, backgroundInfo, "feather");
      if (!match.matched) continue;

      const model = models[match.modelIndex];
      const distance = Math.sqrt(match.distanceSq);
      const featherThreshold = Math.sqrt(model.featherThresholdSq);
      const hardThreshold = Math.sqrt(model.thresholdSq);
      const range = Math.max(1, featherThreshold - hardThreshold);
      const normalized = clampNumber((distance - hardThreshold) / range, 0, 0, 1);
      const neighborFactor = clampNumber(
        normalized * (0.85 + (1 - backgroundNeighborCount / 8) * 0.35),
        normalized,
        0,
        1
      );
      const nextAlpha = Math.max(0, Math.min(255, Math.round(alpha * neighborFactor)));
      if (nextAlpha < alpha) {
        originalRgba[rgbaIndex + 3] = nextAlpha;
        featheredPixels += 1;
        if (decontaminateEdgePixel(originalRgba, rgbaIndex, model)) {
          decontaminatedPixels += 1;
        }
      }
    }
  }

  return {
    mask,
    assignedModels,
    removedPixels,
    originalTransparentPixels,
    featheredPixels,
    decontaminatedPixels,
  };
}

export async function removeRasterBackgroundWithLocalEdgeFlood({
  bytes,
  mimeType,
  fileName = "",
  maxSide = DEFAULT_MAX_SIDE,
} = {}) {
  const safeMimeType = normalizeMimeType(mimeType);
  if (!ALLOWED_RASTER_MIME_TYPES.has(safeMimeType)) {
    throw createUnsupportedImageTypeError("Only PNG and JPEG images are supported.");
  }

  const sharp = await loadSharp();

  try {
    const sourceMetadata = await sharp(bytes, {
      failOn: "none",
      limitInputPixels: false,
      sequentialRead: true,
    })
      .rotate()
      .metadata();
    const metadata = sourceMetadata;
    const sourceWidth = clampNumber(metadata?.width, 0, 0, 20000);
    const sourceHeight = clampNumber(metadata?.height, 0, 0, 20000);
    if (!sourceWidth || !sourceHeight) {
      throw createUnprocessableImageError("Could not decode image dimensions.");
    }

    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;
    const cappedSide = clampNumber(maxSide, DEFAULT_MAX_SIDE, 512, 4096);
    const longSide = Math.max(targetWidth, targetHeight);
    if (longSide > cappedSide) {
      const scale = cappedSide / longSide;
      targetWidth = Math.max(1, Math.round(targetWidth * scale));
      targetHeight = Math.max(1, Math.round(targetHeight * scale));
    }

    const targetPixels = targetWidth * targetHeight;
    if (targetPixels > MAX_PROCESSABLE_PIXELS) {
      const scale = Math.sqrt(MAX_PROCESSABLE_PIXELS / targetPixels);
      targetWidth = Math.max(1, Math.round(targetWidth * scale));
      targetHeight = Math.max(1, Math.round(targetHeight * scale));
    }

    const pipeline = sharp(bytes, {
      failOn: "none",
      limitInputPixels: false,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: true,
      });

    const blurSigma = clampNumber(Math.min(targetWidth, targetHeight) / 600, 1.4, 0.8, 2.2);
    const [{ data, info }, blurredData] = await Promise.all([
      pipeline.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      pipeline.clone().blur(blurSigma).ensureAlpha().raw().toBuffer(),
    ]);
    const originalRgba = new Uint8ClampedArray(data);
    const matchRgba = new Uint8ClampedArray(blurredData);
    const backgroundInfo = buildBackgroundModel(matchRgba, info.width, info.height);
    const removalResult = removeBackgroundFromRgba(
      originalRgba,
      matchRgba,
      info.width,
      info.height,
      backgroundInfo
    );
    const totalPixels = info.width * info.height;
    const transparentRatio = removalResult.originalTransparentPixels / Math.max(1, totalPixels);
    const removedRatio = removalResult.removedPixels / Math.max(1, totalPixels);
    const subjectPixels =
      totalPixels - removalResult.removedPixels - removalResult.originalTransparentPixels;

    if (removalResult.removedPixels >= Math.floor(totalPixels * 0.985)) {
      throw createUnprocessableImageError("Background removal removed too much of the image.");
    }

    if (subjectPixels <= Math.max(64, Math.floor(totalPixels * 0.0015))) {
      throw createUnprocessableImageError("Background removal left too little foreground detail.");
    }

    if (
      removalResult.removedPixels <= Math.max(32, Math.floor(totalPixels * 0.002)) &&
      removalResult.featheredPixels <= Math.max(18, Math.floor(totalPixels * 0.001)) &&
      transparentRatio < 0.05
    ) {
      throw createUnprocessableImageError("Could not detect a removable edge background.");
    }

    const outputBytes = await sharp(Buffer.from(originalRgba), {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
      limitInputPixels: false,
    })
      .png()
      .toBuffer();

    return {
      bytes: outputBytes,
      mimeType: "image/png",
      width: info.width,
      height: info.height,
      fileName: sanitizeOutputFileName(fileName),
      strategy: "raster-provider",
      provider: "local-edge-flood",
      removedBackground: removedRatio > 0 || transparentRatio > 0.05,
      stats: {
        modelCount: Array.isArray(backgroundInfo.models) ? backgroundInfo.models.length : 0,
        removedPixels: removalResult.removedPixels,
        featheredPixels: removalResult.featheredPixels,
        decontaminatedPixels: removalResult.decontaminatedPixels,
        nearWhiteRatio: backgroundInfo.nearWhiteRatio || 0,
        transparentRatio,
      },
    };
  } catch (error) {
    if (error?.name === "BackgroundRemovalError") {
      throw error;
    }
    throw createProcessingFailedError(
      error instanceof Error && error.message
        ? `Failed to process image: ${error.message}`
        : "Failed to process image."
    );
  }
}
