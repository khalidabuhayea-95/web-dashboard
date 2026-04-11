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
        source: matched?.source || null,
        downloadUrl: matched?.downloadUrl || null,
        mobileDownloadUrl: matched?.mobileDownloadUrl || null,
        mobileCompatible:
          typeof matched?.mobileCompatible === "boolean"
            ? matched.mobileCompatible
            : null,
        fontFormat: matched?.fontFormat || null,
        sourceMimeType: matched?.sourceMimeType || null,
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
      version: true,
      category: true,
      subCategory: true,
      tags: true,
      canvasSize: true,
      thumbnailDataUrl: true,
      previewVideoUrl: true,
      previewPosterUrl: true,
      previewStatus: true,
      previewDurationMs: true,
      previewVersion: true,
      previewError: true,
      previewUpdatedAt: true,
      data: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
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
    locale,
    template: templateWithFontDetails,
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
    },
  });
}
