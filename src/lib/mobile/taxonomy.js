import { templateCategoryScopeWhere } from "@/lib/templates/categoryQuery";
import {
  normalizeTemplateCategory,
  normalizeTemplateSubCategory,
  resolveTemplateCategoryPairs,
  sanitizeTemplateCategorySettings,
} from "@/lib/templates/templateSettings";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveLabel(item, locale) {
  const labelEn = String(item?.labelEn || "").trim();
  const labelAr = String(item?.labelAr || "").trim();
  if (locale === "ar") return labelAr || labelEn || String(item?.value || "");
  return labelEn || labelAr || String(item?.value || "");
}

export function prepareMobileTaxonomy(settings) {
  const sanitizedCategories = sanitizeTemplateCategorySettings(settings);
  const publishedCategories = sanitizedCategories
    .filter((category) => category.published !== false)
    .map((category) => ({
      ...category,
      subCategories: (Array.isArray(category.subCategories) ? category.subCategories : []).filter(
        (subCategory) => subCategory.published !== false
      ),
    }))
    .filter((category) => category.subCategories.length > 0);
  const categories = publishedCategories;
  const categoryByValue = new Map(categories.map((item) => [String(item.value || ""), item]));
  const categoryById = new Map(categories.map((item) => [String(item.id || ""), item]));
  const categoryValueBySubCategoryId = new Map();
  categories.forEach((category) => {
    const categoryValue = String(category.value || "");
    (Array.isArray(category.subCategories) ? category.subCategories : []).forEach((subCategory) => {
      categoryValueBySubCategoryId.set(String(subCategory.id || ""), categoryValue);
    });
  });
  return { categories, categoryByValue, categoryById, categoryValueBySubCategoryId };
}

export function publishedTaxonomyPairs(taxonomy) {
  const categories = Array.isArray(taxonomy?.categories) ? taxonomy.categories : [];
  return categories.flatMap((category) =>
    (Array.isArray(category.subCategories) ? category.subCategories : []).map((subCategory) => ({
      category: String(category.value || ""),
      subCategory: String(subCategory.value || ""),
    }))
  );
}

export function buildPublishedTemplateScopeWhere(taxonomy) {
  return templateCategoryScopeWhere(publishedTaxonomyPairs(taxonomy));
}

/**
 * A multi-category template is in scope as soon as ONE of its placements survives the
 * published taxonomy — the rest are simply not rendered.
 */
export function isTemplateAllowedByTaxonomy(template, taxonomy) {
  const categories = Array.isArray(taxonomy?.categories) ? taxonomy.categories : [];
  if (categories.length === 0) return false;

  return resolveTemplateCategoryPairs(template, categories).some((pair) => {
    const category = taxonomy.categoryByValue?.get(pair.category) || null;
    if (!category) return false;
    const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
    return subCategories.some((item) => String(item.value || "") === pair.subCategory);
  });
}

export function resolveCategoryFilterValue(input, taxonomy) {
  const raw = String(input || "").trim();
  if (!raw) return undefined;

  const idMatch = taxonomy.categoryById.get(raw.toLowerCase());
  if (idMatch) return idMatch.value;

  const valueMatch = taxonomy.categories.find((item) => item.value === raw.toLowerCase());
  if (valueMatch) return valueMatch.value;

  const normalized = normalizeText(raw);
  const labelMatch = taxonomy.categories.find(
    (item) => normalizeText(item.labelEn) === normalized || normalizeText(item.labelAr) === normalized
  );
  if (labelMatch) return labelMatch.value;

  return undefined;
}

export function resolveSubCategoryFilterValue(input, categoryValue, taxonomy) {
  const raw = String(input || "").trim();
  if (!raw || !categoryValue) return undefined;

  const category = taxonomy.categoryByValue.get(categoryValue);
  const subCategories = Array.isArray(category?.subCategories) ? category.subCategories : [];
  const byId = subCategories.find((item) => String(item.id || "") === raw.toLowerCase());
  if (byId) return byId.value;

  const normalizedValue = raw.toLowerCase();
  const byValue = subCategories.find((item) => item.value === normalizedValue);
  if (byValue) return byValue.value;

  const normalized = normalizeText(raw);
  const byLabel = subCategories.find(
    (item) => normalizeText(item.labelEn) === normalized || normalizeText(item.labelAr) === normalized
  );
  if (byLabel) return byLabel.value;

  const normalizedResolvedValue = normalizeTemplateSubCategory(raw, categoryValue, taxonomy.categories);
  const exists = subCategories.some((item) => item.value === normalizedResolvedValue);
  return exists ? normalizedResolvedValue : undefined;
}

function localizePair(pair, taxonomy, locale) {
  const categoryValue = normalizeTemplateCategory(pair?.category, taxonomy.categories);
  const category = taxonomy.categoryByValue.get(categoryValue) || taxonomy.categories[0] || null;
  const subCategoryValue = normalizeTemplateSubCategory(
    pair?.subCategory,
    categoryValue,
    taxonomy.categories
  );
  const subCategory = Array.isArray(category?.subCategories)
    ? category.subCategories.find((item) => item.value === subCategoryValue) || category.subCategories[0] || null
    : null;

  return {
    categoryId: String(category?.id || ""),
    categoryValue,
    subCategoryId: String(subCategory?.id || ""),
    subCategoryValue,
    categoryLabel: resolveLabel(category, locale),
    subCategoryLabel: resolveLabel(subCategory, locale),
  };
}

/**
 * One placement in flat fields (what every client has always read), plus `placements` —
 * every placement the template appears under, primary first, narrowed to the published
 * taxonomy. Placements whose category or sub category is unpublished are dropped rather
 * than coerced, so an unpublished rail never leaks a label.
 */
export function localizeTemplateTaxonomy(template, taxonomy, locale) {
  const pairs = resolveTemplateCategoryPairs(template, taxonomy.categories);
  const primary = localizePair(pairs[0], taxonomy, locale);

  const placements = [];
  const seen = new Set();
  pairs.forEach((pair) => {
    const category = taxonomy.categoryByValue.get(pair.category);
    if (!category) return;
    const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
    if (!subCategories.some((item) => String(item.value || "") === pair.subCategory)) return;
    const localized = localizePair(pair, taxonomy, locale);
    const key = `${localized.categoryValue}::${localized.subCategoryValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    placements.push(localized);
  });

  // Flat fields describe the first placement that actually survives the published taxonomy.
  // Falling back to the raw primary here would coerce an unpublished category to "General"
  // and mislabel a template that is perfectly visible under one of its other placements.
  return {
    ...(placements[0] || primary),
    placements: placements.length > 0 ? placements : [primary],
  };
}

export function localizeCategoryOptions(taxonomy, locale) {
  return taxonomy.categories.map((category) => ({
    id: String(category.id || ""),
    value: String(category.value || ""),
    label: resolveLabel(category, locale),
    labelEn: String(category.labelEn || ""),
    labelAr: String(category.labelAr || ""),
    published: category.published !== false,
    subCategories: Array.isArray(category.subCategories)
      ? category.subCategories.map((subCategory) => ({
          id: String(subCategory.id || ""),
          categoryId: String(category.id || ""),
          value: String(subCategory.value || ""),
          label: resolveLabel(subCategory, locale),
          labelEn: String(subCategory.labelEn || ""),
          labelAr: String(subCategory.labelAr || ""),
          published: subCategory.published !== false,
        }))
      : [],
  }));
}
