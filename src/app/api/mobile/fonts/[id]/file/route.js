import { NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import {
  getEditorCustomFonts,
  resolveEditorCustomFontMobileVariant,
  resolveEditorCustomFontSourceVariant,
} from "@/lib/editor/customFonts.server";
import { getEditorSyncedFonts } from "@/lib/editor/syncedFonts.server";

export const runtime = "nodejs";
const logger = createLogger("api.mobile.font-file");

const DATA_URI_PATTERN = /^data:([^;,]+);base64,(.+)$/i;
const MOBILE_SUPPORTED_FONT_FORMATS = new Set(["ttf", "otf", "ttc"]);

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function inferFormatFromMimeType(value) {
  const mimeType = normalizeMimeType(value);
  if (!mimeType) return "";
  if (
    mimeType === "font/ttf" ||
    mimeType === "application/x-font-ttf" ||
    mimeType === "application/font-sfnt"
  ) {
    return "ttf";
  }
  if (mimeType === "font/otf" || mimeType === "application/x-font-otf") {
    return "otf";
  }
  if (
    mimeType === "font/ttc" ||
    mimeType === "application/x-font-ttc" ||
    mimeType === "font/collection"
  ) {
    return "ttc";
  }
  if (mimeType === "font/woff" || mimeType === "application/font-woff") {
    return "woff";
  }
  if (mimeType === "font/woff2") {
    return "woff2";
  }
  if (mimeType === "application/vnd.ms-fontobject") {
    return "eot";
  }
  return "";
}

function inferFormatFromName(value) {
  const source = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "");
  if (!source) return "";
  if (source.endsWith(".ttf")) return "ttf";
  if (source.endsWith(".otf")) return "otf";
  if (source.endsWith(".ttc")) return "ttc";
  if (source.endsWith(".woff2")) return "woff2";
  if (source.endsWith(".woff")) return "woff";
  if (source.endsWith(".eot")) return "eot";
  return "";
}

function canonicalMimeForFormat(format) {
  if (format === "ttf") return "font/ttf";
  if (format === "otf") return "font/otf";
  if (format === "ttc") return "font/ttc";
  if (format === "woff") return "font/woff";
  if (format === "woff2") return "font/woff2";
  if (format === "eot") return "application/vnd.ms-fontobject";
  return "application/octet-stream";
}

function resolveFontFormat(font, fallbackMimeType = "") {
  const sourceMimeType = normalizeMimeType(
    font?.mimeType || fallbackMimeType || ""
  );
  const fromMimeType = inferFormatFromMimeType(sourceMimeType);
  if (fromMimeType) return { format: fromMimeType, sourceMimeType };

  const fromFileName = inferFormatFromName(font?.fileName);
  if (fromFileName) return { format: fromFileName, sourceMimeType };

  const fromFileUrl = inferFormatFromName(font?.fileUrl);
  if (fromFileUrl) return { format: fromFileUrl, sourceMimeType };

  const fromDataUrl = inferFormatFromMimeType(
    String(font?.dataUrl || "").match(/^data:([^;,]+);/i)?.[1] || ""
  );
  if (fromDataUrl) return { format: fromDataUrl, sourceMimeType };

  return { format: "unknown", sourceMimeType };
}

function parseDataUri(value) {
  const source = String(value || "").trim();
  const match = source.match(DATA_URI_PATTERN);
  if (!match) return null;
  const mimeType = String(match[1] || "").trim() || "application/octet-stream";
  const encoded = String(match[2] || "").trim();
  if (!encoded) return null;
  try {
    return {
      mimeType,
      bytes: Buffer.from(encoded, "base64"),
    };
  } catch {
    return null;
  }
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
        format: format || "unknown",
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

    const [customFonts, syncedFonts] = await Promise.all([
      getEditorCustomFonts().catch(() => []),
      getEditorSyncedFonts().catch(() => []),
    ]);

    const customFont = Array.isArray(customFonts)
      ? customFonts.find((item) => String(item?.id || "").trim() === fontId)
      : null;

    if (customFont) {
      const sourceVariant = resolveEditorCustomFontSourceVariant(customFont);
      const mobileVariant = resolveEditorCustomFontMobileVariant(customFont);
      if (!mobileVariant) {
        return unsupportedFormatResponse(
          requestId,
          "unknown",
          sourceVariant?.mimeType || customFont?.mimeType
        );
      }

      const formatInfo = resolveFontFormat(mobileVariant);
      if (!MOBILE_SUPPORTED_FONT_FORMATS.has(formatInfo.format)) {
        return unsupportedFormatResponse(
          requestId,
          formatInfo.format,
          sourceVariant?.mimeType || formatInfo.sourceMimeType
        );
      }

      const fileUrl = String(mobileVariant.fileUrl || "").trim();
      if (fileUrl) {
        return attachRequestIdHeader(NextResponse.redirect(fileUrl, 307), requestId);
      }

      const parsed = parseDataUri(mobileVariant.dataUrl);
      if (!parsed) {
        return attachRequestIdHeader(
          NextResponse.json({ error: "Font data is unavailable." }, { status: 404 }),
          requestId
        );
      }

      const parsedFormatInfo = resolveFontFormat(mobileVariant, parsed.mimeType);
      if (!MOBILE_SUPPORTED_FONT_FORMATS.has(parsedFormatInfo.format)) {
        return unsupportedFormatResponse(
          requestId,
          parsedFormatInfo.format,
          parsedFormatInfo.sourceMimeType
        );
      }

      const fileName =
        sanitizeFileName(
          mobileVariant.fileName || customFont?.family || `font.${parsedFormatInfo.format}`
        ) || `font.${parsedFormatInfo.format}`;

      return attachRequestIdHeader(
        new NextResponse(parsed.bytes, {
          status: 200,
          headers: {
            "Content-Type": canonicalMimeForFormat(parsedFormatInfo.format),
            "Content-Disposition": `inline; filename=\"${fileName}\"`,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        }),
        requestId
      );
    }

    const syncedFont = Array.isArray(syncedFonts)
      ? syncedFonts.find((item) => String(item?.id || "").trim() === fontId)
      : null;

    if (!syncedFont) {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Font not found." }, { status: 404 }),
        requestId
      );
    }

    const formatInfo = resolveFontFormat(syncedFont);
    if (!MOBILE_SUPPORTED_FONT_FORMATS.has(formatInfo.format)) {
      return unsupportedFormatResponse(
        requestId,
        formatInfo.format,
        syncedFont?.mimeType || formatInfo.sourceMimeType
      );
    }

    const syncedParsed = parseDataUri(syncedFont?.dataUrl);
    if (syncedParsed?.bytes?.length) {
      const syncedFormatInfo = resolveFontFormat(syncedFont, syncedParsed.mimeType);
      if (!MOBILE_SUPPORTED_FONT_FORMATS.has(syncedFormatInfo.format)) {
        return unsupportedFormatResponse(
          requestId,
          syncedFormatInfo.format,
          syncedFont?.mimeType || syncedFormatInfo.sourceMimeType
        );
      }
      const fileName =
        sanitizeFileName(
          syncedFont?.fileName || syncedFont?.family || `font.${syncedFormatInfo.format}`
        ) || `font.${syncedFormatInfo.format}`;

      return attachRequestIdHeader(
        new NextResponse(syncedParsed.bytes, {
          status: 200,
          headers: {
            "Content-Type": canonicalMimeForFormat(syncedFormatInfo.format),
            "Content-Disposition": `inline; filename=\"${fileName}\"`,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        }),
        requestId
      );
    }

    const externalUrl = String(syncedFont.fileUrl || "").trim();
    if (externalUrl) {
      return attachRequestIdHeader(NextResponse.redirect(externalUrl, 307), requestId);
    }

    return attachRequestIdHeader(
      NextResponse.json({ error: "Font data is unavailable." }, { status: 404 }),
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
