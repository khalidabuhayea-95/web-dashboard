import { NextResponse } from "next/server";

import { isTemplateAllowedByTaxonomy, prepareMobileTaxonomy } from "@/lib/mobile/taxonomy";
import prisma from "@/lib/prisma";
import { extractFabricData } from "@/lib/templates/editorData";
import {
  isRasterizableShapeLayer,
  renderShapeLayerToPngBuffer,
} from "@/lib/templates/shapeRaster";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

export const runtime = "nodejs";

const DATA_URI_PATTERN = /^data:([^;,]+);base64,(.+)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function findLayerObject(templateData, elementId, index) {
  const data = extractFabricData(templateData) || templateData || {};
  const objects = Array.isArray(data?.objects) ? data.objects : [];

  const normalizedElementId = String(elementId || "").trim();
  let object = null;
  if (normalizedElementId) {
    object = objects.find((item) => {
      const id = String(item?.id || item?.layerId || "").trim();
      return id === normalizedElementId;
    });
  }
  if (!object && Number.isFinite(index) && index >= 0 && index < objects.length) {
    object = objects[index];
  }
  if (!object || typeof object !== "object") return null;
  return object;
}

function resolveLayerSource(object, field) {
  if (!object || typeof object !== "object") return "";

  const candidateFields = field
    ? [String(field)]
    : ["src", "imageUri", "thumbnailUri", "videoUri"];
  for (const key of candidateFields) {
    const value = object?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function resolveBackgroundSource(templateData, field) {
  const data = extractFabricData(templateData) || templateData || {};
  const background = data?.background;
  if (typeof background === "string" && background.trim()) {
    return background.trim();
  }
  if (!background || typeof background !== "object") return "";

  if (field === "imageUri" && typeof background.imageUri === "string") {
    return background.imageUri.trim();
  }
  if (typeof background.imageUri === "string" && background.imageUri.trim()) {
    return background.imageUri.trim();
  }
  return "";
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const templateRef = String(resolvedParams?.id || resolvedParams?.slug || "").trim();
  if (!templateRef) {
    return NextResponse.json({ error: "Missing template id or slug." }, { status: 400 });
  }
  const where = UUID_PATTERN.test(templateRef) ? { id: templateRef } : { slug: templateRef };

  const { searchParams } = new URL(request.url);
  const scope = String(searchParams.get("scope") || "layer").trim().toLowerCase();
  const field = String(searchParams.get("field") || "").trim();
  const elementId = String(searchParams.get("elementId") || "").trim();
  const indexParam = searchParams.get("index");
  const index = Number.isFinite(Number(indexParam)) ? Number(indexParam) : null;

  const template = await prisma.template.findFirst({
    where: {
      status: "published",
      ...where,
    },
    select: {
      category: true,
      subCategory: true,
      data: true,
      thumbnailDataUrl: true,
    },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const taxonomySettings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(taxonomySettings);
  if (!isTemplateAllowedByTaxonomy(template, taxonomy)) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  let source = "";
  const layerObject = scope === "layer" ? findLayerObject(template.data, elementId, index) : null;
  if (scope === "layer" && field === "shape-raster") {
    if (!isRasterizableShapeLayer(layerObject)) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    try {
      const bytes = renderShapeLayerToPngBuffer(layerObject);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to rasterize shape asset." },
        { status: 422 }
      );
    }
  }

  if (scope === "thumbnail") {
    source = String(template.thumbnailDataUrl || "").trim();
  } else if (scope === "background") {
    source = resolveBackgroundSource(template.data, field);
  } else {
    source = resolveLayerSource(layerObject, field);
  }

  if (!source) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  if (/^https?:\/\//i.test(source)) {
    return NextResponse.redirect(source, 307);
  }

  const parsed = parseDataUri(source);
  if (!parsed) {
    return NextResponse.json({ error: "Unsupported asset source." }, { status: 422 });
  }

  return new NextResponse(parsed.bytes, {
    status: 200,
    headers: {
      "Content-Type": parsed.mimeType,
      "Cache-Control": "public, max-age=300",
    },
  });
}
