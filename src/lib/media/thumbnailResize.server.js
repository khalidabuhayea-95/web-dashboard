const THUMBNAIL_RESIZE_SCALE = 0.5;
const THUMBNAIL_MIN_DIMENSION = 32;

let canvasLibPromise = null;

function normalizeMimeType(value) {
  return String(value || "image/png")
    .trim()
    .toLowerCase();
}

function shouldResizeMimeType(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized.startsWith("image/")) return false;
  if (normalized.includes("svg")) return false;
  return true;
}

function preferredOutputMimeType(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "image/jpeg";
  if (normalized.includes("webp")) return "image/webp";
  return "image/png";
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

function parseDataUri(dataUrl) {
  const source = String(dataUrl || "").trim();
  const match = source.match(/^data:([^;,]+)?((?:;[^;,=]+=[^;,]+)*)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  if (!match[3]) return null;

  const mimeType = normalizeMimeType(match[1] || "image/png");
  const payload = String(match[4] || "");
  if (!payload) return null;

  try {
    return {
      mimeType,
      bytes: Buffer.from(payload, "base64"),
    };
  } catch (_error) {
    return null;
  }
}

export async function resizeThumbnailBufferHalf({ bytes, mimeType }) {
  const inputBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const inputMimeType = normalizeMimeType(mimeType);

  if (inputBytes.length === 0 || !shouldResizeMimeType(inputMimeType)) {
    return { bytes: inputBytes, mimeType: inputMimeType, resized: false };
  }

  const canvasLib = await getCanvasLib();
  if (!canvasLib?.createCanvas || !canvasLib?.loadImage) {
    return { bytes: inputBytes, mimeType: inputMimeType, resized: false };
  }

  const sourceDataUrl = `data:${inputMimeType};base64,${inputBytes.toString("base64")}`;

  try {
    const image = await canvasLib.loadImage(sourceDataUrl);
    const sourceWidth = Math.max(1, Math.round(Number(image?.width || 1)));
    const sourceHeight = Math.max(1, Math.round(Number(image?.height || 1)));
    const targetWidth = Math.max(THUMBNAIL_MIN_DIMENSION, Math.round(sourceWidth * THUMBNAIL_RESIZE_SCALE));
    const targetHeight = Math.max(THUMBNAIL_MIN_DIMENSION, Math.round(sourceHeight * THUMBNAIL_RESIZE_SCALE));

    if (targetWidth >= sourceWidth && targetHeight >= sourceHeight) {
      return { bytes: inputBytes, mimeType: inputMimeType, resized: false };
    }

    const canvas = canvasLib.createCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    let outputMimeType = preferredOutputMimeType(inputMimeType);
    let outputBytes;
    try {
      if (outputMimeType === "image/jpeg" || outputMimeType === "image/webp") {
        outputBytes = canvas.toBuffer(outputMimeType, { quality: 0.82 });
      } else {
        outputBytes = canvas.toBuffer(outputMimeType);
      }
    } catch (_bufferError) {
      outputMimeType = "image/png";
      outputBytes = canvas.toBuffer("image/png");
    }

    if (!outputBytes || outputBytes.length === 0) {
      return { bytes: inputBytes, mimeType: inputMimeType, resized: false };
    }

    return {
      bytes: outputBytes,
      mimeType: outputMimeType,
      resized: true,
      sourceWidth,
      sourceHeight,
      width: targetWidth,
      height: targetHeight,
    };
  } catch (_error) {
    return { bytes: inputBytes, mimeType: inputMimeType, resized: false };
  }
}

export async function resizeThumbnailDataUrlHalf(value) {
  const source = String(value || "").trim();
  if (!source.startsWith("data:image/")) return source;

  const parsed = parseDataUri(source);
  if (!parsed || parsed.bytes.length === 0) return source;

  const resized = await resizeThumbnailBufferHalf({
    bytes: parsed.bytes,
    mimeType: parsed.mimeType,
  });

  if (!resized.resized || !resized.bytes || resized.bytes.length === 0) {
    return source;
  }

  return `data:${resized.mimeType};base64,${resized.bytes.toString("base64")}`;
}
