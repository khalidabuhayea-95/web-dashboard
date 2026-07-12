import { NextRequest, NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { logger } from "@/lib/logging/logger";
import { importPsdAsTemplate } from "@/lib/media/psdImport/importTemplate.server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PSD_BYTES = 200 * 1024 * 1024;
const PSD_IMPORT_RATE_LIMIT = {
  limit: 12,
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
      scope: "api:tools:psd-import:save",
      identifier: session.userId || resolveRequestIp(request),
      limit: PSD_IMPORT_RATE_LIMIT.limit,
      windowMs: PSD_IMPORT_RATE_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse(
        "Too many template imports. Please retry shortly.",
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

    const nameField = String(formData.get("name") || "").trim();
    const startedAt = Date.now();
    const created = await importPsdAsTemplate({
      ownerId: session.userId,
      buffer: bytes,
      name: nameField || String(file.name || "").replace(/\.psd$/i, "").trim() || "Imported PSD",
    });

    logger.info("Imported PSD template", {
      userId: session.userId,
      fileName: file.name,
      templateId: created.id,
      slug: created.slug,
      layerCount: created.layerCount,
      uploadedAssets: created.uploadedAssets,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, ...created }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("PSD template import failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to import the PSD as a template."
    );
  }
}
