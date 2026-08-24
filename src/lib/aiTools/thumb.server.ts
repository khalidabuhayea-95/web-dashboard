// Grid-sized card art, shared by the AI-template and magic-tool admin routes.
//
// The mobile catalogue lists 200+ cards. The full-size art is 1024px and
// averages ~140 KB, so listing it directly is a ~30 MB tab on mobile data — the
// app reads `thumbUrl` in list views and only fetches `afterUrl` when a tool is
// opened. Every path that writes an after image must therefore write a
// thumbnail too, or that card silently falls back to the heavy version.

import sharp from "sharp";
import { getPublicStorageBucketName, uploadObject } from "@/lib/storage/objectStorage.server";

export const CARD_THUMB_WIDTH = 400;

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Publishes a 400px copy of `source` and returns its public URL, or null if the
 * thumbnail could not be produced — a missing thumbnail degrades to the
 * full-size image in the API, so it must never fail the surrounding request.
 */
export async function publishCardThumb(
  source: Buffer,
  keyPrefix: string,
  slug: string
): Promise<string | null> {
  try {
    // A cut-out's alpha channel is the result; flattening it would make the
    // thumbnail advertise the opposite of what the tool does.
    const keepAlpha = Boolean((await sharp(source).metadata()).hasAlpha);
    const pipeline = sharp(source).resize(CARD_THUMB_WIDTH, null, { withoutEnlargement: true });
    const body = keepAlpha
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.jpeg({ quality: 72, mozjpeg: true }).toBuffer();

    const uploaded = await uploadObject({
      bucket: getPublicStorageBucketName(),
      key: `${keyPrefix}/${slug}-thumb-${uuid()}.${keepAlpha ? "png" : "jpg"}`,
      body,
      contentType: keepAlpha ? "image/png" : "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    return String(uploaded.url || "").trim() || null;
  } catch (_error) {
    return null;
  }
}
