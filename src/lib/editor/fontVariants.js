// Weight/style ⇄ FontFile.kind. Pure (no prisma), so tests and planners can use it; the server
// storage module re-exports everything here.

export const FONT_FILE_KIND_ORIGINAL = "original";
export const FONT_FILE_KIND_MOBILE = "mobile";

export const DEFAULT_FONT_WEIGHT = 400;
export const DEFAULT_FONT_STYLE = "normal";

export function normalizeFontWeightValue(value) {
  const weight = Math.round(Number(value));
  if (!Number.isFinite(weight)) return DEFAULT_FONT_WEIGHT;
  return Math.max(100, Math.min(900, weight));
}

export function normalizeFontStyleValue(value) {
  return String(value || "").trim().toLowerCase() === "italic" ? "italic" : DEFAULT_FONT_STYLE;
}

export function isDefaultFontVariant(weight, style) {
  return (
    normalizeFontWeightValue(weight) === DEFAULT_FONT_WEIGHT &&
    normalizeFontStyleValue(style) === DEFAULT_FONT_STYLE
  );
}

/**
 * FontFile.kind carries BOTH the file's purpose and its variant, because the table is unique on
 * (fontId, kind). The family's default face keeps the bare kind ("mobile") so every pre-existing
 * row stays valid and every existing reader keeps finding it; any other weight/style is suffixed
 * ("mobile@700", "mobile@400i"). One family can then hold every weight a design uses — Canva
 * routinely ships two or three under a single family name.
 */
export function buildFontFileKind(baseKind, weight, style) {
  const base = String(baseKind || FONT_FILE_KIND_MOBILE).trim().toLowerCase();
  if (isDefaultFontVariant(weight, style)) return base;
  const normalizedWeight = normalizeFontWeightValue(weight);
  const suffix = normalizeFontStyleValue(style) === "italic" ? "i" : "";
  return `${base}@${normalizedWeight}${suffix}`;
}

/** The weight/style a stored file represents (null columns = the default 400/normal face). */
export function readFontFileVariant(file) {
  return {
    weight: normalizeFontWeightValue(
      file?.fontWeight === null || typeof file?.fontWeight === "undefined"
        ? DEFAULT_FONT_WEIGHT
        : file.fontWeight
    ),
    style: normalizeFontStyleValue(file?.fontStyle || DEFAULT_FONT_STYLE),
  };
}
