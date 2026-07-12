import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleNotFound } from "@/lib/api/errors";
import {
  resolveMobileBuiltInShapeById,
  MOBILE_SHAPE_RASTER_SIZE,
} from "@/lib/mobile/shapesCatalog.server";

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

  // Render the vector crisply at the target size (it still has whatever
  // transparent padding the source SVG draws around the shape).
  const rendered = await sharp(svgBytes)
    .resize({
      width: MOBILE_SHAPE_RASTER_SIZE,
      height: MOBILE_SHAPE_RASTER_SIZE,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  // Trim the transparent margins so the shape fills the frame edge-to-edge.
  // Trimming against a fully-transparent background only removes transparent
  // padding — it never eats into an opaque full-bleed shape.
  try {
    return await sharp(rendered)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
      .png()
      .toBuffer();
  } catch {
    // No transparent border to trim (or trim unavailable) — keep the full render.
    return rendered;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const shape = resolveMobileBuiltInShapeById(params?.id || "");
    if (!shape) {
      return handleNotFound("Shape");
    }

    const pngBytes = await rasterizeSvgToPng(decodeSvgDataUrl(shape.src));

    // The catalog serves versioned URLs (?v=...), so a versioned request is
    // safe to cache immutably for a year; bumping the version busts it.
    const isVersioned = request.nextUrl.searchParams.has("v");

    return new NextResponse(pngBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": isVersioned
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      },
    });
  } catch (error) {
    return handleApiError(error, "Failed to resolve mobile shape asset");
  }
}
