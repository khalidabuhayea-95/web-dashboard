export const FONT_CATEGORIES = ["INSTALLED", "EXCLUSIVE", "ENGLISH", "ARABIC"];

export const FONT_CATEGORY_LABELS = {
  INSTALLED: "Installed",
  EXCLUSIVE: "Exclusive",
  ENGLISH: "English",
  ARABIC: "Arabic",
};

export const MOBILE_FONT_CATALOG = [
  {
    id: "font-badeen-display-regular",
    fontName: "BadeenDisplayRegular",
    displayName: "Badeen Display Regular",
    previewText: "Badeen",
    categories: ["ENGLISH", "EXCLUSIVE"],
    previewWeight: 800,
    cssFontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
  {
    id: "font-graphic-school-regular",
    fontName: "GraphicSchoolRegular",
    displayName: "Graphic School Regular",
    previewText: "GRAPHIC SCHOOL",
    categories: ["ENGLISH", "EXCLUSIVE"],
    previewWeight: 700,
    cssFontFamily: "'Brush Script MT', cursive",
  },
  {
    id: "font-mt-lombardia-luxury",
    fontName: "MTLombardiaLuxury",
    displayName: "MT Lombardia Luxury",
    previewText: "لومباردي",
    categories: ["ARABIC"],
    previewWeight: 500,
    cssFontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  },
  {
    id: "font-mt-strawberry-solid",
    fontName: "MTStrawberrySolid",
    displayName: "MT-STRAWBERRY Solid",
    previewText: "فراولة",
    categories: ["ARABIC"],
    previewWeight: 800,
    cssFontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  },
  {
    id: "font-mt-nitro-display",
    fontName: "MTNitroDisplay",
    displayName: "MT Nitro Display",
    previewText: "ترو",
    categories: ["ARABIC"],
    previewWeight: 500,
    cssFontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
  {
    id: "font-voxo-r",
    fontName: "VOXOR",
    displayName: "VOXO R",
    previewText: "فوكسو",
    categories: ["ARABIC"],
    previewWeight: 500,
    cssFontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  },
  {
    id: "font-voxo-b",
    fontName: "VOXOB",
    displayName: "VOXO B",
    previewText: "فوكسو",
    categories: ["ARABIC", "EXCLUSIVE"],
    previewWeight: 700,
    cssFontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  },
  {
    id: "font-haya-semibold",
    fontName: "HAYA_SemiBold",
    displayName: "HAYA SemiBold",
    previewText: "هيا",
    categories: ["ARABIC"],
    previewWeight: 600,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-haya-extrabold",
    fontName: "HAYA_ExtraBold",
    displayName: "HAYA ExtraBold",
    previewText: "هيا",
    categories: ["ARABIC", "EXCLUSIVE"],
    previewWeight: 800,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-haya-bold",
    fontName: "HAYA_Bold",
    displayName: "HAYA Bold",
    previewText: "هيا",
    categories: ["ARABIC", "EXCLUSIVE"],
    previewWeight: 700,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-haya-black",
    fontName: "HAYA_Black",
    displayName: "HAYA Black",
    previewText: "هيا",
    categories: ["ARABIC", "EXCLUSIVE"],
    previewWeight: 900,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-haya-regular",
    fontName: "HAYA_Regular",
    displayName: "HAYA Regular",
    previewText: "هيا",
    categories: ["ARABIC", "INSTALLED"],
    previewWeight: 400,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-trox-r",
    fontName: "TROXR",
    displayName: "TROX R",
    previewText: "تروكس",
    categories: ["ARABIC", "EXCLUSIVE"],
    previewWeight: 700,
    cssFontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
  {
    id: "font-saudi-bold",
    fontName: "Saudi_Bold",
    displayName: "Saudi Bold",
    previewText: "السعودي",
    categories: ["ARABIC"],
    previewWeight: 700,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-saudi-medium",
    fontName: "Saudi_Medium",
    displayName: "Saudi Medium",
    previewText: "السعودي",
    categories: ["ARABIC", "INSTALLED"],
    previewWeight: 500,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-saudi-regular",
    fontName: "Saudi_Regular",
    displayName: "Saudi",
    previewText: "السعودي",
    categories: ["ARABIC", "INSTALLED"],
    previewWeight: 400,
    cssFontFamily: "'Noto Sans Arabic', 'Noto Kufi Arabic', Tahoma, sans-serif",
  },
  {
    id: "font-noto-kufi-arabic",
    fontName: "NotoKufiArabic",
    displayName: "Noto Kufi Arabic",
    previewText: "مرحبا",
    categories: ["ARABIC", "INSTALLED"],
    previewWeight: 500,
    cssFontFamily: "'Noto Kufi Arabic', 'Noto Sans Arabic', Tahoma, sans-serif",
  },
];

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
]);

function normalizeFontLookupKey(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .split(",")[0]
    .trim()
    .replace(/[_\s-]+/g, "")
    .toLowerCase();
}

function addLookupEntry(lookup, alias, font) {
  const key = normalizeFontLookupKey(alias);
  if (!key || GENERIC_FONT_FAMILIES.has(key) || lookup.has(key)) return;
  lookup.set(key, font);
}

const FONT_LOOKUP = new Map();
MOBILE_FONT_CATALOG.forEach((font) => {
  [
    font.fontName,
    font.displayName,
    String(font.fontName || "").replace(/_/g, " "),
  ].forEach((alias) => addLookupEntry(FONT_LOOKUP, alias, font));
});

export function resolveFontByName(fontName) {
  return FONT_LOOKUP.get(normalizeFontLookupKey(fontName)) || null;
}

export function resolveMobileFontName(fontName) {
  return resolveFontByName(fontName)?.fontName || "";
}

export function isSupportedMobileFont(fontName) {
  return Boolean(resolveFontByName(fontName));
}

export function isMobileFontName(fontName) {
  return Boolean(resolveFontByName(fontName));
}

export function resolveCssFontFamily(fontName) {
  return resolveFontByName(fontName)?.cssFontFamily || String(fontName || "").trim() || "'Noto Sans Arabic', sans-serif";
}
