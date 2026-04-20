import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  buildMobileFontCatalogLookupByNames,
  normalizeMobileFontKey,
} from "@/lib/mobile/fontsCatalog.server";
import { createTemplateAssetResolver } from "@/lib/mobile/templateAssets";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import {
  isTemplateAllowedByTaxonomy,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
} from "@/lib/mobile/taxonomy";
import { toMobileTemplate } from "@/lib/templates/mobileProject";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function collectTextLayerFontNames(project) {
  const layers = Array.isArray(project?.layers) ? project.layers : [];
  return Array.from(
    new Set(
      layers
        .filter((layer) => String(layer?.type || "").toUpperCase() === "TEXT")
        .map((layer) => String(layer?.fontName || "").trim())
        .filter(Boolean)
    )
  );
}

function withLayerFontDetails(templatePayload, fontLookup) {
  if (!(fontLookup instanceof Map)) return templatePayload;
  const project = templatePayload?.project;
  if (!project || !Array.isArray(project.layers)) return templatePayload;

  const layers = project.layers.map((layer) => {
    if (String(layer?.type || "").toUpperCase() !== "TEXT") {
      return layer;
    }

    const fontName = String(layer?.fontName || "").trim();
    const matched = fontLookup.get(normalizeMobileFontKey(fontName));
    return {
      ...layer,
      font: {
        id: matched?.id || null,
        fontName: fontName || null,
        displayName: matched?.displayName || fontName || null,
        downloadUrl: matched?.downloadUrl || null,
        mobileDownloadUrl: matched?.mobileDownloadUrl || null,
        mobileCompatible:
          typeof matched?.mobileCompatible === "boolean"
            ? matched.mobileCompatible
            : null,
      },
    };
  });

  return {
    ...templatePayload,
    project: {
      ...project,
      layers,
    },
  };
}

function slimPreview(preview) {
  if (!preview || typeof preview !== "object") return null;

  const status = String(preview.status || "").trim();
  const url = String(preview.url || "").trim();
  const posterUrl = String(preview.posterUrl || "").trim();
  const durationMs = Number(preview.durationMs);

  if (!status && !url && !posterUrl && !Number.isFinite(durationMs)) {
    return null;
  }

  return {
    status: status || "not_requested",
    ...(url ? { url } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(Number.isFinite(durationMs) ? { durationMs: Math.max(0, Math.round(durationMs)) } : {}),
  };
}

function slimLayerFont(font) {
  if (!font || typeof font !== "object") return undefined;

  const id = String(font.id || "").trim();
  const fontName = String(font.fontName || "").trim();
  const displayName = String(font.displayName || "").trim();
  const downloadUrl = String(font.downloadUrl || "").trim();
  const mobileDownloadUrl = String(font.mobileDownloadUrl || "").trim();
  const mobileCompatible =
    typeof font.mobileCompatible === "boolean" ? font.mobileCompatible : null;

  if (!id && !fontName && !displayName && !downloadUrl && !mobileDownloadUrl && mobileCompatible === null) {
    return undefined;
  }

  return {
    ...(id ? { id } : {}),
    ...(fontName ? { fontName } : {}),
    ...(displayName ? { displayName } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(mobileDownloadUrl ? { mobileDownloadUrl } : {}),
    ...(mobileCompatible !== null ? { mobileCompatible } : {}),
  };
}

function slimFrameShape(shape) {
  if (!shape || typeof shape !== "object") return undefined;

  return {
    kind: String(shape.kind || "rect").trim().toLowerCase() || "rect",
    points: Array.isArray(shape.points) ? shape.points : [],
    cornerRadius: Math.max(0, Number(shape.cornerRadius) || 0),
  };
}

function slimFrameContent(content) {
  if (!content || typeof content !== "object") return null;

  return {
    type: String(content.type || "").trim().toUpperCase() || "IMAGE",
    ...(content.imageUri ? { imageUri: content.imageUri } : {}),
    ...(content.videoUri ? { videoUri: content.videoUri } : {}),
    ...(content.thumbnailUri ? { thumbnailUri: content.thumbnailUri } : {}),
    ...(Number.isFinite(Number(content.sourceWidth))
      ? { sourceWidth: Math.max(1, Math.round(Number(content.sourceWidth))) }
      : {}),
    ...(Number.isFinite(Number(content.sourceHeight))
      ? { sourceHeight: Math.max(1, Math.round(Number(content.sourceHeight))) }
      : {}),
    ...(typeof content.sourceHasAlpha === "boolean" ? { sourceHasAlpha: content.sourceHasAlpha } : {}),
    ...(typeof content.previewOnly === "boolean" ? { previewOnly: content.previewOnly } : {}),
    ...(Number.isFinite(Number(content.trimStartMs))
      ? { trimStartMs: Math.max(0, Math.round(Number(content.trimStartMs))) }
      : {}),
    ...(Number.isFinite(Number(content.trimEndMs))
      ? { trimEndMs: Math.max(0, Math.round(Number(content.trimEndMs))) }
      : {}),
    ...(Number.isFinite(Number(content.durationMs))
      ? { durationMs: Math.max(0, Math.round(Number(content.durationMs))) }
      : {}),
  };
}

function slimProjectLayer(layer) {
  if (!layer || typeof layer !== "object") return layer;
  const slimFont = slimLayerFont(layer.font);
  const slimShape = slimFrameShape(layer.shape);
  const slimContent = slimFrameContent(layer.content);

  const common = {
    id: layer.id,
    type: layer.type,
    transform: layer.transform,
    opacity: layer.opacity,
    locked: layer.locked,
    hidden: layer.hidden,
    zIndex: layer.zIndex,
    timelineStartMs: layer.timelineStartMs,
    timelineEndMs: layer.timelineEndMs,
    animation: layer.animation,
  };

  switch (String(layer.type || "").toUpperCase()) {
    case "IMAGE":
      return {
        ...common,
        imageUri: layer.imageUri,
        frameWidth: layer.frameWidth,
        frameHeight: layer.frameHeight,
        sourceWidth: layer.sourceWidth,
        sourceHeight: layer.sourceHeight,
        sourceHasAlpha: layer.sourceHasAlpha,
        cropRect: layer.cropRect,
        filters: layer.filters,
        ...(layer.assetKind ? { assetKind: layer.assetKind } : {}),
        ...(layer.colorEditMode ? { colorEditMode: layer.colorEditMode } : {}),
        ...(layer.rasterOriginalUri ? { rasterOriginalUri: layer.rasterOriginalUri } : {}),
        ...(Array.isArray(layer.rasterPalette) ? { rasterPalette: layer.rasterPalette } : {}),
        ...(layer.rasterColorMap && typeof layer.rasterColorMap === "object"
          ? { rasterColorMap: layer.rasterColorMap }
          : {}),
      };
    case "VIDEO_CLIP":
      return {
        ...common,
        videoUri: layer.videoUri,
        frameWidth: layer.frameWidth,
        frameHeight: layer.frameHeight,
        ...(layer.thumbnailUri ? { thumbnailUri: layer.thumbnailUri } : {}),
        sourceWidth: layer.sourceWidth,
        sourceHeight: layer.sourceHeight,
        ...(typeof layer.sourceHasAlpha === "boolean" ? { sourceHasAlpha: layer.sourceHasAlpha } : {}),
        cropRect: layer.cropRect,
        filters: layer.filters,
        ...(Number.isFinite(Number(layer.trimStartMs)) ? { trimStartMs: layer.trimStartMs } : {}),
        ...(Number.isFinite(Number(layer.trimEndMs)) ? { trimEndMs: layer.trimEndMs } : {}),
      };
    case "TEXT":
      return {
        ...common,
        text: layer.text,
        ...(typeof layer.isRtl === "boolean" ? { isRtl: layer.isRtl } : {}),
        fontName: layer.fontName,
        size: layer.size,
        colorHex: layer.colorHex,
        shadow: layer.shadow,
        stroke: layer.stroke,
        letterSpacing: layer.letterSpacing,
        lineHeight: layer.lineHeight,
        alignment: layer.alignment,
        bold: layer.bold,
        italic: layer.italic,
        underline: layer.underline,
        strikethrough: layer.strikethrough,
        textCase: layer.textCase,
        curveConfig: layer.curveConfig,
        backgroundVisible: layer.backgroundVisible,
        backgroundColorHex: layer.backgroundColorHex,
        backgroundAngleSize: layer.backgroundAngleSize,
        backgroundOpacity: layer.backgroundOpacity,
        ...(slimFont ? { font: slimFont } : {}),
      };
    case "FRAME":
      return {
        ...common,
        frameWidth: layer.frameWidth,
        frameHeight: layer.frameHeight,
        ...(slimShape ? { shape: slimShape } : {}),
        ...(layer.content ? { content: slimContent } : {}),
        ...(layer.contentTransform ? { contentTransform: layer.contentTransform } : {}),
        filters: layer.filters,
      };
    default:
      return layer;
  }
}

function slimProject(project) {
  if (!project || typeof project !== "object") return null;

  return {
    canvasWidth: project.canvasWidth,
    canvasHeight: project.canvasHeight,
    background: project.background,
    layers: Array.isArray(project.layers) ? project.layers.map(slimProjectLayer) : [],
  };
}

function slimTemplateDetail(templatePayload) {
  if (!templatePayload || typeof templatePayload !== "object") return templatePayload;
  const preview = slimPreview(templatePayload.preview);

  return {
    id: templatePayload.id,
    title: templatePayload.title,
    category: templatePayload.category,
    categoryValue: templatePayload.categoryValue,
    subCategory: templatePayload.subCategory,
    subCategoryValue: templatePayload.subCategoryValue,
    thumbnailUrl: templatePayload.thumbnailUrl,
    ...(preview ? { preview } : {}),
    project: slimProject(templatePayload.project),
  };
}

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const locale = resolveMobileLocale(request, searchParams);

  const resolvedParams = await params;
  const templateRef = String(resolvedParams?.id || resolvedParams?.slug || "").trim();
  if (!templateRef) {
    return NextResponse.json({ error: "Missing template id or slug." }, { status: 400 });
  }
  const where = UUID_PATTERN.test(templateRef) ? { id: templateRef } : { slug: templateRef };

  const template = await prisma.template.findFirst({
    where: {
      status: "published",
      ...where,
    },
    select: {
      id: true,
      name: true,
      category: true,
      subCategory: true,
      canvasSize: true,
      thumbnailDataUrl: true,
      previewVideoUrl: true,
      previewPosterUrl: true,
      previewStatus: true,
      previewDurationMs: true,
      data: true,
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
  const localized = localizeTemplateTaxonomy(template, taxonomy, locale);
  const assetResolver = createTemplateAssetResolver(request, template);
  const mobileTemplate = {
    ...toMobileTemplate(template, { assetResolver }),
    category: localized.categoryLabel,
    subCategory: localized.subCategoryLabel,
    categoryId: localized.categoryId,
    categoryValue: localized.categoryValue,
    subCategoryId: localized.subCategoryId,
    subCategoryValue: localized.subCategoryValue,
  };
  const usedFontNames = collectTextLayerFontNames(mobileTemplate.project);
  const fontLookup = await buildMobileFontCatalogLookupByNames(
    request,
    usedFontNames
  );
  const templateWithFontDetails = withLayerFontDetails(mobileTemplate, fontLookup);

  return NextResponse.json({
    template: slimTemplateDetail(templateWithFontDetails),
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
    },
  });
}
