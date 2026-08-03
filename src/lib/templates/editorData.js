function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}

function mapEditorElementToFabricObject(element) {
  const item = element && typeof element === "object" ? element : {};
  const fallbackX = Number.isFinite(Number(item.x)) ? Number(item.x) : 0;
  const fallbackY = Number.isFinite(Number(item.y)) ? Number(item.y) : 0;
  const normalizedLeft = Number.isFinite(Number(item.left)) ? Number(item.left) : fallbackX;
  const normalizedTop = Number.isFinite(Number(item.top)) ? Number(item.top) : fallbackY;
  const normalizedType = String(item.layerType || item.importKind || item.type || "")
    .trim()
    .toLowerCase();

  return {
    ...item,
    left: normalizedLeft,
    top: normalizedTop,
    originX: item.originX || "left",
    originY: item.originY || "top",
    layerType: item.layerType || normalizedType,
    layerLocked:
      typeof item.layerLocked === "boolean"
        ? item.layerLocked
        : parseBoolean(item.locked, false),
    layerHidden:
      typeof item.layerHidden === "boolean"
        ? item.layerHidden
        : !parseBoolean(item.visible, true),
  };
}

function normalizePageElements(source) {
  if (!source || typeof source !== "object") return null;
  const pages = Array.isArray(source.pages) ? source.pages : null;
  if (!pages || pages.length === 0) return null;

  const activePageId = String(source.activePageId || source.pageId || "").trim();
  const activePage =
    pages.find((page) => String(page?.id || "").trim() === activePageId) || pages[0];
  if (!activePage || !Array.isArray(activePage.elements)) return null;

  return {
    ...source,
    background: activePage.background || source.background,
    objects: activePage.elements.map((element) => mapEditorElementToFabricObject(element)),
  };
}

export function extractFabricData(payload) {
  if (!payload || typeof payload !== "object") return null;

  if (Array.isArray(payload.objects)) {
    return payload;
  }

  if (payload.fabric && typeof payload.fabric === "object" && Array.isArray(payload.fabric.objects)) {
    return payload.fabric;
  }

  if (payload.data && typeof payload.data === "object") {
    if (Array.isArray(payload.data.objects)) {
      return payload.data;
    }

    if (
      payload.data.fabric &&
      typeof payload.data.fabric === "object" &&
      Array.isArray(payload.data.fabric.objects)
    ) {
      return payload.data.fabric;
    }
  }

  const pageDataFromPayload = normalizePageElements(payload);
  if (pageDataFromPayload) return pageDataFromPayload;

  const pageDataFromNestedData = normalizePageElements(payload.data);
  if (pageDataFromNestedData) return pageDataFromNestedData;

  return null;
}

function positiveOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.round(next) : null;
}

function readImportPagesMeta(fabricLike) {
  const meta = fabricLike?.meta;
  const importMeta = meta && typeof meta === "object" ? meta.import : null;
  const pages = importMeta && typeof importMeta === "object" ? importMeta.pages : null;
  return Array.isArray(pages) && pages.length > 0 ? pages : null;
}

function pagesFromNativeDesign(source) {
  if (!source || typeof source !== "object") return null;
  const pages = Array.isArray(source.pages) ? source.pages : null;
  if (!pages || pages.length === 0) return null;

  const mapped = pages
    .filter((page) => page && typeof page === "object")
    .map((page, index) => ({
      id: String(page.id || `page-${index + 1}`),
      name: String(page.name || `Page ${index + 1}`),
      width: positiveOrNull(page.width),
      height: positiveOrNull(page.height),
      durationMs: positiveOrNull(page.durationMs),
      background: page.background || source.background || null,
      objects: Array.isArray(page.elements)
        ? page.elements.map((element) => mapEditorElementToFabricObject(element))
        : [],
    }));

  return mapped.length > 0 ? mapped : null;
}

function pagesFromFlatFabric(fabricLike) {
  if (!fabricLike || !Array.isArray(fabricLike.objects)) return null;

  const importPages = readImportPagesMeta(fabricLike);
  if (importPages && importPages.length > 1) {
    // Flat import payload (e.g. Canva extension): every object carries an
    // importPageIndex; the page list itself rides in meta.import.pages.
    const buckets = importPages.map(() => []);
    fabricLike.objects.forEach((object) => {
      const rawIndex = Number(object?.importPageIndex);
      const bucketIndex =
        Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < buckets.length ? rawIndex : 0;
      buckets[bucketIndex].push(object);
    });
    return importPages.map((page, index) => ({
      id: String(page?.id || `page-${index + 1}`),
      name: String(page?.name || `Page ${index + 1}`),
      width: positiveOrNull(page?.width),
      height: positiveOrNull(page?.height),
      durationMs: positiveOrNull(page?.durationMs),
      background: page?.background || (index === 0 ? fabricLike.background || null : null),
      objects: buckets[index],
    }));
  }

  return [
    {
      id: "page-1",
      name: "Page 1",
      width: null,
      height: null,
      durationMs: null,
      background: fabricLike.background || null,
      objects: fabricLike.objects,
    },
  ];
}

/**
 * Enumerates every page of a stored template payload as `{id, name, width, height,
 * durationMs, background, objects}` entries, in page order. Handles the native
 * editor design format (`{pages: [...]}`), flat fabric payloads (single page), and
 * flat import payloads tagged with `importPageIndex` + `meta.import.pages`.
 *
 * Unlike `extractFabricData` (which keeps the legacy behavior of flattening to the
 * active page), page 0 here is always the FIRST page — the design's cover.
 */
export function extractEditorPagesData(payload) {
  if (!payload || typeof payload !== "object") return null;

  const nativeFromPayload = pagesFromNativeDesign(payload);
  if (nativeFromPayload) return nativeFromPayload;

  if (payload.data && typeof payload.data === "object") {
    const nativeFromNested = pagesFromNativeDesign(payload.data);
    if (nativeFromNested) return nativeFromNested;
  }

  if (Array.isArray(payload.objects)) {
    return pagesFromFlatFabric(payload);
  }
  if (payload.fabric && typeof payload.fabric === "object" && Array.isArray(payload.fabric.objects)) {
    return pagesFromFlatFabric(payload.fabric);
  }
  if (payload.data && typeof payload.data === "object") {
    if (Array.isArray(payload.data.objects)) {
      return pagesFromFlatFabric(payload.data);
    }
    if (
      payload.data.fabric &&
      typeof payload.data.fabric === "object" &&
      Array.isArray(payload.data.fabric.objects)
    ) {
      return pagesFromFlatFabric(payload.data.fabric);
    }
  }

  return null;
}
