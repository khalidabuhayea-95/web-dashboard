import { NextResponse } from "next/server";
import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

import prisma from "@/lib/prisma";
import { MOBILE_PUBLIC_JSON_CACHE_SHORT } from "@/lib/mobile/cacheControl";
import { resolveTemplateAudience } from "@/lib/mobile/templateAudience.server";
import {
  createMobilePublicMediaUrlResolver,
  createTemplateAssetResolver,
} from "@/lib/mobile/templateAssets";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import {
  localizeCategoryOptions,
  prepareMobileTaxonomy,
  resolveCategoryFilterValue,
  resolveSubCategoryFilterValue,
} from "@/lib/mobile/taxonomy";
import { mergeTemplateWhere, templateCategoryWhere } from "@/lib/templates/categoryQuery";
import { FEATURED_FIRST_ORDER_BY, mergeRailRows } from "@/lib/templates/featured";
import { toMobileTemplate } from "@/lib/templates/mobileProject";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";
import { getActiveOccasionBoost } from "@/lib/occasions/boost.server";
import { applyOccasionCategoryOrder } from "@/lib/occasions/hoist";

const TEMPLATES_PER_SUBCATEGORY = 10;
const MAX_TEMPLATES_PER_SUBCATEGORY = 50;

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const RAIL_TEMPLATE_SELECT = {
  id: true,
  name: true,
  status: true,
  version: true,
  updatedAt: true,
  canvasSize: true,
  pageCount: true,
  isPremium: true,
  isFeatured: true,
  featuredAt: true,
  thumbnailDataUrl: true,
  previewVideoUrl: true,
  previewPosterUrl: true,
  previewStatus: true,
  previewDurationMs: true,
  previewVersion: true,
  previewUpdatedAt: true,
};

/**
 * One rail's templates: featured first (newest-featured first), then the occasion's boosted
 * templates in the occasion's own order, then the rest by recency. Without boosted ids it
 * is a single query. With them, two queries run in parallel under the SAME `where` (audience
 * status, category, tag/query filters — so a draft never leaks and a filtered-out template
 * is not pinned). The boosted query is not limited to `take`: it is bounded by the
 * snapshot's id cap, and limiting it by recency would drop templates the occasion lists first.
 */
async function fetchRailTemplates({ where, take, boostedIds }) {
  if (!boostedIds.length) {
    return prisma.template.findMany({
      where,
      orderBy: FEATURED_FIRST_ORDER_BY,
      take,
      select: RAIL_TEMPLATE_SELECT,
    });
  }
  const [boosted, rest] = await Promise.all([
    prisma.template.findMany({
      where: mergeTemplateWhere(where, { id: { in: boostedIds } }),
      select: RAIL_TEMPLATE_SELECT,
    }),
    prisma.template.findMany({
      where: mergeTemplateWhere(where, { id: { notIn: boostedIds } }),
      orderBy: FEATURED_FIRST_ORDER_BY,
      take,
      select: RAIL_TEMPLATE_SELECT,
    }),
  ]);
  return mergeRailRows({ boosted, rest, boostedIds, take });
}

export async function GET(request) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:by-subcategory",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const audience = await resolveTemplateAudience(request);
  const locale = resolveMobileLocale(request, searchParams);
  const taxonomySettings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(taxonomySettings);
  // Seasonal boost: while an occasion is active its linked categories move to the front
  // (the same reorder /templates/taxonomy and the grouped list apply, so tabs and rails
  // agree) and its linked templates lead their rails.
  const boost = await getActiveOccasionBoost();
  const localizedCategories = applyOccasionCategoryOrder(
    localizeCategoryOptions(taxonomy, locale),
    boost
  );

  const categoryIdParam = searchParams.get("categoryId");
  const subCategoryIdParam = searchParams.get("subCategoryId");
  const query = String(searchParams.get("query") || "").trim();
  const tag = String(searchParams.get("tag") || "").trim().toLowerCase();
  const templatesPerSubCategoryInput =
    searchParams.get("templatesPerSubCategory") ??
    searchParams.get("templates_per_sub_category") ??
    searchParams.get("perSubCategory") ??
    searchParams.get("limit");
  const templatesPerSubCategory = Math.min(
    Math.max(parsePositiveInt(templatesPerSubCategoryInput, TEMPLATES_PER_SUBCATEGORY), 1),
    MAX_TEMPLATES_PER_SUBCATEGORY
  );

  let categoryValue = resolveCategoryFilterValue(categoryIdParam, taxonomy);
  const subCategoryFilterInput = String(subCategoryIdParam || "").trim();

  if (!categoryValue && subCategoryFilterInput) {
    const inferredCategoryValue = taxonomy.categoryValueBySubCategoryId.get(
      subCategoryFilterInput.toLowerCase()
    );
    if (inferredCategoryValue) categoryValue = inferredCategoryValue;
  }

  if (categoryIdParam && !categoryValue) {
    return NextResponse.json({ error: "Invalid categoryId." }, { status: 400 });
  }

  const subCategoryValue = resolveSubCategoryFilterValue(
    subCategoryFilterInput,
    categoryValue,
    taxonomy
  );

  if (subCategoryFilterInput && !subCategoryValue) {
    return NextResponse.json({ error: "Invalid subCategoryId." }, { status: 400 });
  }

  const subCategoryDescriptors = localizedCategories
    .filter((category) => !categoryValue || String(category.value || "") === categoryValue)
    .flatMap((category) => {
      const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
      return subCategories
        .filter(
          (subCategory) =>
            !subCategoryValue || String(subCategory.value || "") === subCategoryValue
        )
        .map((subCategory) => ({
          category: {
            value: String(category.value || ""),
            label: String(category.label || ""),
          },
          subCategory: {
            value: String(subCategory.value || ""),
            label: String(subCategory.label || ""),
          },
        }));
    });

  const templateRowsPerSubCategory = await Promise.all(
    subCategoryDescriptors.map(({ category, subCategory }) => {
      // A rail that is itself linked to the occasion is all-boosted, so its order is
      // unchanged and the single query stays; other rails pin their boosted templates.
      const railIsLinked = boost.templateCategoryPairs.some(
        (pair) =>
          pair.category === category.value && (!pair.subCategory || pair.subCategory === subCategory.value)
      );
      const boostedIds = railIsLinked ? [] : boost.templateIdsByPair[`${category.value}::${subCategory.value}`] || [];
      return fetchRailTemplates({
        // Matches any placement, so a multi-category template shows up on every rail it
        // was assigned to rather than only its primary one.
        where: mergeTemplateWhere(
          audience.statusWhere,
          templateCategoryWhere({ category: category.value, subCategory: subCategory.value }),
          {
            ...(tag ? { tags: { array_contains: [tag] } } : {}),
            ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
          }
        ),
        take: templatesPerSubCategory,
        boostedIds,
      });
    })
  );

  const mediaUrlResolver = createMobilePublicMediaUrlResolver(request);
  const subCategories = subCategoryDescriptors.map((descriptor, index) => {
    const rows = templateRowsPerSubCategory[index] || [];
    const templates = rows.map((template) => {
      const assetResolver = createTemplateAssetResolver(request, template);
      const mobileTemplate = toMobileTemplate(template, {
        assetResolver,
        mediaUrlResolver,
        includeProject: false,
      });
      const previewStatus = String(mobileTemplate.preview?.status || "").trim().toLowerCase();
      const preview =
        previewStatus === "ready"
          ? {
              status: "ready",
              ...(typeof mobileTemplate.preview?.url === "string" && mobileTemplate.preview.url
                ? { url: mobileTemplate.preview.url }
                : {}),
              ...(typeof mobileTemplate.preview?.posterUrl === "string" &&
              mobileTemplate.preview.posterUrl
                ? { posterUrl: mobileTemplate.preview.posterUrl }
                : {}),
              ...(Number.isFinite(Number(mobileTemplate.preview?.durationMs))
                ? { durationMs: Math.max(0, Math.round(Number(mobileTemplate.preview.durationMs))) }
                : {}),
            }
          : null;

      return {
        id: mobileTemplate.id,
        title: mobileTemplate.title,
        canvasWidth: mobileTemplate.canvasWidth,
        canvasHeight: mobileTemplate.canvasHeight,
        pageCount: mobileTemplate.pageCount,
        thumbnailUrl: mobileTemplate.thumbnailUrl,
        // The home rails render from this slim shape, so the crown depends on it
        // being listed here — toMobileTemplate carrying the field is not enough.
        isPremium: Boolean(mobileTemplate.isPremium),
        isFeatured: Boolean(mobileTemplate.isFeatured),
        status: String(template.status || ""),
        ...(preview ? { preview } : {}),
        ...(preview?.url ? { previewVideoUrl: preview.url } : {}),
        ...(preview?.posterUrl ? { previewPosterUrl: preview.posterUrl } : {}),
      };
    });

    return {
      category: descriptor.category,
      subCategory: descriptor.subCategory,
      templates,
    };
  });

  return NextResponse.json(
    {
      subCategories,
    },
    { headers: audience.headers(MOBILE_PUBLIC_JSON_CACHE_SHORT) }
  );
}
