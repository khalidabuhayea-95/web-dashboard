// Shared vocabulary for the AI Tools catalog, used by the admin API for
// validation and by the dashboard for its select options.
//
// Keep REFERENCE_KINDS in step with scripts/ai-templates/presets.mjs — the
// renderer resolves each kind to a sample photo of that subject, so a value
// that exists here but has no reference photo simply cannot be rendered.
export const AI_TEMPLATE_REFERENCE_KINDS = [
  // "none" means the prompt generates a whole design and takes no input photo.
  "none",
  // People — a single stock face cannot stand in for a couple or a family.
  "man",
  "woman",
  "couple",
  "family",
  "group",
  "child",
  "baby",
  "maternity",
  "hands",
  "damaged",
  // Objects and places.
  "product",
  "food",
  "apparel",
  "device",
  "jewelry",
  "furniture",
  "room",
  "car",
  "pet",
  "logo",
];

export const DEFAULT_AI_TEMPLATE_REFERENCE_KIND = "man";
export const DEFAULT_AI_TEMPLATE_CREDIT_COST = 8;
export const MAX_AI_TEMPLATE_TITLE_LENGTH = 120;
export const MAX_AI_TEMPLATE_PROMPT_LENGTH = 4000;

export function normalizeAiTemplateReferenceKind(value) {
  const normalized = String(value || "").trim();
  return AI_TEMPLATE_REFERENCE_KINDS.includes(normalized) ? normalized : "";
}

// Mirrors the slug shape the seed library produces, so hand-added templates and
// generated ones stay consistent: apostrophes drop out rather than becoming
// separators ("Men's" -> "mens", not "men-s").
export function slugifyAiTemplateTitle(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
