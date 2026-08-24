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
import { magicToolModelIncompatibility } from "@/lib/magicTools/models";
import { runMagicTool } from "@/lib/magicTools/run.server";

export const runtime = "nodejs";
// The model itself can take minutes on a cold start; match the media routes.
export const maxDuration = 300;

const BUCKET = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Runs the tool's own model + settings to produce its card art. The before
// image comes from a direct upload or a gallery pick (tools snapshot the bytes,
// they never link to gallery rows). Both card images update in one step, so the
// pair can never show a before that did not produce the after.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can generate magic tool art");
    }

    const { id } = await params;
    const tool = await prisma.magicTool.findUnique({ where: { id } });
    if (!tool) return handleNotFound("Magic tool");

    const incompatibility = magicToolModelIncompatibility(tool.model, tool.prompt);
    if (incompatibility) return handleBadRequest(incompatibility);

    const formData = await request.formData().catch(() => null);
    if (!formData) return handleBadRequest("Invalid multipart form data");

    const fileEntry = formData.get("file");
    const galleryImageId = String(formData.get("galleryImageId") || "").trim();
    let inputBuffer: Buffer | null = null;

    if (fileEntry instanceof File) {
      const mimeType = String(fileEntry.type || "").toLowerCase();
      const size = Number(fileEntry.size || 0);
      if (!mimeType.startsWith("image/")) return handleBadRequest("Only image files are allowed.");
      if (mimeType.includes("svg")) return handleBadRequest("SVG uploads are not allowed.");
      if (size <= 0) return handleBadRequest("The selected file is empty.");
      if (size > MAX_IMAGE_BYTES) return handleBadRequest("Image is too large (max 20 MB).");
      inputBuffer = Buffer.from(await fileEntry.arrayBuffer());
    } else if (galleryImageId) {
      const galleryImage = await prisma.galleryImage.findUnique({ where: { id: galleryImageId } });
      if (!galleryImage) return handleBadRequest("That gallery image no longer exists");
      const imageResponse = await fetch(galleryImage.url);
      if (!imageResponse.ok) return handleBadRequest("The gallery image could not be downloaded.");
      inputBuffer = Buffer.from(await imageResponse.arrayBuffer());
    } else {
      return handleBadRequest("Upload a photo or pick one from the gallery.");
    }

    // Normalise the input like the batch renderer does: EXIF-rotated, 1024px,
    // JPEG — keeps provider payloads small and befores consistent.
    let normalizedInput: Buffer;
    try {
      normalizedInput = await sharp(inputBuffer)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch (_error) {
      return handleBadRequest("That file could not be read as an image.");
    }

    const result = await runMagicTool({
      modelId: tool.model,
      prompt: tool.prompt,
      modelOptions: tool.modelOptions,
      imageBuffer: normalizedInput,
      imageMime: "image/jpeg",
    });

    // A cut-out's alpha channel IS the result, so transparent output stays PNG;
    // everything else compresses to JPEG like the rest of the card art.
    const resultMeta = await sharp(result.buffer).metadata();
    const keepAlpha = Boolean(resultMeta.hasAlpha);
    const afterPipeline = sharp(result.buffer).resize(1024, null, { withoutEnlargement: true });
    const afterBody = keepAlpha
      ? await afterPipeline.png({ compressionLevel: 9 }).toBuffer()
      : await afterPipeline.jpeg({ quality: 82 }).toBuffer();

    const afterUpload = await uploadObject({
      bucket: BUCKET,
      key: `magic-tools/${tool.slug}-after-${uuid()}.${keepAlpha ? "png" : "jpg"}`,
      body: afterBody,
      contentType: keepAlpha ? "image/png" : "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    const afterUrl = String(afterUpload.url || "").trim();
    if (!afterUrl) {
      return handleApiError(
        new Error("Public URL unavailable"),
        "Render succeeded but the image URL is unavailable.",
        500,
      );
    }

    const thumbUrl = await publishCardThumb(afterBody, "magic-tools", tool.slug);

    const beforeBody = await sharp(normalizedInput)
      .resize(640, null, { withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const beforeUpload = await uploadObject({
      bucket: BUCKET,
      key: `magic-tools/${tool.slug}-before-${uuid()}.jpg`,
      body: beforeBody,
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    const beforeUrl = String(beforeUpload.url || "").trim() || null;

    const updated = await prisma.magicTool.update({
      where: { id },
      data: { afterUrl, beforeUrl, thumbUrl },
    });

    logger.info("Magic tool art generated", {
      userId: session.userId,
      slug: tool.slug,
      model: result.model,
      predictionId: result.predictionId,
    });
    return NextResponse.json({ ok: true, tool: updated });
  } catch (error) {
    return handleApiError(error, "Failed to generate the tool art.");
  }
}
