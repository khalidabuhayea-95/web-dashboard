export const IMPORT_PARITY_VERSION = 2;
export const IMPORT_ASSET_MANIFEST_VERSION = 1;

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asString(value) {
  return String(value || "").trim();
}

function toBounds(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    x: numberOr(source.x, 0),
    y: numberOr(source.y, 0),
    width: Math.max(1, numberOr(source.width, 1)),
    height: Math.max(1, numberOr(source.height, 1)),
  };
}

function toTransform(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    rotation: numberOr(source.rotation, 0),
    scaleX: Math.max(0.0001, numberOr(source.scaleX, 1)),
    scaleY: Math.max(0.0001, numberOr(source.scaleY, 1)),
    opacity: Math.max(0, Math.min(1, numberOr(source.opacity, 1))),
  };
}

function toLayerNode(value, index = 0) {
  const source = value && typeof value === "object" ? value : {};
  const id = asString(source.id) || `layer-${index + 1}`;
  const parentId = asString(source.parentId) || null;
  const kind = asString(source.kind || source.importKind || source.layerType).toLowerCase() || "unknown";
  return {
    id,
    parentId,
    zIndex: numberOr(source.zIndex, index),
    name: asString(source.name) || `Layer ${index + 1}`,
    kind,
    bounds: toBounds(source.bounds || source.pageRelativeRect || source.rect),
    transform: toTransform(source.transform),
    fallback: Boolean(source.fallback),
    fallbackReason: asString(source.fallbackReason),
  };
}

function normalizeLayerTree(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((node, index) => toLayerNode(node, index))
    .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index);
}

function normalizeLayerStats(value, layerCount = 0) {
  const source = value && typeof value === "object" ? value : {};
  const detected = Math.max(0, numberOr(source.detected, layerCount));
  const editable = Math.max(0, numberOr(source.editable, 0));
  const rasterized = Math.max(0, numberOr(source.rasterized, Math.max(0, layerCount - editable)));
  const skipped = Math.max(0, numberOr(source.skipped, Math.max(0, detected - editable - rasterized)));

  return {
    detected,
    editable,
    rasterized,
    skipped,
  };
}

function normalizeUsedFonts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  value.forEach((item) => {
    const input = asString(item);
    if (!input) return;
    const primary = asString(input.split(",")[0]).replace(/^['"]+|['"]+$/g, "").trim();
    if (!primary) return;
    const key = primary.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(primary);
  });
  return result;
}

function normalizeAssetManifestEntry(value, index = 0) {
  const source = value && typeof value === "object" ? value : {};
  const status = asString(source.status).toLowerCase();
  const normalizedStatus =
    status === "uploaded" || status === "preserved" || status === "failed"
      ? status
      : "uploaded";
  const sourceType = asString(source.sourceType).toLowerCase();
  const normalizedSourceType = sourceType === "data-uri" || sourceType === "url" ? sourceType : "url";
  return {
    id: asString(source.id) || `asset-${index + 1}`,
    path: asString(source.path),
    field: asString(source.field),
    kind: asString(source.kind).toLowerCase() || "image",
    sourceType: normalizedSourceType,
    original: asString(source.original),
    rewritten: asString(source.rewritten),
    status: normalizedStatus,
    mimeType: asString(source.mimeType).toLowerCase(),
    bytes: Math.max(0, numberOr(source.bytes, 0)),
  };
}

function normalizeAssetManifest(value) {
  if (!value || typeof value !== "object") return null;

  const assets = (Array.isArray(value.assets) ? value.assets : [])
    .map((entry, index) => normalizeAssetManifestEntry(entry, index))
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) => candidate.id === entry.id) === index
    );

  const summarySource = value.summary && typeof value.summary === "object" ? value.summary : {};
  const summary = {
    total: Math.max(0, numberOr(summarySource.total, assets.length)),
    uploaded: Math.max(
      0,
      numberOr(
        summarySource.uploaded,
        assets.filter((asset) => asset.status === "uploaded").length
      )
    ),
    preserved: Math.max(
      0,
      numberOr(
        summarySource.preserved,
        assets.filter((asset) => asset.status === "preserved").length
      )
    ),
    failed: Math.max(
      0,
      numberOr(
        summarySource.failed,
        assets.filter((asset) => asset.status === "failed").length
      )
    ),
  };

  return {
    version: Math.max(1, numberOr(value.version, IMPORT_ASSET_MANIFEST_VERSION)),
    uploadedAt: asString(value.uploadedAt),
    summary,
    assets,
  };
}

function normalizePage(value, fallbackWidth = 1080, fallbackHeight = 1080) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: asString(source.id) || "page-1",
    name: asString(source.name) || "Page 1",
    width: Math.max(1, numberOr(source.width, fallbackWidth)),
    height: Math.max(1, numberOr(source.height, fallbackHeight)),
    sourceWidth: Math.max(1, numberOr(source.sourceWidth, source.width || fallbackWidth)),
    sourceHeight: Math.max(1, numberOr(source.sourceHeight, source.height || fallbackHeight)),
  };
}

export function buildImportMetadata({
  source = "unknown",
  importVersion = IMPORT_PARITY_VERSION,
  page,
  layerTree,
  layerStats,
  usedFonts,
  warnings,
  assetManifest,
}, fallback = {}) {
  const safeSource = asString(source || fallback.source) || "unknown";
  const safeVersion = Math.max(1, numberOr(importVersion || fallback.importVersion, IMPORT_PARITY_VERSION));
  const safeLayerTree = normalizeLayerTree(layerTree || fallback.layerTree);
  const safePage = normalizePage(
    page || fallback.page,
    numberOr(fallback?.page?.width, 1080),
    numberOr(fallback?.page?.height, 1080)
  );
  const safeLayerStats = normalizeLayerStats(
    layerStats || fallback.layerStats,
    safeLayerTree.length
  );
  const safeUsedFonts = normalizeUsedFonts(
    Array.isArray(usedFonts) ? usedFonts : Array.isArray(fallback.usedFonts) ? fallback.usedFonts : []
  );
  const safeWarnings = Array.from(
    new Set(
      (Array.isArray(warnings) ? warnings : Array.isArray(fallback.warnings) ? fallback.warnings : [])
        .map((item) => asString(item))
        .filter(Boolean)
    )
  );
  const safeAssetManifest = normalizeAssetManifest(
    assetManifest || fallback.assetManifest
  );

  return {
    importVersion: safeVersion,
    source: safeSource,
    page: safePage,
    layerTree: safeLayerTree,
    layerStats: safeLayerStats,
    usedFonts: safeUsedFonts,
    warnings: safeWarnings,
    assetManifest: safeAssetManifest,
  };
}

export function readImportMetadataFromEditorData(editorData) {
  if (!editorData || typeof editorData !== "object") return null;
  const source =
    (editorData.meta && typeof editorData.meta === "object" ? editorData.meta.import : null) ||
    (editorData.import && typeof editorData.import === "object" ? editorData.import : null) ||
    (editorData.importMetadata && typeof editorData.importMetadata === "object" ? editorData.importMetadata : null) ||
    (typeof editorData.importVersion !== "undefined" ? editorData : null);

  if (!source || typeof source !== "object") return null;

  return buildImportMetadata(
    {
      source: source.source,
      importVersion: source.importVersion,
      page: source.page,
      layerTree: source.layerTree,
      layerStats: source.layerStats,
      usedFonts: source.usedFonts,
      warnings: source.warnings,
      assetManifest: source.assetManifest,
    },
    {
      page: {
        width: numberOr(editorData?.page?.width, 1080),
        height: numberOr(editorData?.page?.height, 1080),
      },
    }
  );
}

export function attachImportMetadataToFabricData(fabricData, importMetadata) {
  if (!fabricData || typeof fabricData !== "object") return fabricData;
  if (!importMetadata || typeof importMetadata !== "object") return fabricData;

  const normalized = buildImportMetadata(importMetadata, {
    page: {
      width: numberOr(importMetadata?.page?.width, 1080),
      height: numberOr(importMetadata?.page?.height, 1080),
    },
  });

  const nextMeta = {
    ...(fabricData.meta && typeof fabricData.meta === "object" ? fabricData.meta : {}),
    import: normalized,
  };

  return {
    ...fabricData,
    meta: nextMeta,
  };
}

export function readImportMetadataFromTemplateData(templateData) {
  if (!templateData || typeof templateData !== "object") return null;

  const direct =
    (templateData.meta && typeof templateData.meta === "object" ? templateData.meta.import : null) ||
    (templateData.import && typeof templateData.import === "object" ? templateData.import : null);

  if (!direct) return null;

  return buildImportMetadata(
    {
      source: direct.source,
      importVersion: direct.importVersion,
      page: direct.page,
      layerTree: direct.layerTree,
      layerStats: direct.layerStats,
      usedFonts: direct.usedFonts,
      warnings: direct.warnings,
      assetManifest: direct.assetManifest,
    },
    {
      page: {
        width: numberOr(templateData?.width, 1080),
        height: numberOr(templateData?.height, 1080),
      },
    }
  );
}

export function deriveLayerStatsFromFabricObjects(objects) {
  const safeObjects = Array.isArray(objects) ? objects : [];
  let editable = 0;
  let rasterized = 0;

  safeObjects.forEach((object) => {
    const isRasterized = Boolean(object?.fallback) || asString(object?.fallbackReason).length > 0;
    if (isRasterized) {
      rasterized += 1;
      return;
    }
    editable += 1;
  });

  return {
    detected: safeObjects.length,
    editable,
    rasterized,
    skipped: 0,
  };
}

export function buildLayerTreeFromFabricObjects(objects) {
  const safeObjects = Array.isArray(objects) ? objects : [];
  return safeObjects.map((object, index) => {
    const id = asString(object?.importNodeId || object?.id || object?.layerId) || `layer-${index + 1}`;
    const parentId = asString(object?.importParentId) || null;
    const scaleX = Math.max(0.0001, numberOr(object?.scaleX, 1));
    const scaleY = Math.max(0.0001, numberOr(object?.scaleY, 1));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = asString(object?.originX).toLowerCase() || "left";
    const originY = asString(object?.originY).toLowerCase() || "top";
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return {
      id,
      parentId,
      zIndex: numberOr(object?.zIndex, index),
      name: asString(object?.layerName || object?.name) || `Layer ${index + 1}`,
      kind: asString(object?.importKind || object?.layerType || object?.type).toLowerCase() || "unknown",
      bounds: {
        x: left,
        y: top,
        width,
        height,
      },
      transform: {
        rotation: numberOr(object?.angle, 0),
        scaleX,
        scaleY,
        opacity: Math.max(0, Math.min(1, numberOr(object?.opacity, 1))),
      },
      fallback: Boolean(object?.fallback),
      fallbackReason: asString(object?.fallbackReason),
    };
  });
}
