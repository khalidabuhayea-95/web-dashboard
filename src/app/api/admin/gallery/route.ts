import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import {
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Big enough for any dashboard use (template inputs, previews); uploads are
// normalised down to this on their longest edge so the library stays light.
const MAX_EDGE_PX = 2048;

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can view the gallery");
    }
    const images = await prisma.galleryImage.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ ok: true, images });
  } catch (error) {
    return handleApiError(error, "Failed to load the gallery");
  }
}

// Uploads one image into the library: EXIF-rotated, capped at 2048px on the
// longest edge, stored in the public bucket under gallery/.
export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can upload to the gallery");
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) return handleBadRequest("Invalid multipart form data");
    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) return handleBadRequest("Missing file upload");

    const mimeType = String(fileEntry.type || "").toLowerCase();
    const size = Number(fileEntry.size || 0);
    if (!mimeType.startsWith("image/")) return handleBadRequest("Only image files are allowed.");
    if (mimeType.includes("svg")) return handleBadRequest("SVG uploads are not allowed.");
    if (size <= 0) return handleBadRequest("The selected file is empty.");
    if (size > MAX_IMAGE_BYTES) return handleBadRequest("Image is too large (max 20 MB).");

    const keepPng = mimeType.includes("png");
    let body: Buffer;
    let meta: { width?: number; height?: number };
    try {
      const pipeline = sharp(Buffer.from(await fileEntry.arrayBuffer()))
        .rotate()
        .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: "inside", withoutEnlargement: true });
      body = await (keepPng ? pipeline.png() : pipeline.jpeg({ quality: 88 })).toBuffer();
      meta = await sharp(body).metadata();
    } catch (_error) {
      return handleBadRequest("That file could not be read as an image.");
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const key = `gallery/${yyyy}/${mm}/${uuid()}.${keepPng ? "png" : "jpg"}`;

    const uploaded = await uploadObject({
      bucket: BUCKET,
      key,
      body,
      contentType: keepPng ? "image/png" : "image/jpeg",
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

    const image = await prisma.galleryImage.create({
      data: {
        name: String(fileEntry.name || "").slice(0, 200),
        url,
        storageKey: key,
        width: meta.width ?? null,
        height: meta.height ?? null,
        sizeBytes: body.length,
        mimeType: keepPng ? "image/png" : "image/jpeg",
        createdByUserId: session.userId,
      },
    });

    logger.info("Gallery image uploaded", { userId: session.userId, key });
    return NextResponse.json({ ok: true, image }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to upload the image.");
  }
}
