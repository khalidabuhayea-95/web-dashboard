import { normalizeHexColor } from "@/lib/editor/svgColors";

function asString(value: unknown) {
  return String(value || "").trim();
}

function toHex(value: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function decodeQuantizedColor(binKey: string) {
  const packed = Number(binKey);
  const r = ((packed >> 8) & 0x0f) * 17;
  const g = ((packed >> 4) & 0x0f) * 17;
  const b = (packed & 0x0f) * 17;
  return [r, g, b] as [number, number, number];
}

async function loadImage(source: string) {
  if (typeof Image === "undefined") {
    throw new Error("Image API is unavailable in this environment.");
  }

  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      (image as HTMLImageElement & { __loaded?: boolean }).__loaded = true;
      resolve();
    };
    image.onerror = () => reject(new Error("Failed to load image source."));
    image.src = source;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      resolve();
    }
    (loadImage as unknown as { currentImage?: HTMLImageElement }).currentImage = image;
  });

  const image = (loadImage as unknown as { currentImage?: HTMLImageElement }).currentImage;
  if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("Invalid image dimensions.");
  }
  return image;
}

export async function extractImagePaletteFromSource(sourceInput: string, maxColors = 8) {
  const source = asString(sourceInput);
  if (!source) return [];
  if (typeof document === "undefined") return [];

  const image = await loadImage(source);
  const sampleSide = 72;
  const width = Math.max(1, Math.min(sampleSide, image.naturalWidth));
  const height = Math.max(1, Math.min(sampleSide, image.naturalHeight));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const bins = new Map<string, number>();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 24) continue;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    const qr = Math.round(r / 17) & 0x0f;
    const qg = Math.round(g / 17) & 0x0f;
    const qb = Math.round(b / 17) & 0x0f;
    const packed = (qr << 8) | (qg << 4) | qb;
    const key = String(packed);
    bins.set(key, (bins.get(key) || 0) + 1);
  }

  if (bins.size === 0) return [];

  const candidates = Array.from(bins.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([binKey]) => decodeQuantizedColor(binKey));

  const picked: Array<[number, number, number]> = [];
  const minDistance = 24;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const isDuplicate = picked.some((existing) => colorDistance(existing, candidate) < minDistance);
    if (isDuplicate) continue;
    picked.push(candidate);
    if (picked.length >= maxColors) break;
  }

  const normalized = picked
    .map(([r, g, b]) => normalizeHexColor(rgbToHex(r, g, b)))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(normalized));
}
