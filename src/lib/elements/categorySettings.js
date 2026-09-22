export const DEFAULT_ELEMENT_CATEGORY = "general";
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

/**
 * Element categories are THEMES ONLY — never a type.
 *
 * Shapes, frames and the elements grid are already separate entry points in the mobile editor's
 * bottom bar, so a type-shaped category ("shapes", "icons") would give the same asset two ways in.
 * That is the one rule the reference app breaks: its chips mix أشكال/حروف (type) with مناسبات
 * (theme) because it has a single unified picker. We don't.
 *
 * Sub-categories are deliberately absent too. What looks like a sub-category over there — «حروف
 * ذهبية», «ملصقات دعوات» — is a curated rail, reproducible here from `tags_ar` plus Freepik's
 * own `family_name`, without a second taxonomy to maintain forever.
 */

// The Magnific endpoint a category imports from. Stock (`v1/resources`) carries stickers and
// cut-outs; Icons (`v1/icons`) carries flat icon sets and is the only one where transparency is
// guaranteed rather than a property of the individual asset.
export const ELEMENT_IMPORT_SOURCES = ["stock", "icons"];
// Stock content types only. There is no "png" type in the Magnific stock API — transparent
// cut-outs arrive as `psd`, and drawn elements as `vector`; the search term is what narrows to
// isolated artwork, which is why every seeded term carries "isolated"/"png"/"sticker".
export const ELEMENT_IMPORT_CONTENT_TYPES = ["all", "psd", "vector", "photo"];
const SEARCH_TERM_MAX_COUNT = 12;
const SEARCH_TERM_MAX_LENGTH = 80;

export const ELEMENT_CATEGORY_SETTINGS = [
  {
    value: DEFAULT_ELEMENT_CATEGORY,
    labelEn: "General",
    labelAr: "عام",
    thumbnailUrl: "",
    published: true,
    searchTerms: [],
    importSource: "stock",
    importContentType: "all",
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

function toUrl(value) {
  return String(value || "").trim().slice(0, 2048);
}

// Accepts the stored array or the comma/newline-separated text the settings form edits.
export function toSearchTerms(value) {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  const terms = [];
  const seen = new Set();
  for (const part of parts) {
    const term = String(part || "").replace(/\s+/g, " ").trim().slice(0, SEARCH_TERM_MAX_LENGTH);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= SEARCH_TERM_MAX_COUNT) break;
  }
  return terms;
}

function toChoice(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function resolveGuid(value, seed) {
  return normalizeGuid(value) || guidFromSeed(seed);
}

function fallbackCategoryValue(settings) {
  return (
    settings.find((item) => item.value === DEFAULT_ELEMENT_CATEGORY)?.value ||
    settings[0]?.value ||
    DEFAULT_ELEMENT_CATEGORY
  );
}

export function sanitizeElementCategorySettings(input) {
  const source = Array.isArray(input) ? input : [];
  const categories = [];
  const usedValues = new Set();
  const usedIds = new Set();

  source.forEach((category, categoryIndex) => {
    const rawLabelEn = String(category?.labelEn || category?.label || "").trim();
    const rawLabelAr = String(category?.labelAr || "").trim();
    const value = toKey(category?.value || rawLabelEn || `element-category-${categoryIndex + 1}`);
    if (!value || usedValues.has(value)) return;

    const idSeed = `element-category:${value}`;
    let id = resolveGuid(category?.id, idSeed);
    let idSuffix = 1;
    while (usedIds.has(id)) {
      id = guidFromSeed(`${idSeed}:${idSuffix}`);
      idSuffix += 1;
    }

    categories.push({
      id,
      value,
      labelEn: toText(rawLabelEn, value),
      labelAr: toText(rawLabelAr, rawLabelEn || value),
      thumbnailUrl: toUrl(category?.thumbnailUrl || category?.thumbnail || ""),
      published: typeof category?.published === "boolean" ? category.published : true,
      searchTerms: toSearchTerms(category?.searchTerms),
      importSource: toChoice(category?.importSource, ELEMENT_IMPORT_SOURCES, "stock"),
      importContentType: toChoice(category?.importContentType, ELEMENT_IMPORT_CONTENT_TYPES, "all"),
    });
    usedValues.add(value);
    usedIds.add(id);
  });

  if (categories.length === 0) {
    return sanitizeElementCategorySettings(ELEMENT_CATEGORY_SETTINGS);
  }

  // No forced "general" category, for the same reason the background sanitizer dropped it:
  // re-adding it here made it undeletable, and Remove looked like it worked until the save came
  // back with the category still present. Callers degrade to settings[0] instead.

  return categories;
}

export function normalizeElementCategory(value, settings = ELEMENT_CATEGORY_SETTINGS) {
  const normalizedSettings = sanitizeElementCategorySettings(settings);
  const key = toKey(value);
  const id = normalizeGuid(value);

  if (!key && !id) return fallbackCategoryValue(normalizedSettings);

  const byValue = normalizedSettings.find((item) => item.value === key);
  if (byValue) return byValue.value;

  const byId = normalizedSettings.find((item) => String(item.id || "") === id);
  if (byId) return byId.value;

  return fallbackCategoryValue(normalizedSettings);
}

export function getElementCategoryOptions(settings = ELEMENT_CATEGORY_SETTINGS, locale = "en") {
  const normalizedSettings = sanitizeElementCategorySettings(settings);
  const visibleCategories = normalizedSettings.filter((item) => item.published !== false);
  const source = visibleCategories.length > 0 ? visibleCategories : normalizedSettings;

  return source.map((item) => ({
    id: item.id,
    value: item.value,
    label:
      locale === "ar"
        ? toText(item.labelAr, item.labelEn || item.value)
        : toText(item.labelEn, item.labelAr || item.value),
    labelEn: item.labelEn,
    labelAr: item.labelAr,
    thumbnailUrl: item.thumbnailUrl || "",
    published: item.published !== false,
  }));
}
