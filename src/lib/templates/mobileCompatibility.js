function normalizeFontCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .split(",")[0]
    .trim();
}

function getEditorProPages(templateData) {
  if (!templateData || typeof templateData !== "object") return [];
  return Array.isArray(templateData.pages) ? templateData.pages : [];
}

function getPageElements(page) {
  return Array.isArray(page?.elements) ? page.elements : [];
}

export function resolveEditorTextFontName(element, fallback = "NotoKufiArabic") {
  const candidates = [
    normalizeFontCandidate(element?.fontName),
    normalizeFontCandidate(element?.fontFamily),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return normalizeFontCandidate(fallback) || "NotoKufiArabic";
}

export function normalizeEditorProMobileFontData(templateData, fallback = "NotoKufiArabic") {
  if (!templateData || typeof templateData !== "object" || !Array.isArray(templateData.pages)) {
    return templateData;
  }

  let didChange = false;
  const normalizedPages = templateData.pages.map((page) => {
    if (!page || typeof page !== "object" || !Array.isArray(page.elements)) {
      return page;
    }

    let pageChanged = false;
    const normalizedElements = page.elements.map((element) => {
      if (String(element?.type || "").toLowerCase() !== "text") {
        return element;
      }

      const resolvedFontName = resolveEditorTextFontName(element, fallback);
      const currentFontFamily = normalizeFontCandidate(element?.fontFamily);
      const currentFontName = normalizeFontCandidate(element?.fontName);
      const needsFontFamilyUpdate = resolvedFontName && resolvedFontName !== currentFontFamily;
      const needsFontNameUpdate =
        typeof element?.fontName !== "undefined" && resolvedFontName !== currentFontName;

      if (!needsFontFamilyUpdate && !needsFontNameUpdate) {
        return element;
      }

      pageChanged = true;
      return {
        ...element,
        fontFamily: resolvedFontName,
        ...(typeof element?.fontName !== "undefined" ? { fontName: resolvedFontName } : {}),
      };
    });

    if (!pageChanged) {
      return page;
    }

    didChange = true;
    return {
      ...page,
      elements: normalizedElements,
    };
  });

  if (!didChange) {
    return templateData;
  }

  return {
    ...templateData,
    pages: normalizedPages,
  };
}

export function validateEditorProMobilePublishCompatibility(templateData) {
  const errors = [];
  const pages = getEditorProPages(templateData);

  // Multi-page designs publish since the pages[] wire format; the API serves
  // page 1 as top-level background/layers for app builds that predate it.
  if (pages.length === 0) {
    errors.push("Only Editor Pro templates can be published to mobile.");
  }

  return {
    valid: errors.length === 0,
    errors,
    unsupportedFonts: [],
  };
}
