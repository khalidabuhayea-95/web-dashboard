import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleNotFound } from "@/lib/api/errors";
import { resolveMobileBuiltInShapeById } from "@/lib/mobile/shapesCatalog.server";

export const runtime = "nodejs";

function decodeSvgDataUrl(dataUrl: string) {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/svg+xml")) {
    throw new Error("Unsupported shape asset source");
  }

  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Malformed shape asset source");
  }

  const metadata = raw.slice(0, commaIndex).toLowerCase();
  const payload = raw.slice(commaIndex + 1);
  if (metadata.includes(";base64")) {
    return Buffer.from(payload, "base64");
  }
  return Buffer.from(decodeURIComponent(payload), "utf8");
}

async function rasterizeSvgToPng(svgBytes: Buffer) {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default || sharpModule;
  return sharp(svgBytes)
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const shape = resolveMobileBuiltInShapeById(params?.id || "");
    if (!shape) {
      return handleNotFound("Shape");
    }

    const pngBytes = await rasterizeSvgToPng(decodeSvgDataUrl(shape.src));

    return new NextResponse(pngBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return handleApiError(error, "Failed to resolve mobile shape asset");
  }
}
