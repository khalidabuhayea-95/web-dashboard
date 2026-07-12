import {
  findFontFamiliesByNames,
  normalizeFontStorageKey,
} from "@/lib/editor/fontStorage.server";

export type PsdFontStatus = {
  name: string;
  available: boolean;
  // The catalog family name that actually matched (may differ from `name` when a
  // weight-stripped variant matched, e.g. "RobotoBold" → "Roboto").
  matchedAs?: string;
};

// Pure weight/slant tokens that are safe to strip from the end of a glued family
// name as a fallback match candidate. Deliberately excludes width/optical tokens
// (Condensed, Expanded, Display) since those are often part of the real family.
const TRAILING_WEIGHT =
  /(?:thin|extralight|ultralight|light|regular|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)+$/i;

// Candidate names to try against the library, most-specific first: the family as
// given, then the same with a trailing glued weight/slant removed. Matching is
// name-based, so trying both maximizes hits regardless of how the library named
// the font ("Roboto" vs "Roboto Bold").
function fontMatchCandidates(name: string): string[] {
  const base = String(name || "").trim();
  const candidates = [base];
  const stripped = base.replace(TRAILING_WEIGHT, "").trim();
  if (stripped.length >= 2 && stripped.toLowerCase() !== base.toLowerCase()) {
    candidates.push(stripped);
  }
  return candidates;
}

// Check which of the PSD's used font families exist in the FontFamily catalog
// (directly or via a FontAlias), matching by name. Text whose family is NOT
// available renders with a fallback font in the editor/mobile app, so this drives
// the coverage report + warnings in the PSD import tool.
export async function resolvePsdFontStatus(fontNames: string[]): Promise<PsdFontStatus[]> {
  const names = Array.from(
    new Set(
      (Array.isArray(fontNames) ? fontNames : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
  if (names.length === 0) return [];

  const candidatesByName = new Map(names.map((name) => [name, fontMatchCandidates(name)]));
  const allCandidates = Array.from(
    new Set(Array.from(candidatesByName.values()).flat())
  );

  const lookup = await findFontFamiliesByNames(allCandidates).catch(() => new Map());

  return names.map((name) => {
    const candidates = candidatesByName.get(name) || [name];
    const matched = candidates.find((candidate) => lookup.has(normalizeFontStorageKey(candidate)));
    return matched ? { name, available: true, matchedAs: matched } : { name, available: false };
  });
}
