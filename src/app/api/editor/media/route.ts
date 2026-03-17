import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET_NAME = process.env.EDITOR_MEDIA_BUCKET || "editor-media";
const MEDIA_UPLOAD_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_FONT_BYTES = 10 * 1024 * 1024;
const ALLOWED_FONT_MIME_TYPES = new Set([
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/vnd.ms-fontobject",
]);
const ALLOWED_FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2", "eot"]);

function sanitizeKind(value: unknown): "image" | "video" | "font" | "" {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "image" || kind === "video" || kind === "font") return kind;
  return "";
}

function sanitizeFileName(value: unknown): string {
  const source = String(value || "").trim();
  const withoutPath = source.replace(/^.*[\\/]/, "");
  return withoutPath.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function normalizeMimeType(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function extensionFromMimeType(mimeType: string): string {
  const value = normalizeMimeType(mimeType);
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  if (value.includes("x-matroska")) return "mkv";
  if (value.includes("woff2")) return "woff2";
  if (value.includes("woff")) return "woff";
  if (value.includes("otf")) return "otf";
  if (value.includes("ttf")) return "ttf";
  if (value.includes("ms-fontobject")) return "eot";
  return "";
}

function extensionFromFileName(fileName: unknown): string {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1] || "";
}

function mimeTypeFromExtension(extension: unknown): string {
  const value = String(extension || "").trim().toLowerCase();
  if (value === "ttf") return "font/ttf";
  if (value === "otf") return "font/otf";
  if (value === "woff") return "font/woff";
  if (value === "woff2") return "font/woff2";
  if (value === "eot") return "application/vnd.ms-fontobject";
  return "";
}

function ensureValidUpload({
  kind,
  mimeType,
  size,
  extension,
}: {
  kind: string;
  mimeType: string;
  size: number;
  extension: string;
}): void {
  if (kind === "image") {
    if (!mimeType.startsWith("image/")) {
      throw new Error("Only image files are allowed for image uploads.");
    }
    if (size > MAX_IMAGE_BYTES) {
      throw new Error("Image file is too large.");
    }
    return;
  }

  if (kind === "video") {
    if (!mimeType.startsWith("video/")) {
      throw new Error("Only video files are allowed for video uploads.");
    }
    if (size > MAX_VIDEO_BYTES) {
      throw new Error("Video file is too large.");
    }
    return;
  }

  if (kind === "font") {
    const safeExtension = String(extension || "").trim().toLowerCase();
    if (!ALLOWED_FONT_MIME_TYPES.has(mimeType) && !ALLOWED_FONT_EXTENSIONS.has(safeExtension)) {
      throw new Error("Unsupported font file type.");
    }
    if (size > MAX_FONT_BYTES) {
      throw new Error("Font file is too large.");
    }
    return;
  }

  throw new Error("Invalid upload kind.");
}

async function ensurePublicBucket(admin: any): Promise<void> {
  const { data, error } = await admin.storage.getBucket(BUCKET_NAME);
  if (error) {
    const create = await admin.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: `${MAX_VIDEO_BYTES}`,
    });
    if (create.error && !String(create.error.message || "").toLowerCase().includes("exists")) {
      throw create.error;
    }
    return;
  }
  if (data && data.public === false) {
    await admin.storage.updateBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: `${MAX_VIDEO_BYTES}`,
    });
  }
}

function makeObjectPath({
  ownerId,
  kind,
  fileName,
  extension,
}: {
  ownerId: string;
  kind: string;
  fileName: string;
  extension: string;
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeBase = sanitizeFileName(fileName).replace(/\.[^.]+$/, "") || kind;
  const ext = extension || "bin";
  const uniqueId =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `users/${ownerId}/${kind}/${yyyy}/${mm}/${dd}/${safeBase}-${uniqueId}.${ext}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:media:upload",
      identifier: session.userId || resolveRequestIp(request),
      limit: MEDIA_UPLOAD_LIMIT.limit,
      windowMs: MEDIA_UPLOAD_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many media uploads. Please retry shortly.",
        rateLimitState
      );
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return handleBadRequest("Invalid multipart form data");
    }

    const kind = sanitizeKind(formData.get("kind"));
    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return handleBadRequest("Missing file upload");
    }

    const mimeType = normalizeMimeType(fileEntry.type);
    const fileSize = Number(fileEntry.size || 0);
    if (!kind || fileSize <= 0) {
      return handleBadRequest("Invalid upload payload");
    }

    const fileName = sanitizeFileName(fileEntry.name) || `${kind}.bin`;
    const extension = extensionFromMimeType(mimeType) || extensionFromFileName(fileName);
    const resolvedMimeType = mimeType || mimeTypeFromExtension(extension);

    try {
      ensureValidUpload({ kind, mimeType: resolvedMimeType, size: fileSize, extension });
    } catch (error) {
      return handleBadRequest(
        error instanceof Error ? error.message : "Invalid upload"
      );
    }

    const path = makeObjectPath({
      ownerId: session.userId,
      kind,
      fileName,
      extension,
    });

    const admin = createAdminClient();
    try {
      await ensurePublicBucket(admin);
    } catch (error) {
      return handleApiError(error, "Failed to prepare media storage bucket", 500);
    }

    const { error: uploadError } = await admin.storage.from(BUCKET_NAME).upload(path, fileEntry, {
      cacheControl: "31536000",
      contentType: resolvedMimeType || "application/octet-stream",
      upsert: false,
    });

    if (uploadError) {
      return handleApiError(uploadError, "Failed to upload media", 422);
    }

    const { data: publicUrlData } = admin.storage.from(BUCKET_NAME).getPublicUrl(path);
    const url = String(publicUrlData?.publicUrl || "").trim();
    if (!url) {
      return handleApiError(
        new Error("Media URL unavailable"),
        "Upload succeeded but media URL is unavailable",
        500
      );
    }

    logger.info("Media uploaded", {
      userId: session.userId,
      kind,
      size: fileSize,
    });

    return NextResponse.json({
      kind,
      bucket: BUCKET_NAME,
      path,
      url,
    });
  } catch (error) {
    return handleApiError(error, "Failed to upload media");
  }
}
