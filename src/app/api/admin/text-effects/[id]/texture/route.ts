import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { getPublicStorageBucketName, uploadObject } from "@/lib/storage/objectStorage.server";
import {
  handleApiError,
  handleBadRequest,
  handleForbidden,
  handleNotFound,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { deleteStorageForUrls } from "@/lib/storage/assetReferences.server";
import { textEffectRowForBrowser } from "@/lib/textEffects/rows.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

// A texture is painted inside the glyphs at any size, so it needs real resolution —
// but nothing a phone draws needs more than 2048 px; the strip thumbnail far less.
const MAX_SIDE = { image: 2048, inlay: 2048, preview: 512 } as const;

const KINDS = ["image", "video", "preview", "inlay"] as const;
type UploadKind = (typeof KINDS)[number];

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Replaces one of an effect's files: the texture image, its looping clip, the inlay material, or the
// strip thumbnail. Upload and row update happen together, so the dashboard never
// points at a stored-but-unrecorded object; every upload mints a fresh key (the
// immutable cache header stays safe) and the superseded file is removed after.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can upload text effect textures");
    }

    const { id } = await params;
    const formData = await request.formData().catch(() => null);
    if (!formData) return handleBadRequest("Invalid multipart form data");

    const kind = String(formData.get("kind") || "").trim() as UploadKind;
    if (!KINDS.includes(kind)) {
      return handleBadRequest('Field "kind" must be "image", "video", "inlay" or "preview".');
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) return handleBadRequest("Missing file upload");
    const mimeType = String(fileEntry.type || "").toLowerCase();
    const size = Number(fileEntry.size || 0);
    if (size <= 0) return handleBadRequest("The selected file is empty.");

    const effect = await prisma.textEffect.findUnique({ where: { id } });
    if (!effect) return handleNotFound("Text effect");

    let body: Buffer;
    let contentType: string;
    let extension: string;

    if (kind === "video") {
      if (mimeType !== "video/mp4" && mimeType !== "video/webm") {
        return handleBadRequest("Only MP4 or WebM clips are allowed.");
      }
      if (size > MAX_VIDEO_BYTES) return handleBadRequest("Clip is too large (max 40 MB).");
      body = Buffer.from(await fileEntry.arrayBuffer());
      contentType = mimeType;
      extension = mimeType === "video/webm" ? "webm" : "mp4";
    } else {
      if (!mimeType.startsWith("image/")) return handleBadRequest("Only image files are allowed.");
      if (mimeType.includes("svg")) return handleBadRequest("SVG uploads are not allowed.");
      if (size > MAX_IMAGE_BYTES) return handleBadRequest("Image is too large (max 20 MB).");
      try {
        const source = Buffer.from(await fileEntry.arrayBuffer());
        const hasAlpha = Boolean((await sharp(source).metadata()).hasAlpha);
        const pipeline = sharp(source)
          .rotate()
          .resize(MAX_SIDE[kind], MAX_SIDE[kind], { fit: "inside", withoutEnlargement: true });
        // Lossless where there is transparency (a glitter overlay is all alpha edges);
        // a photographic material keeps near-lossless quality at a fraction of the size.
        body = hasAlpha
          ? await pipeline.webp({ lossless: true }).toBuffer()
          : await pipeline.webp({ quality: 92 }).toBuffer();
      } catch (_error) {
        return handleBadRequest("That file could not be read as an image.");
      }
      contentType = "image/webp";
      extension = "webp";
    }

    const uploaded = await uploadObject({
      bucket: BUCKET,
      key: `text-effects/${effect.slug}-${kind}-${uuid()}.${extension}`,
      body,
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    const url = String(uploaded.url || "").trim();
    if (!url) {
      return handleApiError(
        new Error("Public URL unavailable"),
        "Upload succeeded but the file URL is unavailable.",
        500
      );
    }

    const column =
      kind === "image"
        ? "textureUrl"
        : kind === "video"
          ? "textureVideoUrl"
          : kind === "inlay"
            ? "inlayTextureUrl"
            : "previewUrl";
    const previous = effect[column];
    const updated = await prisma.textEffect.update({ where: { id }, data: { [column]: url } });
    if (previous && previous !== url) {
      await deleteStorageForUrls([previous], { slug: effect.slug, kind });
    }

    logger.info("Text effect file replaced", { userId: session.userId, slug: effect.slug, kind });
    return NextResponse.json({ ok: true, effect: textEffectRowForBrowser(updated) });
  } catch (error) {
    return handleApiError(error, "Failed to upload the text effect file.");
  }
}
