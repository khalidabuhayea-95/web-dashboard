import { performance } from "node:perf_hooks";

import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { buildMobileFontCatalogLookupByNames } from "@/lib/mobile/fontsCatalog.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { MOBILE_PUBLIC_JSON_CACHE_SHORT } from "@/lib/mobile/cacheControl";
import {
  createMobilePublicMediaUrlResolver,
  createTemplateAssetResolver,
} from "@/lib/mobile/templateAssets";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import {
  isTemplateAllowedByTaxonomy,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
} from "@/lib/mobile/taxonomy";
import { extractFabricData } from "@/lib/templates/editorData";
import { resolveEditorTextFontName } from "@/lib/templates/mobileCompatibility";
import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";
import { handleApiError } from "@/lib/api/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const logger = createLogger("api.mobile.template-detail");

function roundTiming(value) {
  return Math.round(value * 100) / 100;
}

async function measureAsync(target, key, fn) {
  const startedAt = performance.now();
  const result = await fn();
  target[key] = roundTiming(performance.now() - startedAt);
  return result;
}

function measureSync(target, key, fn) {
  const startedAt = performance.now();
  const result = fn();
  target[key] = roundTiming(performance.now() - startedAt);
  return result;
}

function collectTextLayerFontNames(objects) {
  const layers = Array.isArray(objects) ? objects : [];
  return Array.from(
    new Set(
      layers
        .filter((layer) => {
          const layerType = String(layer?.layerType || layer?.type || "").trim().toLowerCase();
          return layerType === "text" || layerType.includes("text");
        })
        .map((layer) => resolveEditorTextFontName(layer))
        .filter(Boolean)
    )
  );
}

export async function GET(request, { params }) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const requestStartedAt = performance.now();
  const { searchParams } = new URL(request.url);
  const locale = resolveMobileLocale(request, searchParams);
  const timings = {
    dbMs: 0,
    taxonomyMs: 0,
    fabricParseMs: 0,
    fontLookupMs: 0,
    layerMappingMs: 0,
  };
  const taxonomyDetails = {};
  const fabricParseDetails = {};
  const fontLookupDetails = {};
  const layerMappingDetails = {};

  try {
    const resolvedParams = await params;
    const templateRef = String(resolvedParams?.id || resolvedParams?.slug || "").trim();
    if (!templateRef) {
      return attachRequestIdHeader(
        NextResponse.json({ error: "Missing template id or slug." }, { status: 400 }),
        requestId
      );
    }
    const where = UUID_PATTERN.test(templateRef) ? { id: templateRef } : { slug: templateRef };

    const dbStartedAt = performance.now();
    const template = await prisma.template.findFirst({
      where: {
        status: "published",
        ...where,
      },
      select: {
        id: true,
        name: true,
        version: true,
        updatedAt: true,
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
    timings.dbMs = roundTiming(performance.now() - dbStartedAt);

    if (!template) {
      requestLogger.warn("Mobile template detail not found", {
        templateRef,
        locale,
        ...timings,
        totalMs: roundTiming(performance.now() - requestStartedAt),
      });
      return attachRequestIdHeader(
        NextResponse.json({ error: "Template not found." }, { status: 404 }),
        requestId
      );
    }

    const taxonomyStartedAt = performance.now();
    const taxonomySettingsDiagnostics = {};
    const taxonomySettings = await measureAsync(
      taxonomyDetails,
      "getTemplateTaxonomySettingsMs",
      () => getTemplateTaxonomySettings({ diagnostics: taxonomySettingsDiagnostics })
    );
    taxonomyDetails.settings = taxonomySettingsDiagnostics;
    const taxonomy = measureSync(taxonomyDetails, "prepareMobileTaxonomyMs", () =>
      prepareMobileTaxonomy(taxonomySettings)
    );
    const isAllowed = measureSync(taxonomyDetails, "isTemplateAllowedByTaxonomyMs", () =>
      isTemplateAllowedByTaxonomy(template, taxonomy)
    );
    if (!isAllowed) {
      timings.taxonomyMs = roundTiming(performance.now() - taxonomyStartedAt);
      requestLogger.warn("Mobile template detail blocked by taxonomy", {
        templateId: template.id,
        locale,
        ...timings,
        totalMs: roundTiming(performance.now() - requestStartedAt),
        taxonomyDetails,
      });
      return attachRequestIdHeader(
        NextResponse.json({ error: "Template not found." }, { status: 404 }),
        requestId
      );
    }
    const localized = measureSync(taxonomyDetails, "localizeTemplateTaxonomyMs", () =>
      localizeTemplateTaxonomy(template, taxonomy, locale)
    );
    timings.taxonomyMs = roundTiming(performance.now() - taxonomyStartedAt);

    const fabricParseStartedAt = performance.now();
    const fabricData = measureSync(fabricParseDetails, "extractFabricDataMs", () =>
      extractFabricData(template.data || {}) || template.data || {}
    );
    const objects = Array.isArray(fabricData?.objects) ? fabricData.objects : [];
    fabricParseDetails.objectCount = objects.length;
    const usedFontNames = measureSync(fabricParseDetails, "collectTextLayerFontNamesMs", () =>
      collectTextLayerFontNames(objects)
    );
    fabricParseDetails.usedFontCount = usedFontNames.length;
    timings.fabricParseMs = roundTiming(performance.now() - fabricParseStartedAt);

    const fontLookupStartedAt = performance.now();
    const fontLookup = await buildMobileFontCatalogLookupByNames(request, usedFontNames, {
      diagnostics: fontLookupDetails,
    });
    timings.fontLookupMs = roundTiming(performance.now() - fontLookupStartedAt);
    fontLookupDetails.lookupSize = fontLookup.size;

    const assetResolver = createTemplateAssetResolver(request, template);
    const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
    const layerMappingStartedAt = performance.now();
    const mobileTemplate = measureSync(layerMappingDetails, "toMobileTemplateDetailSlimMs", () =>
      toMobileTemplateDetailSlim(template, {
        assetResolver,
        mediaUrlResolver,
        categoryLabel: localized.categoryLabel,
        categoryValue: localized.categoryValue,
        subCategoryLabel: localized.subCategoryLabel,
        subCategoryValue: localized.subCategoryValue,
        fabricData,
        fontLookup,
        telemetry: layerMappingDetails,
      })
    );
    timings.layerMappingMs = roundTiming(performance.now() - layerMappingStartedAt);

    requestLogger.info("Fetched mobile template detail", {
      templateId: template.id,
      locale,
      layerCount: Array.isArray(mobileTemplate?.project?.layers)
        ? mobileTemplate.project.layers.length
        : 0,
      usedFontCount: usedFontNames.length,
      ...timings,
      totalMs: roundTiming(performance.now() - requestStartedAt),
      taxonomyDetails,
      fabricParseDetails,
      fontLookupDetails,
      layerMappingDetails,
    });

    const response = NextResponse.json(
      {
        template: mobileTemplate,
      },
      {
        headers: {
          "Cache-Control": MOBILE_PUBLIC_JSON_CACHE_SHORT,
        },
      }
    );
    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    requestLogger.error("Failed to fetch mobile template detail", error, {
      locale,
      ...timings,
      totalMs: roundTiming(performance.now() - requestStartedAt),
      taxonomyDetails,
      fabricParseDetails,
      fontLookupDetails,
      layerMappingDetails,
    });
    return attachRequestIdHeader(
      handleApiError(error, "Failed to fetch template"),
      requestId
    );
  }
}
