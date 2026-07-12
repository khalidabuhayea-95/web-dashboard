import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { logger } from "@/lib/logging/logger";
import { convertPsdToMobileProject } from "@/lib/media/psdImport/convertPsd.server";
import { resolvePsdFontStatus } from "@/lib/media/psdImport/fontStatus.server";

export const runtime = "nodejs";
export const maxDuration = 120;

// PSDs are large; allow generously but bound memory for this in-process tool.
// NOTE: parsing a file this big renders every layer to a canvas in memory and can
// use multiple GB of RAM — keep the proxyClientMaxBodySize in next.config.mjs above
// this value or the upload is rejected before it reaches the route.
const MAX_PSD_BYTES = 200 * 1024 * 1024;
const PSD_IMPORT_RATE_LIMIT = {
  limit: 20,
  windowMs: 60_000,
};

function looksLikePsd(fileName: string, bytes: Buffer): boolean {
  if (/\.psd$/i.test(String(fileName || ""))) return true;
  // PSD/PSB magic number: "8BPS".
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x38 &&
    bytes[1] === 0x42 &&
    bytes[2] === 0x50 &&
    bytes[3] === 0x53
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:tools:psd-import",
      identifier: session.userId || resolveRequestIp(request),
      limit: PSD_IMPORT_RATE_LIMIT.limit,
      windowMs: PSD_IMPORT_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many PSD conversions. Please retry shortly.",
        rateLimitState
      );
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return handleBadRequest("Invalid multipart form data.");
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return handleBadRequest("Missing PSD file upload (field 'file').");
    }
    if (Number(file.size || 0) <= 0) {
      return handleBadRequest("PSD upload must not be empty.");
    }
    if (Number(file.size || 0) > MAX_PSD_BYTES) {
      return handleBadRequest(
        `PSD is too large (max ${Math.round(MAX_PSD_BYTES / (1024 * 1024))}MB).`
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!looksLikePsd(file.name, bytes)) {
      return handleBadRequest("File does not look like a PSD (expected a .psd with an 8BPS header).");
    }

    const startedAt = Date.now();
    const result = await convertPsdToMobileProject(bytes, {
      name: String(file.name || "").replace(/\.psd$/i, "").trim() || "Imported PSD",
    });

    logger.info("Converted PSD to mobile project", {
      userId: session.userId,
      fileName: file.name,
      inputBytes: bytes.length,
      docWidth: result.docWidth,
      docHeight: result.docHeight,
      emitted: result.stats.emitted,
      textCount: result.stats.textCount,
      imageCount: result.stats.imageCount,
      fonts: result.stats.fontsUsed.length,
      durationMs: Date.now() - startedAt,
    });

    // Omit the heavy raw fabricData (its data URLs already ride along in
    // result.project.layers); the import route re-derives it from the file.
    const { fabricData: _fabricData, ...preview } = result;
    const fontStatus = await resolvePsdFontStatus(result.stats.fontsUsed);
    return NextResponse.json(
      { ok: true, ...preview, fontStatus },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logger.error("PSD conversion failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to convert the PSD file."
    );
  }
}
