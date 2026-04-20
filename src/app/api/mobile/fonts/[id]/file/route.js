import { NextResponse } from "next/server";

import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { createLogger } from "@/lib/logging/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFontFamilyById,
  isMobileCompatibleFontFile,
  resolvePreferredFontFile,
} from "@/lib/editor/fontStorage.server";

export const runtime = "nodejs";
const logger = createLogger("api.mobile.font-file");

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalMimeForFormat(format) {
  if (format === "ttf") return "font/ttf";
  if (format === "otf") return "font/otf";
  if (format === "ttc") return "font/ttc";
  return "application/octet-stream";
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function unsupportedFormatResponse(requestId, format, mimeType) {
  return attachRequestIdHeader(
    NextResponse.json(
      {
        error: "Font format is not supported on mobile.",
        format: String(format || "unknown").trim().toLowerCase() || "unknown",
        mimeType: normalizeMimeType(mimeType || "") || null,
        supportedFormats: ["ttf", "otf", "ttc"],
      },
      { status: 415 }
    ),
    requestId
  );
}

function getStoragePublicUrl(file) {
  const bucket = String(file?.storageBucket || "").trim();
  const path = String(file?.storagePath || "").trim();
  if (!bucket || !path) return "";

  const admin = createAdminClient();
  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  return String(data?.publicUrl || "").trim();
}

export async function GET(request, { params }) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  try {
    const resolvedParams = await params;
    const fontId = String(resolvedParams?.id || "").trim();
    if (!fontId) {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Missing font id." }, { status: 400 }),
        requestId
      );
    }

    const font = await getFontFamilyById(fontId);
    if (!font) {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Font not found." }, { status: 404 }),
        requestId
      );
    }

    const file = resolvePreferredFontFile(font);
    if (!file) {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Font data is unavailable." }, { status: 404 }),
        requestId
      );
    }

    const format = String(file.format || "").trim().toLowerCase();
    if (!isMobileCompatibleFontFile(file)) {
      return unsupportedFormatResponse(requestId, format, file.mimeType);
    }

    const fileUrl = String(file.publicUrl || "").trim() || getStoragePublicUrl(file);
    if (fileUrl) {
      const response = NextResponse.redirect(fileUrl, 307);
      response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return attachRequestIdHeader(response, requestId);
    }

    const fileName =
      sanitizeFileName(file.fileName || font.family || `font.${format}`) || `font.${format}`;
    return attachRequestIdHeader(
      NextResponse.json(
        {
          error: "Font data is unavailable.",
          fileName,
          mimeType: normalizeMimeType(file.mimeType) || canonicalMimeForFormat(format),
        },
        { status: 404 }
      ),
      requestId
    );
  } catch (error) {
    requestLogger.error("Failed to resolve font file", {}, error);
    return attachRequestIdHeader(
      NextResponse.json(
        {
          error: "Failed to resolve font file.",
        },
        { status: 500 }
      ),
      requestId
    );
  }
}
