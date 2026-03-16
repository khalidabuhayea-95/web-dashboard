import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { createTemplateAssetResolver } from "@/lib/mobile/templateAssets";
import { resolveMobileLocale } from "@/lib/mobile/locale";
import {
  localizeCategoryOptions,
  localizeTemplateTaxonomy,
  prepareMobileTaxonomy,
  resolveCategoryFilterValue,
  resolveSubCategoryFilterValue,
} from "@/lib/mobile/taxonomy";
import { toMobileTemplate } from "@/lib/templates/mobileProject";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

const TEMPLATES_PER_SUBCATEGORY = 10;
const MAX_TEMPLATES_PER_SUBCATEGORY = 50;

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveMobileLocale(request, searchParams);
  const taxonomySettings = await getTemplateTaxonomySettings();
  const taxonomy = prepareMobileTaxonomy(taxonomySettings);
  const localizedCategories = localizeCategoryOptions(taxonomy, locale);

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
            id: String(category.id || ""),
            value: String(category.value || ""),
            label: String(category.label || ""),
          },
          subCategory: {
            id: String(subCategory.id || ""),
            categoryId: String(subCategory.categoryId || category.id || ""),
            value: String(subCategory.value || ""),
            label: String(subCategory.label || ""),
          },
        }));
    });

  const templateRowsPerSubCategory = await Promise.all(
    subCategoryDescriptors.map(({ category, subCategory }) =>
      prisma.template.findMany({
        where: {
          status: "published",
          category: category.value,
          subCategory: subCategory.value,
          ...(tag ? { tags: { array_contains: [tag] } } : {}),
          ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: templatesPerSubCategory,
        select: {
          id: true,
          name: true,
          version: true,
          category: true,
          subCategory: true,
          tags: true,
          canvasSize: true,
          thumbnailDataUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    )
  );

  const subCategories = subCategoryDescriptors.map((descriptor, index) => {
    const rows = templateRowsPerSubCategory[index] || [];
    const templates = rows.map((template) => {
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

    return {
      category: descriptor.category,
      subCategory: descriptor.subCategory,
      templates,
    };
  });

  return NextResponse.json(
    {
      locale,
      templatesPerSubCategory,
      subCategories,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30",
      },
    }
  );
}
