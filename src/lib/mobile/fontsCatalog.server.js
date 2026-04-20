import { performance } from "node:perf_hooks";

import {
  findFontFamiliesByNames,
  listFontFamilies,
  normalizeFontStorageKey,
  toMobileFontRecord,
} from "@/lib/editor/fontStorage.server";

function roundTiming(value) {
  return Math.round(value * 100) / 100;
}

export function normalizeMobileFontCategory(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeMobileFontKey(value) {
  return normalizeFontStorageKey(value);
}

function dedupeMobileFonts(fonts = []) {
  const byId = new Set();
  const byFamily = new Set();
  return fonts.filter((font) => {
    if (!font) return false;
    const idKey = String(font.id || "").trim();
    const familyKey = normalizeMobileFontKey(font.fontName);
    if (idKey && byId.has(idKey)) return false;
    if (familyKey && byFamily.has(familyKey)) return false;
    if (idKey) byId.add(idKey);
    if (familyKey) byFamily.add(familyKey);
    return true;
  });
}

export async function buildMobileFontCatalog(request) {
  const fonts = await listFontFamilies();
  return dedupeMobileFonts(
    fonts.map((font) => toMobileFontRecord(request, font)).filter(Boolean)
  );
}

export async function buildMobileFontCatalogLookupByNames(request, fontNames = [], options = {}) {
  const diagnostics =
    options &&
    typeof options === "object" &&
    options.diagnostics &&
    typeof options.diagnostics === "object"
      ? options.diagnostics
      : null;
  const startedAt = performance.now();
  const requestedKeys = Array.from(
    new Set(
      (Array.isArray(fontNames) ? fontNames : [])
        .map((value) => normalizeMobileFontKey(value))
        .filter(Boolean)
    )
  );

  if (requestedKeys.length === 0) {
    if (diagnostics) {
      diagnostics.source = "font_tables";
      diagnostics.cacheHit = false;
      diagnostics.requestedFontCount = 0;
      diagnostics.matchedFontCount = 0;
      diagnostics.queryMs = 0;
      diagnostics.totalMs = roundTiming(performance.now() - startedAt);
    }
    return new Map();
  }

  const queryStartedAt = performance.now();
  const fontLookup = await findFontFamiliesByNames(fontNames);
  const queryMs = roundTiming(performance.now() - queryStartedAt);

  const lookup = new Map();
  for (const key of requestedKeys) {
    const font = fontLookup.get(key);
    if (!font) continue;
    const mobileFont = toMobileFontRecord(request, font);
    if (!mobileFont) continue;
    lookup.set(key, mobileFont);
  }

  if (diagnostics) {
    diagnostics.source = "font_tables";
    diagnostics.cacheHit = false;
    diagnostics.requestedFontCount = requestedKeys.length;
    diagnostics.matchedFontCount = lookup.size;
    diagnostics.queryMs = queryMs;
    diagnostics.totalMs = roundTiming(performance.now() - startedAt);
  }

  return lookup;
}
