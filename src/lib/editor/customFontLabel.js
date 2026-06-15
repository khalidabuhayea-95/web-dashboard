import { normalizeFontFamilyName } from "@/lib/editor/fonts";

const SYNTHETIC_FAMILY_PATTERN = /^YA[A-Za-z0-9_-]+(?:_[0-9]+)?$/;

// True when `value` looks like a Canva opaque font id (e.g. "YADkLzugzJU_0")
// rather than a real human font name.
export function isSyntheticFontFamily(value) {
  return SYNTHETIC_FAMILY_PATTERN.test(String(value || "").trim());
}

export function deriveReadableFontLabel(font) {
  const family =
    normalizeFontFamilyName(font?.family || "") || String(font?.family || "").trim();
  const explicitDisplayName = String(font?.displayName || "").trim();

  if (explicitDisplayName && !SYNTHETIC_FAMILY_PATTERN.test(explicitDisplayName)) {
    return explicitDisplayName;
  }

  if (family && !SYNTHETIC_FAMILY_PATTERN.test(family)) {
    return family;
  }

  const rawFileName = String(font?.fileName || "").trim();
  if (!rawFileName) return family || explicitDisplayName || "Custom font";

  const noExtension = rawFileName.replace(/\.[^.]+$/, "");
  const segments = noExtension.split(".");
  const visibleSegments = [];
  for (const segment of segments) {
    const trimmed = String(segment || "").trim();
    if (!trimmed) continue;
    if (/^[a-f0-9]{6,}$/i.test(trimmed) || /^[0-9]{5,}$/.test(trimmed)) {
      break;
    }
    visibleSegments.push(trimmed);
  }

  const normalized = (visibleSegments.length > 0 ? visibleSegments : [segments[0] || noExtension])
    .join(" ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || family || explicitDisplayName || rawFileName;
}
