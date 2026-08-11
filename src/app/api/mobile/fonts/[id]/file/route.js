import { NextResponse } from "next/server";

import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { createLogger } from "@/lib/logging/logger";
import { getObject } from "@/lib/storage/objectStorage.server";
import {
  buildFontFileKind,
  FONT_FILE_KIND_MOBILE,
  FONT_FILE_KIND_ORIGINAL,
  getFontFamilyById,
  isMobileCompatibleFontFile,
  normalizeFontStyleValue,
  normalizeFontWeightValue,
  resolvePreferredFontFile,
} from "@/lib/editor/fontStorage.server";

export const runtime = "nodejs";
const logger = createLogger("api.mobile.font-file");

/**
 * Picks the file for the requested `?variant=` (e.g. "700", "400i"), falling back to the family's
 * default face when the parameter is absent or that weight was never imported — a missing weight
 * should still render something rather than 404.
 */
function resolveRequestedFontFile(font, request) {
  let requested = "";
  try {
    requested = String(new URL(request.url).searchParams.get("variant") || "").trim().toLowerCase();
  } catch (_error) {
    requested = "";
  }
  const match = requested.match(/^(\d{2,3})(i)?$/);
  if (!match) return resolvePreferredFontFile(font);
  const weight = normalizeFontWeightValue(match[1]);
  const style = normalizeFontStyleValue(match[2] ? "italic" : "normal");
  const files = Array.isArray(font?.files) ? font.files : [];
  for (const baseKind of [FONT_FILE_KIND_MOBILE, FONT_FILE_KIND_ORIGINAL]) {
    const kind = buildFontFileKind(baseKind, weight, style);
    const hit = files.find((file) => String(file?.kind || "").toLowerCase() === kind);
    if (hit) return hit;
  }
  return resolvePreferredFontFile(font);
}

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

    // `?variant=700` / `?variant=400i` serves a specific weight/style of the family; without it
    // the caller gets the default face, exactly as before. The editor asks per @font-face so a
    // design using several weights of one family renders each in its REAL cut.
    const file = resolveRequestedFontFile(font, request);
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

    const bucket = String(file.storageBucket || "").trim();
    const key = String(file.storagePath || "").trim();
    const mimeType = normalizeMimeType(file.mimeType) || canonicalMimeForFormat(format);
    const fileName =
      sanitizeFileName(file.fileName || font.family || `font.${format}`) || `font.${format}`;

    if (!bucket || !key) {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Font data is unavailable.", fileName, mimeType }, { status: 404 }),
        requestId
      );
    }

    // Stream the file from R2 through this origin rather than 307-redirecting to
    // the public bucket URL. Some networks (e.g. FortiGuard web filtering) block
    // the public *.r2.dev host, which breaks @font-face loading in the editor.
    // The server reaches R2 via the S3 API endpoint, so proxying the bytes keeps
    // fonts working regardless of client-side egress filtering.
    let object;
    try {
      object = await getObject(bucket, key);
    } catch (storageError) {
      requestLogger.error("Failed to read font object from storage", { bucket, key }, storageError);
      return attachRequestIdHeader(
        NextResponse.json({ error: "Font data is unavailable.", fileName, mimeType }, { status: 502 }),
        requestId
      );
    }

    const bytes = await object.Body.transformToByteArray();
    const body = Buffer.from(bytes);
    const response = new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": object.ContentType || mimeType,
        "Content-Length": String(body.length),
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
    return attachRequestIdHeader(response, requestId);
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
