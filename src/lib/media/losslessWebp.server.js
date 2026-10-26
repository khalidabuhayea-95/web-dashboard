/**
 * PNG → lossless WebP for element images.
 *
 * Lossless keeps every pixel and the alpha channel exactly (the only bytes that change are the
 * colours of fully transparent pixels, which nothing ever shows). A sample of the element library
 * shrank 52% (Freepik icons) and 43% (Canva images). GIFs, animated images, and anything that is
 * not a PNG are left alone, and so is a PNG whose WebP would not be smaller.
 */

let sharpPromise = null;
async function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import("sharp").then((module) => module.default || module);
  }
  return sharpPromise;
}

export const LOSSLESS_WEBP_OPTIONS = Object.freeze({ lossless: true, effort: 6 });

/**
 * @param {Buffer | Uint8Array} bytes
 * @returns {Promise<{ bytes: Buffer, mimeType: string, converted: boolean, reason?: string }>}
 */
export async function convertPngToLosslessWebp(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (input.length === 0) return { bytes: input, mimeType: "", converted: false, reason: "empty" };
  try {
    const sharp = await loadSharp();
    const metadata = await sharp(input, { limitInputPixels: false }).metadata();
    if (String(metadata?.format || "").toLowerCase() !== "png") {
      return { bytes: input, mimeType: "", converted: false, reason: "not-png" };
    }
    // An animated PNG keeps its frames only as a PNG.
    if (Number(metadata?.pages || 1) > 1) {
      return { bytes: input, mimeType: "image/png", converted: false, reason: "animated" };
    }
    const webp = await sharp(input, { limitInputPixels: false }).webp(LOSSLESS_WEBP_OPTIONS).toBuffer();
    if (!(webp.length > 0) || webp.length >= input.length) {
      return { bytes: input, mimeType: "image/png", converted: false, reason: "not-smaller" };
    }
    return { bytes: webp, mimeType: "image/webp", converted: true };
  } catch (error) {
    return {
      bytes: input,
      mimeType: "",
      converted: false,
      reason: `failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
