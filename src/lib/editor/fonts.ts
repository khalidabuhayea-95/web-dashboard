import { MOBILE_FONT_CATALOG, isMobileFontName } from "@/lib/templates/fontCatalog";

export const DEFAULT_EDITOR_FONT_FAMILIES = MOBILE_FONT_CATALOG.map((font) => font.fontName);

const GENERIC_FONT_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

function stripWrappingQuotes(value: string) {
  return value.replace(/^['"]+|['"]+$/g, "").trim();
}

export function normalizeFontFamilyName(value: unknown): string {
  const input = String(value || "").trim();
  if (!input) return "";

  const primary = stripWrappingQuotes(input.split(",")[0] || "");
  if (!primary) return "";

  const normalizedKey = primary.toLowerCase();
  if (GENERIC_FONT_FAMILIES.has(normalizedKey)) return "";

  return primary.replace(/\s+/g, " ").trim();
}

export function normalizeFontFamilyList(values: unknown[]): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeFontFamilyName(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
}

export function mergeFontFamilies(base: string[], incoming: string[]): string[] {
  return normalizeFontFamilyList([...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

export function buildGoogleFontsStylesheetUrl(fontFamilies: string[]): string {
  const families = normalizeFontFamilyList(fontFamilies).filter((family) => !isMobileFontName(family));
  if (families.length === 0) return "";

  const familyParams = families.map((family) => {
    const encoded = encodeURIComponent(family).replace(/%20/g, "+");
    return `family=${encoded}`;
  });

  return `https://fonts.googleapis.com/css2?${familyParams.join("&")}&display=swap`;
}
