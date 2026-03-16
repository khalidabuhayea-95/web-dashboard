export function extractFabricData(payload) {
  if (!payload || typeof payload !== "object") return null;

  const parseBoolean = (value, fallback = false) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
    }
    return fallback;
  };

  const normalizePageElements = (source) => {
    if (!source || typeof source !== "object") return null;
    const pages = Array.isArray(source.pages) ? source.pages : null;
    if (!pages || pages.length === 0) return null;

    const activePageId = String(source.activePageId || source.pageId || "").trim();
    const activePage =
      pages.find((page) => String(page?.id || "").trim() === activePageId) || pages[0];
    if (!activePage || !Array.isArray(activePage.elements)) return null;

    const objects = activePage.elements.map((element) => {
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
    });

    return {
      ...source,
      background: activePage.background || source.background,
      objects,
    };
  };

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
