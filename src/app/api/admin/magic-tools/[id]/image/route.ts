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
import { publishCardThumb } from "@/lib/aiTools/thumb.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// Match the widths the seed script publishes, so hand-replaced art and batch
// rendered art stay visually consistent.
const TARGET_WIDTH = { before: 640, after: 1024 } as const;

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Replaces one side of a tool's before/after pair. The upload and the row
// update happen together so the dashboard can never end up pointing at an
// object that was stored but never recorded. Each upload gets a fresh key, so
// the URL always changes and the immutable cache header stays safe.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can replace magic tool art");
    }

    const { id } = await params;

    const formData = await request.formData().catch(() => null);
    if (!formData) return handleBadRequest("Invalid multipart form data");

    const kind = String(formData.get("kind") || "").trim();
    if (kind !== "before" && kind !== "after") {
      return handleBadRequest('Field "kind" must be "before" or "after".');
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) return handleBadRequest("Missing file upload");

    const mimeType = String(fileEntry.type || "").toLowerCase();
    const size = Number(fileEntry.size || 0);
    if (!mimeType.startsWith("image/")) return handleBadRequest("Only image files are allowed.");
    if (mimeType.includes("svg")) return handleBadRequest("SVG image uploads are not allowed.");
    if (size <= 0) return handleBadRequest("The selected file is empty.");
    if (size > MAX_IMAGE_BYTES) return handleBadRequest("Image is too large (max 15 MB).");

    const tool = await prisma.magicTool.findUnique({ where: { id } });
    if (!tool) return handleNotFound("Magic tool");

    // A cut-out result is only meaningful with its alpha channel, so a
    // transparent upload stays PNG instead of being flattened onto black.
    let body: Buffer;
    let keepAlpha = false;
    try {
      const source = Buffer.from(await fileEntry.arrayBuffer());
      keepAlpha = Boolean((await sharp(source).metadata()).hasAlpha);
      const pipeline = sharp(source)
        .rotate()
        .resize(TARGET_WIDTH[kind], null, { withoutEnlargement: true });
      body = keepAlpha
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : await pipeline.jpeg({ quality: 82 }).toBuffer();
    } catch (_error) {
      return handleBadRequest("That file could not be read as an image.");
    }

    const uploaded = await uploadObject({
      bucket: BUCKET,
      key: `magic-tools/${tool.slug}-${kind}-${uuid()}.${keepAlpha ? "png" : "jpg"}`,
      body,
      contentType: keepAlpha ? "image/png" : "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    const url = String(uploaded.url || "").trim();
    if (!url) {
      return handleApiError(
        new Error("Public URL unavailable"),
        "Upload succeeded but the image URL is unavailable.",
        500,
      );
    }

    // Replacing the after image invalidates its thumbnail, so rebuild it in
    // the same step; the before image has no thumbnail.
    const thumbUrl = kind === "after" ? await publishCardThumb(body, "magic-tools", tool.slug) : null;

    const updated = await prisma.magicTool.update({
      where: { id },
      data: kind === "before" ? { beforeUrl: url } : { afterUrl: url, thumbUrl },
    });

    logger.info("Magic tool art replaced", { userId: session.userId, slug: tool.slug, kind });
    return NextResponse.json({ ok: true, tool: updated });
  } catch (error) {
    return handleApiError(error, "Failed to replace magic tool art.");
  }
}
