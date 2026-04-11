import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import prisma from "@/lib/prisma";
import { createTemplateAssetResolver } from "@/lib/mobile/templateAssets";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import {
  buildPublishedTemplateScopeWhere,
  localizeCategoryOptions,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
  resolveCategoryFilterValue,
  resolveSubCategoryFilterValue,
} from "@/lib/mobile/taxonomy";
import { toMobileTemplate } from "@/lib/templates/mobileProject";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";
import { handleApiError } from "@/lib/api/errors";

const logger = createLogger("api.mobile.templates");

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  try {
    const { searchParams } = new URL(request.url);
    const locale = resolveMobileLocale(request, searchParams);
    const taxonomySettings = await getTemplateTaxonomySettings();
    const taxonomy = prepareMobileTaxonomy(taxonomySettings);
    const categories = localizeCategoryOptions(taxonomy, locale);
    const categoryIdParam = searchParams.get("categoryId");
    const subCategoryIdParam = searchParams.get("subCategoryId");
    const query = String(searchParams.get("query") || "").trim();
    const tag = String(searchParams.get("tag") || "").trim().toLowerCase();
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
          headers: {
            "Cache-Control": "public, max-age=30",
          },
        }
      );
      return attachRequestIdHeader(response, requestId);
    }

    const publishedScopeWhere = buildPublishedTemplateScopeWhere(taxonomy);
    if (!publishedScopeWhere) {
      const response = NextResponse.json(
        buildEmptyPayload({ locale, categories, page, pageSize }),
        {
          headers: {
            "Cache-Control": "public, max-age=30",
          },
        }
      );
      return attachRequestIdHeader(response, requestId);
    }

    const where = {
      status: "published",
      ...publishedScopeWhere,
      ...(categoryValue ? { category: categoryValue } : {}),
      ...(subCategoryValue ? { subCategory: subCategoryValue } : {}),
      ...(tag ? { tags: { array_contains: [tag] } } : {}),
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.template.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
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
          createdAt: true,
          updatedAt: true,
        } as any,
      }),
      prisma.template.count({ where }),
    ]);

    const templates = rows.map((template: any) => {
      const localized = localizeTemplateTaxonomy(template, taxonomy, locale);
      const assetResolver = createTemplateAssetResolver(request, template);
      return {
        ...toMobileTemplate(template, { assetResolver, includeProject: false }),
        category: localized.categoryLabel,
        subCategory: localized.subCategoryLabel,
        categoryId: localized.categoryId,
        categoryValue: localized.categoryValue,
        subCategoryId: localized.subCategoryId,
        subCategoryValue: localized.subCategoryValue,
      };
    });

    const categoryOrder = new Map(categories.map((item: any, index: number) => [String(item.value || ""), index]));
    const subCategoryOrder = new Map(
      categories.map((item: any) => [
        String(item.value || ""),
        new Map((Array.isArray(item.subCategories) ? item.subCategories : []).map((sub: any, index: number) => [sub.value, index])),
      ])
    );
    const groupedBySubCategoryMap = new Map<string, any>();

    templates.forEach((template: any, index: number) => {
      const categoryValueKey = String(template.categoryValue || "");
      const subCategoryValueKey = String(template.subCategoryValue || "");
      const key = `${categoryValueKey}::${subCategoryValueKey}`;
      const existing = groupedBySubCategoryMap.get(key);
      if (existing) {
        existing.templates.push(template);
        return;
      }
      groupedBySubCategoryMap.set(key, {
        category: String(template.category || ""),
        categoryId: String(template.categoryId || ""),
        categoryValue: categoryValueKey,
        subCategory: String(template.subCategory || ""),
        subCategoryId: String(template.subCategoryId || ""),
        subCategoryValue: subCategoryValueKey,
        templates: [template],
        _firstIndex: index,
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
          ((subCategoryOrder.get(left.categoryValue) as Map<string, number>)?.get(left.subCategoryValue) ??
          Number.MAX_SAFE_INTEGER) as number;
        const rightSubCategoryOrder =
          ((subCategoryOrder.get(right.categoryValue) as Map<string, number>)?.get(right.subCategoryValue) ??
          Number.MAX_SAFE_INTEGER) as number;
        if (leftSubCategoryOrder !== rightSubCategoryOrder) {
          return leftSubCategoryOrder - rightSubCategoryOrder;
        }

        return left._firstIndex - right._firstIndex;
      })
      .map(({ _firstIndex, ...group }: any) => group);

    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    requestLogger.info("Fetched mobile templates", {
      total,
      page,
      pageSize,
    });

    const response = NextResponse.json({
      locale,
      categories,
      templatesBySubCategory,
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage,
      hasPrevPage,
    }, {
      headers: {
        "Cache-Control": "public, max-age=30",
      },
    });
    return attachRequestIdHeader(response, requestId);
  } catch (error) {
    requestLogger.error("Failed to fetch templates list", error, {});
    return attachRequestIdHeader(
      handleApiError(error, "Failed to fetch templates"),
      requestId
    );
  }
}
