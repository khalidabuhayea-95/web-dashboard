import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/errors";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { MOBILE_PUBLIC_JSON_CACHE_SHORT } from "@/lib/mobile/cacheControl";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import { resolveTemplateAudience } from "@/lib/mobile/templateAudience.server";
import {
  buildPublishedTemplateScopeWhere,
  localizeCategoryOptions,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
  resolveCategoryFilterValue,
  resolveSubCategoryFilterValue,
} from "@/lib/mobile/taxonomy";
import {
  createMobilePublicMediaUrlResolver,
  createTemplateAssetResolver,
} from "@/lib/mobile/templateAssets";
import { getActiveOccasionBoost } from "@/lib/occasions/boost.server";
import { applyOccasionCategoryOrder, stablePartition } from "@/lib/occasions/hoist";
import { resolvePinnedWindow } from "@/lib/occasions/pinnedPagination";
import { buildTemplateBoostWhere, makeTemplateBoostPredicate } from "@/lib/occasions/templateBoost";
import { mergeTemplateWhere, templateCategoryWhere } from "@/lib/templates/categoryQuery";
import prisma from "@/lib/prisma";
import { toMobileTemplate } from "@/lib/templates/mobileProject";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

const logger = createLogger("api.mobile.templates");

// Cap on how many boosted rows the pinned-first pagination tracks per request. Past it the
// tail of boosted content falls back to recency order; nothing disappears.
const MAX_PINNED_ROWS = 5000;

function parsePositiveInt(value: any, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

interface EmptyPayloadInput {
  locale: string;
  categories: any[];
  page: number;
  pageSize: number;
}

interface MobileTemplateRouteOptions {
  routeName?: string;
  searchMode?: "default" | "queryOnly";
}

function buildEmptyPayload(input: EmptyPayloadInput) {
  const { locale, categories, page, pageSize } = input;
  return {
    locale,
    categories,
    templatesBySubCategory: [],
    page,
    pageSize,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: page > 1,
  };
}

function normalizeTagValue(value: string): string {
  return value.trim().toLowerCase();
}

function resolveTemplateNameQuery(searchParams: URLSearchParams): string {
  return String(
    searchParams.get("name") ??
      searchParams.get("query") ??
      searchParams.get("search") ??
      searchParams.get("q") ??
      ""
  ).trim();
}

function resolveTemplateTags(searchParams: URLSearchParams): string[] {
  const rawTagValues = [
    ...searchParams.getAll("tag"),
    ...searchParams.getAll("tags"),
    ...searchParams.getAll("tagsCsv"),
  ];

  return Array.from(
    new Set(
      rawTagValues
        .flatMap((value) => String(value || "").split(","))
        .map((value) => normalizeTagValue(String(value)))
        .filter(Boolean)
    )
  );
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function resolveQueryOnlySearchValue(searchParams: URLSearchParams): string {
  return String(searchParams.get("query") || "").trim();
}

function templateMatchesCombinedQuery(template: any, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const name = normalizeSearchText(String(template?.name || ""));
  if (name.includes(normalizedQuery)) return true;

  const tags = Array.isArray(template?.tags) ? template.tags : [];
  return tags.some((tag) => normalizeSearchText(String(tag || "")).includes(normalizedQuery));
}

export async function buildMobileTemplatesListResponse(
  request: NextRequest,
  options: MobileTemplateRouteOptions = {}
): Promise<NextResponse> {
  const requestId = resolveRequestId(request);
  const routeName = options.routeName || "Fetched mobile templates";
  const searchMode = options.searchMode || "default";
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    const { searchParams } = new URL(request.url);
    const audience = await resolveTemplateAudience(request);
    const locale = resolveMobileLocale(request, searchParams);
    const taxonomySettings = await getTemplateTaxonomySettings();
    const taxonomy = prepareMobileTaxonomy(taxonomySettings);
    // Seasonal boost: linked categories lead the list (matching /templates/taxonomy and the
    // home feed) and linked templates are pinned to the front of the results.
    const boost = await getActiveOccasionBoost();
    const categories = applyOccasionCategoryOrder(localizeCategoryOptions(taxonomy, locale), boost);
    const categoryIdParam = searchParams.get("categoryId");
    const subCategoryIdParam = searchParams.get("subCategoryId");
    const query =
      searchMode === "queryOnly"
        ? resolveQueryOnlySearchValue(searchParams)
        : resolveTemplateNameQuery(searchParams);
    const tags = searchMode === "queryOnly" ? [] : resolveTemplateTags(searchParams);
    const page = Math.max(parsePositiveInt(searchParams.get("page"), 1), 1);
    const pageSizeInput =
      searchParams.get("pageSize") ??
      searchParams.get("page_size") ??
      searchParams.get("per_page") ??
      searchParams.get("limit");
    const pageSize = Math.min(Math.max(parsePositiveInt(pageSizeInput, 100), 1), 200);
    const skip = (page - 1) * pageSize;
    let categoryValue = resolveCategoryFilterValue(categoryIdParam, taxonomy);
    const subCategoryFilterInput = subCategoryIdParam;

    if (!categoryValue && subCategoryFilterInput) {
      const inferredCategoryValue = taxonomy.categoryValueBySubCategoryId.get(
        String(subCategoryFilterInput || "").trim().toLowerCase()
      );
      if (inferredCategoryValue) categoryValue = inferredCategoryValue;
    }

    const subCategoryValue = resolveSubCategoryFilterValue(
      subCategoryFilterInput,
      categoryValue,
      taxonomy
    );

    if ((categoryIdParam && !categoryValue) || (subCategoryIdParam && !subCategoryValue)) {
      const response = NextResponse.json(
        buildEmptyPayload({ locale, categories, page, pageSize }),
        {
          headers: audience.headers(MOBILE_PUBLIC_JSON_CACHE_SHORT),
        }
      );
      return attachRequestIdHeader(response, requestId);
    }

    const publishedScopeWhere = buildPublishedTemplateScopeWhere(taxonomy);
    if (!publishedScopeWhere) {
      const response = NextResponse.json(
        buildEmptyPayload({ locale, categories, page, pageSize }),
        {
          headers: audience.headers(MOBILE_PUBLIC_JSON_CACHE_SHORT),
        }
      );
      return attachRequestIdHeader(response, requestId);
    }

    // Both the published-taxonomy scope and the category filter match ANY placement, so
    // each is its own OR fragment and they have to be AND-merged, not spread together.
    const baseWhere = mergeTemplateWhere(
      audience.statusWhere,
      publishedScopeWhere,
      templateCategoryWhere({ category: categoryValue, subCategory: subCategoryValue })
    );
    const where = mergeTemplateWhere(baseWhere, {
      ...(tags.length > 0 ? { tags: { array_contains: tags } } : {}),
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    });
    const templateSelect = {
      id: true,
      name: true,
      status: true,
      version: true,
      category: true,
      subCategory: true,
      categories: true,
      tags: true,
      canvasSize: true,
      pageCount: true,
      isPremium: true,
      thumbnailDataUrl: true,
      previewVideoUrl: true,
      previewPosterUrl: true,
      previewStatus: true,
      previewDurationMs: true,
      previewVersion: true,
      previewError: true,
      previewUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    } as any;

    let rows: any[] = [];
    let total = 0;

    const boostWhere = buildTemplateBoostWhere(boost, taxonomy);

    if (searchMode === "queryOnly" && query) {
      let matchingRows = (
        await prisma.template.findMany({
          where: baseWhere,
          orderBy: { updatedAt: "desc" },
          select: templateSelect,
        })
      ).filter((template: any) => templateMatchesCombinedQuery(template, query));

      const isBoosted = makeTemplateBoostPredicate(boost);
      if (isBoosted) matchingRows = stablePartition(matchingRows, isBoosted);

      total = matchingRows.length;
      rows = matchingRows.slice(skip, skip + pageSize);
    } else if (!boostWhere) {
      [rows, total] = await prisma.$transaction([
        prisma.template.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip,
          take: pageSize,
          select: templateSelect,
        }),
        prisma.template.count({ where }),
      ]);
    } else {
      // Pinned-first pagination: every boosted row that matches `where` occupies the first
      // positions of the virtual list, the remainder follows, `total` is unchanged. The
      // remainder is `id notIn pinned` rather than `NOT boostWhere` because `categories` is
      // a nullable jsonb and NOT over it would drop legacy rows from every page.
      const pinnedIds: string[] = (
        await prisma.template.findMany({
          where: mergeTemplateWhere(where, boostWhere),
          orderBy: { updatedAt: "desc" },
          select: { id: true },
          take: MAX_PINNED_ROWS,
        })
      ).map((row: { id: string }) => row.id);
      if (pinnedIds.length === MAX_PINNED_ROWS) {
        requestLogger.warn("Occasion boost hit the pinned-row cap", { cap: MAX_PINNED_ROWS });
      }
      const window = resolvePinnedWindow({ skip, take: pageSize, pinnedCount: pinnedIds.length });
      const pagePinnedIds = pinnedIds.slice(window.pinnedSkip, window.pinnedSkip + window.pinnedTake);
      const [pinnedRows, restRows, count] = await Promise.all([
        pagePinnedIds.length
          ? prisma.template.findMany({ where: { id: { in: pagePinnedIds } }, select: templateSelect })
          : Promise.resolve([] as any[]),
        window.restTake > 0
          ? prisma.template.findMany({
              where: mergeTemplateWhere(where, { id: { notIn: pinnedIds } }),
              orderBy: { updatedAt: "desc" },
              skip: window.restSkip,
              take: window.restTake,
              select: templateSelect,
            })
          : Promise.resolve([] as any[]),
        prisma.template.count({ where }),
      ]);
      const pinnedById = new Map(pinnedRows.map((row: any) => [row.id, row]));
      rows = [...pagePinnedIds.map((id: string) => pinnedById.get(id)).filter(Boolean), ...restRows];
      total = count;
    }

    const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
    const templates = rows.map((template: any) => {
      const localized = localizeTemplateTaxonomy(template, taxonomy, locale);
      const assetResolver = createTemplateAssetResolver(request, template);
      return {
        ...toMobileTemplate(template, { assetResolver, mediaUrlResolver, includeProject: false }),
        status: String(template.status || ""),
        // Flat fields keep the single-category shape older clients read — the grouping below
        // re-points them at the rail each copy is listed under. `placements` is the full list.
        category: localized.categoryLabel,
        subCategory: localized.subCategoryLabel,
        categoryId: localized.categoryId,
        categoryValue: localized.categoryValue,
        subCategoryId: localized.subCategoryId,
        subCategoryValue: localized.subCategoryValue,
        placements: localized.placements,
      };
    });

    const categoryOrder = new Map(
      categories.map((item: any, index: number) => [String(item.value || ""), index])
    );
    const subCategoryOrder = new Map(
      categories.map((item: any) => [
        String(item.value || ""),
        new Map(
          (Array.isArray(item.subCategories) ? item.subCategories : []).map(
            (sub: any, index: number) => [sub.value, index]
          )
        ),
      ])
    );
    const groupedBySubCategoryMap = new Map<string, any>();

    // A multi-category template belongs in EVERY rail it was placed in, so it is emitted
    // once per placement (narrowed to the requested filter). Each copy reports the labels
    // of the rail it is rendered under, not the template's primary placement.
    templates.forEach((template: any, index: number) => {
      const allPlacements = Array.isArray(template.placements) ? template.placements : [];
      const matching = allPlacements.filter(
        (placement: any) =>
          (!categoryValue || placement.categoryValue === categoryValue) &&
          (!subCategoryValue || placement.subCategoryValue === subCategoryValue)
      );
      const placements =
        matching.length > 0
          ? matching
          : [
              {
                categoryId: template.categoryId,
                categoryValue: template.categoryValue,
                categoryLabel: template.category,
                subCategoryId: template.subCategoryId,
                subCategoryValue: template.subCategoryValue,
                subCategoryLabel: template.subCategory,
              },
            ];

      placements.forEach((placement: any) => {
        const categoryValueKey = String(placement.categoryValue || "");
        const subCategoryValueKey = String(placement.subCategoryValue || "");
        const key = `${categoryValueKey}::${subCategoryValueKey}`;
        const entry = {
          ...template,
          category: String(placement.categoryLabel || ""),
          categoryId: String(placement.categoryId || ""),
          categoryValue: categoryValueKey,
          subCategory: String(placement.subCategoryLabel || ""),
          subCategoryId: String(placement.subCategoryId || ""),
          subCategoryValue: subCategoryValueKey,
        };

        const existing = groupedBySubCategoryMap.get(key);
        if (existing) {
          existing.templates.push(entry);
          return;
        }
        groupedBySubCategoryMap.set(key, {
          category: entry.category,
          categoryId: entry.categoryId,
          categoryValue: categoryValueKey,
          subCategory: entry.subCategory,
          subCategoryId: entry.subCategoryId,
          subCategoryValue: subCategoryValueKey,
          templates: [entry],
          _firstIndex: index,
        });
      });
    });

    const templatesBySubCategory = Array.from(groupedBySubCategoryMap.values())
      .sort((left: any, right: any) => {
        const leftCategoryOrder =
          (categoryOrder.get(left.categoryValue) ?? Number.MAX_SAFE_INTEGER) as number;
        const rightCategoryOrder =
          (categoryOrder.get(right.categoryValue) ?? Number.MAX_SAFE_INTEGER) as number;
        if (leftCategoryOrder !== rightCategoryOrder) {
          return leftCategoryOrder - rightCategoryOrder;
        }

        const leftSubCategoryOrder =
          ((subCategoryOrder.get(left.categoryValue) as Map<string, number>)?.get(
            left.subCategoryValue
          ) ?? Number.MAX_SAFE_INTEGER) as number;
        const rightSubCategoryOrder =
          ((subCategoryOrder.get(right.categoryValue) as Map<string, number>)?.get(
            right.subCategoryValue
          ) ?? Number.MAX_SAFE_INTEGER) as number;
        if (leftSubCategoryOrder !== rightSubCategoryOrder) {
          return leftSubCategoryOrder - rightSubCategoryOrder;
        }

        return left._firstIndex - right._firstIndex;
      })
      .map(({ _firstIndex, ...group }: any) => group);

    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    requestLogger.info(routeName, {
      total,
      page,
      pageSize,
      query,
      tags,
    });

    const response = NextResponse.json(
      {
        locale,
        categories,
        templatesBySubCategory,
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
      { headers: audience.headers(MOBILE_PUBLIC_JSON_CACHE_SHORT) }
    );
    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    requestLogger.error("Failed to fetch templates list", error, {});
    return attachRequestIdHeader(
      handleApiError(error, "Failed to fetch templates"),
      requestId
    );
  }
}
