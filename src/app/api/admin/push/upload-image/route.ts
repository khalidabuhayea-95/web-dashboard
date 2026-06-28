import { NextRequest, NextResponse } from "next/server";

import {
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requirePushAdmin } from "../_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = getPublicStorageBucketName();
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function extensionFromMime(mimeType: string): string {
  const value = mimeType.toLowerCase();
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  return "img";
}

function uuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Uploads a notification image to the public R2 bucket and returns its absolute
// public URL — FCM (and the device) fetch the image by URL, so it must be a
// real public URL, not the in-app proxy path.
export async function POST(request: NextRequest) {
  const auth = await requirePushAdmin(request, "upload-image", { limit: 30 });
  if ("error" in auth) return auth.error;

  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) return handleBadRequest("Invalid multipart form data");

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) return handleBadRequest("Missing file upload");

    const mimeType = String(fileEntry.type || "").toLowerCase();
    const size = Number(fileEntry.size || 0);
    if (!mimeType.startsWith("image/")) return handleBadRequest("Only image files are allowed.");
    if (size <= 0) return handleBadRequest("The selected file is empty.");
    if (size > MAX_IMAGE_BYTES) return handleBadRequest("Image is too large (max 5 MB).");

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const key = `push/notifications/${yyyy}/${mm}/${uuid()}.${extensionFromMime(mimeType)}`;
    const body = Buffer.from(await fileEntry.arrayBuffer());

    const uploaded = await uploadObject({
      bucket: BUCKET,
      key,
      body,
      contentType: mimeType,
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

    logger.info("Push notification image uploaded", { userId: auth.session.userId, size });
    return NextResponse.json({ url, bucket: BUCKET, key, size, mimeType });
  } catch (error) {
    return handleApiError(error, "Failed to upload image.");
  }
}
