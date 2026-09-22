export const DEFAULT_TEMPLATE_CATEGORY = "general";
export const DEFAULT_TEMPLATE_SUBCATEGORY = "general";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hash32(input, seed = 2166136261) {
  let hash = seed >>> 0;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function guidFromSeed(seed) {
  const h1 = hash32(`a:${seed}`).toString(16).padStart(8, "0");
  const h2 = hash32(`b:${seed}`).toString(16).padStart(8, "0");
  const h3 = hash32(`c:${seed}`).toString(16).padStart(8, "0");
  const h4 = hash32(`d:${seed}`).toString(16).padStart(8, "0");
  const hex = `${h1}${h2}${h3}${h4}`.slice(0, 32).split("");
  hex[12] = "4";
  const variant = (Number.parseInt(hex[16] || "0", 16) & 0x3) | 0x8;
  hex[16] = variant.toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(
    16,
    20
  )}-${joined.slice(20, 32)}`;
}

function normalizeGuid(value) {
  const raw = String(value || "").trim().toLowerCase();
  return GUID_PATTERN.test(raw) ? raw : "";
}

export const TEMPLATE_CATEGORY_SETTINGS = [
  {
    value: "general",
    labelEn: "General",
    labelAr: "عام",
    subCategories: [
      { value: "general", labelEn: "General", labelAr: "عام" },
      { value: "campaign", labelEn: "Campaign", labelAr: "حملة" },
      { value: "announcement", labelEn: "Announcement", labelAr: "إعلان" },
    ],
  },
  {
    value: "social",
    labelEn: "Social",
    labelAr: "اجتماعي",
    subCategories: [
      { value: "story", labelEn: "Story", labelAr: "قصة" },
      { value: "post", labelEn: "Post", labelAr: "منشور" },
      { value: "reel", labelEn: "Reel", labelAr: "ريل" },
    ],
  },
  {
    value: "business",
    labelEn: "Business",
    labelAr: "أعمال",
    subCategories: [
      { value: "branding", labelEn: "Branding", labelAr: "هوية" },
      { value: "quote", labelEn: "Quote", labelAr: "اقتباس" },
      { value: "promotion", labelEn: "Promotion", labelAr: "ترويج" },
    ],
  },
  {
    value: "education",
    labelEn: "Education",
    labelAr: "تعليم",
    subCategories: [
      { value: "course", labelEn: "Course", labelAr: "دورة" },
      { value: "workshop", labelEn: "Workshop", labelAr: "ورشة" },
      { value: "exam", labelEn: "Exam", labelAr: "اختبار" },
    ],
  },
  {
    value: "events",
    labelEn: "Events",
    labelAr: "مناسبات",
    subCategories: [
      { value: "invitation", labelEn: "Invitation", labelAr: "دعوة" },
      { value: "conference", labelEn: "Conference", labelAr: "مؤتمر" },
      { value: "celebration", labelEn: "Celebration", labelAr: "احتفال" },
    ],
  },
  {
    value: "ramadan",
    labelEn: "Ramadan",
    labelAr: "رمضان",
    subCategories: [
      { value: "greeting", labelEn: "Greeting", labelAr: "تهنئة" },
      { value: "iftar", labelEn: "Iftar", labelAr: "إفطار" },
      { value: "eid", labelEn: "Eid", labelAr: "عيد" },
    ],
  },
];

function toKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toText(value, fallback = "General") {
  const raw = String(value || "").trim();
  if (raw.length > 0) return raw.slice(0, 60);
  return fallback;
}

function resolveGuid(value, seed) {
  return normalizeGuid(value) || guidFromSeed(seed);
}

function resolveLocalizedValue(item, locale = "en", fallback = "General") {
  if (locale === "ar") return toText(item?.labelAr, toText(item?.labelEn, fallback));
  return toText(item?.labelEn, toText(item?.labelAr, fallback));
}

function fallbackCategoryValue(settings) {
  return (
    settings.find((item) => item.value === DEFAULT_TEMPLATE_CATEGORY)?.value ||
    settings[0]?.value ||
    DEFAULT_TEMPLATE_CATEGORY
  );
}

function fallbackSubCategoryValue(categorySetting) {
  return (
    categorySetting?.subCategories?.find((item) => item.value === DEFAULT_TEMPLATE_SUBCATEGORY)?.value ||
    categorySetting?.subCategories?.[0]?.value ||
    DEFAULT_TEMPLATE_SUBCATEGORY
  );
}

export function sanitizeTemplateCategorySettings(input) {
  const source = Array.isArray(input) ? input : [];
  const categories = [];
  const usedCategoryValues = new Set();
  const usedCategoryIds = new Set();

  source.forEach((category, categoryIndex) => {
    const rawCategoryEn = String(category?.labelEn || category?.label || "").trim();
    const rawCategoryAr = String(category?.labelAr || "").trim();
    const categoryValue = toKey(category?.value || rawCategoryEn || `category-${categoryIndex + 1}`);
    if (!categoryValue || usedCategoryValues.has(categoryValue)) return;
    const categoryIdSeed = `category:${categoryValue}`;
    let categoryId = resolveGuid(category?.id, categoryIdSeed);
    let categoryIdSuffix = 1;
    while (usedCategoryIds.has(categoryId)) {
      categoryId = guidFromSeed(`${categoryIdSeed}:${categoryIdSuffix}`);
      categoryIdSuffix += 1;
    }
    const categoryPublished = typeof category?.published === "boolean" ? category.published : true;

    const subCategories = [];
    const usedSubCategoryValues = new Set();
    const usedSubCategoryIds = new Set();
    const rawSubCategories = Array.isArray(category?.subCategories) ? category.subCategories : [];

    rawSubCategories.forEach((subCategory, subCategoryIndex) => {
      const rawSubCategoryEn = String(subCategory?.labelEn || subCategory?.label || "").trim();
      const rawSubCategoryAr = String(subCategory?.labelAr || "").trim();
      const subCategoryValue = toKey(
        subCategory?.value || rawSubCategoryEn || `sub-category-${subCategoryIndex + 1}`
      );
      if (!subCategoryValue || usedSubCategoryValues.has(subCategoryValue)) return;
      const subCategoryIdSeed = `subcategory:${categoryValue}:${subCategoryValue}`;
      let subCategoryId = resolveGuid(subCategory?.id, subCategoryIdSeed);
      let subCategoryIdSuffix = 1;
      while (usedSubCategoryIds.has(subCategoryId)) {
        subCategoryId = guidFromSeed(`${subCategoryIdSeed}:${subCategoryIdSuffix}`);
        subCategoryIdSuffix += 1;
      }
      const subCategoryPublished =
        typeof subCategory?.published === "boolean" ? subCategory.published : true;

      subCategories.push({
        id: subCategoryId,
        value: subCategoryValue,
        labelEn: toText(rawSubCategoryEn, subCategoryValue),
        labelAr: toText(rawSubCategoryAr, rawSubCategoryEn || subCategoryValue),
        published: subCategoryPublished,
      });
      usedSubCategoryValues.add(subCategoryValue);
      usedSubCategoryIds.add(subCategoryId);
    });

    if (subCategories.length === 0) {
      subCategories.push({
        id: resolveGuid("", `subcategory:${categoryValue}:${DEFAULT_TEMPLATE_SUBCATEGORY}`),
        value: DEFAULT_TEMPLATE_SUBCATEGORY,
        labelEn: "General",
        labelAr: "عام",
        published: true,
      });
    }

    categories.push({
      id: categoryId,
      value: categoryValue,
      labelEn: toText(rawCategoryEn, categoryValue),
      labelAr: toText(rawCategoryAr, rawCategoryEn || categoryValue),
      published: categoryPublished,
      subCategories,
    });
    usedCategoryValues.add(categoryValue);
    usedCategoryIds.add(categoryId);
  });

  if (categories.length === 0) {
    return sanitizeTemplateCategorySettings(TEMPLATE_CATEGORY_SETTINGS);
  }

  // No forced "general" category: re-adding it here made it undeletable, and Remove looked
  // like it worked until the save came back with the category still there. Callers already
  // degrade to settings[0] when the default value is absent (see fallbackCategoryValue).

  return categories;
}

function buildCategoryIndex(settings) {
  const normalizedSettings = sanitizeTemplateCategorySettings(settings);
  const categoryByValue = new Map(normalizedSettings.map((item) => [item.value, item]));
  const categoryById = new Map(normalizedSettings.map((item) => [String(item.id || ""), item]));
  const allSubCategoryValues = new Set(
    normalizedSettings.flatMap((item) => item.subCategories.map((subCategory) => subCategory.value))
  );
  const allSubCategoryIds = new Set(
    normalizedSettings.flatMap((item) => item.subCategories.map((subCategory) => String(subCategory.id || "")))
  );
  const subCategoryIdToValue = new Map(
    normalizedSettings.flatMap((item) =>
      item.subCategories.map((subCategory) => [String(subCategory.id || ""), subCategory.value])
    )
  );
  return {
    normalizedSettings,
    categoryByValue,
    categoryById,
    allSubCategoryValues,
    allSubCategoryIds,
    subCategoryIdToValue,
  };
}

export function normalizeTemplateCategory(value, settings = TEMPLATE_CATEGORY_SETTINGS) {
  const { normalizedSettings, categoryByValue, categoryById } = buildCategoryIndex(settings);
  const raw = String(value || "").trim();
  const key = toKey(raw);
  if (categoryByValue.has(key)) return key;

  const byId = categoryById.get(normalizeGuid(raw));
  if (byId?.value) return byId.value;

  return fallbackCategoryValue(normalizedSettings);
}

export function normalizeTemplateSubCategory(
  value,
  category,
  settings = TEMPLATE_CATEGORY_SETTINGS
) {
  const {
    normalizedSettings,
    categoryByValue,
    allSubCategoryValues,
    allSubCategoryIds,
    subCategoryIdToValue,
  } = buildCategoryIndex(settings);
  const raw = String(value || "").trim();
  const key = toKey(raw);
  const id = normalizeGuid(raw);

  if (typeof category === "string") {
    const categoryKey = normalizeTemplateCategory(category, normalizedSettings);
    const categorySetting = categoryByValue.get(categoryKey);
    const subCategories = categorySetting?.subCategories || [];
    const fallback = fallbackSubCategoryValue(categorySetting);
    if (!key && !id) return fallback;
    if (id) {
      const byId = subCategories.find((item) => String(item.id || "") === id);
      if (byId?.value) return byId.value;
    }
    const subSet = new Set(subCategories.map((item) => item.value));
    return subSet.has(key) ? key : fallback;
  }

  if (!key && !id) return DEFAULT_TEMPLATE_SUBCATEGORY;
  if (id && allSubCategoryIds.has(id)) {
    return subCategoryIdToValue.get(id) || DEFAULT_TEMPLATE_SUBCATEGORY;
  }
  return allSubCategoryValues.has(key) ? key : DEFAULT_TEMPLATE_SUBCATEGORY;
}

export function getTemplateCategoryOptions(settings = TEMPLATE_CATEGORY_SETTINGS, locale = "en") {
  const normalizedSettings = sanitizeTemplateCategorySettings(settings);
  const visibleCategories = normalizedSettings.filter((item) => item.published !== false);
  const source = visibleCategories.length > 0 ? visibleCategories : normalizedSettings;
  return source.map((item) => ({
    id: item.id,
    value: item.value,
    label: resolveLocalizedValue(item, locale, item.value),
    labelEn: item.labelEn,
    labelAr: item.labelAr,
    published: item.published !== false,
  }));
}

export function getTemplateSubCategoryOptions(
  category,
  settings = TEMPLATE_CATEGORY_SETTINGS,
  locale = "en"
) {
  const { normalizedSettings, categoryByValue } = buildCategoryIndex(settings);
  const visibleCategories = normalizedSettings.filter((item) => item.published !== false);
  const sourceCategories = visibleCategories.length > 0 ? visibleCategories : normalizedSettings;
  const categoryKey = normalizeTemplateCategory(category, sourceCategories);
  const sourceCategoryByValue = new Map(sourceCategories.map((item) => [item.value, item]));
  const item =
    sourceCategoryByValue.get(categoryKey) ||
    sourceCategoryByValue.get(fallbackCategoryValue(sourceCategories)) ||
    categoryByValue.get(categoryKey) ||
    categoryByValue.get(fallbackCategoryValue(normalizedSettings)) ||
    null;
  const subCategories = (item?.subCategories || []).filter((subCategory) => subCategory.published !== false);
  const sourceSubCategories = subCategories.length > 0 ? subCategories : item?.subCategories || [];
  return sourceSubCategories.map((subCategory) => ({
    id: subCategory.id,
    categoryId: item?.id || "",
    value: subCategory.value,
    label: resolveLocalizedValue(subCategory, locale, subCategory.value),
    labelEn: subCategory.labelEn,
    labelAr: subCategory.labelAr,
    published: subCategory.published !== false,
  }));
}

/**
 * A template can sit in several places in the taxonomy at once. Each placement is a
 * `{ category, subCategory }` pair — a bare category is meaningless here because every
 * sub category belongs to exactly one parent. The first pair is the primary placement and
 * is mirrored into the scalar `Template.category` / `Template.subCategory` columns, which
 * older mobile builds (and the hot-path composite index) still read.
 */
export const MAX_TEMPLATE_CATEGORIES = 12;

export function templateCategoryPairKey(pair) {
  return `${String(pair?.category || "")}::${String(pair?.subCategory || "")}`;
}

function strictCategoryValue(value, index) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = toKey(raw);
  if (index.categoryByValue.has(key)) return key;
  const byId = index.categoryById.get(normalizeGuid(raw));
  return byId?.value || "";
}

function strictSubCategoryValue(value, categorySetting) {
  const subCategories = categorySetting?.subCategories || [];
  const raw = String(value || "").trim();
  const key = toKey(raw);
  const id = normalizeGuid(raw);
  if (id) {
    const byId = subCategories.find((item) => String(item.id || "") === id);
    if (byId?.value) return byId.value;
  }
  const byValue = subCategories.find((item) => item.value === key);
  if (byValue?.value) return byValue.value;
  return fallbackSubCategoryValue(categorySetting);
}

/** Pull `{ category, subCategory }` out of the several shapes clients send. */
function readCategoryPairInput(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const [category, subCategory] = entry.split(/[/:]/, 2);
    return { category, subCategory };
  }
  if (typeof entry !== "object") return null;
  return {
    category: entry.category ?? entry.categoryValue ?? entry.categoryId ?? "",
    subCategory: entry.subCategory ?? entry.subCategoryValue ?? entry.subCategoryId ?? "",
  };
}

/**
 * Normalize a list of placements: unknown categories are dropped, unknown sub categories
 * fall back to their parent's first one, duplicates collapse, and the list is capped.
 * `primary` (the legacy scalar pair) seeds the result when the list is empty or missing,
 * so a caller that only knows the old fields still gets a valid single placement back.
 */
export function normalizeTemplateCategoryPairs(
  input,
  settings = TEMPLATE_CATEGORY_SETTINGS,
  primary = null
) {
  const index = buildCategoryIndex(settings);
  const source = Array.isArray(input) ? input : [];
  const pairs = [];
  const seen = new Set();

  source.forEach((entry) => {
    if (pairs.length >= MAX_TEMPLATE_CATEGORIES) return;
    const raw = readCategoryPairInput(entry);
    if (!raw) return;
    const category = strictCategoryValue(raw.category, index);
    if (!category) return;
    const subCategory = strictSubCategoryValue(raw.subCategory, index.categoryByValue.get(category));
    const pair = { category, subCategory };
    const key = templateCategoryPairKey(pair);
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(pair);
  });

  if (pairs.length > 0) return pairs;

  const category = normalizeTemplateCategory(primary?.category, index.normalizedSettings);
  return [
    {
      category,
      subCategory: normalizeTemplateSubCategory(
        primary?.subCategory,
        category,
        index.normalizedSettings
      ),
    },
  ];
}

/**
 * Read side of the same contract. Rows written before the multi-category migration (and any
 * writer that only set the scalars) have no `categories`, so fall back to the primary pair.
 */
export function resolveTemplateCategoryPairs(template, settings = TEMPLATE_CATEGORY_SETTINGS) {
  return normalizeTemplateCategoryPairs(template?.categories, settings, {
    category: template?.category,
    subCategory: template?.subCategory,
  });
}

/**
 * Single place that keeps the scalar primary pair and the `categories` list consistent for
 * a write. `existingCategories` matters on update: a payload without a `categories` key
 * (an older client, or a code path that only knows the scalars) keeps the placements the
 * row already had instead of silently pulling the template out of its other rails, while
 * an explicit scalar pair still becomes the new primary.
 */
export function buildTemplateCategoryFields(input, settings = TEMPLATE_CATEGORY_SETTINGS) {
  const primary = { category: input?.category, subCategory: input?.subCategory };
  const source = Array.isArray(input?.categories)
    ? input.categories
    : [
        ...(String(input?.category || "").trim() ? [primary] : []),
        ...(Array.isArray(input?.existingCategories) ? input.existingCategories : []),
      ];
  const pairs = normalizeTemplateCategoryPairs(source, settings, primary);
  return {
    category: pairs[0].category,
    subCategory: pairs[0].subCategory,
    categories: pairs,
  };
}
