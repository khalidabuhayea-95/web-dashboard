// Recovery for import layers whose external image src the server cannot fetch (protected Canva
// CDN → HTTP 403, blob:, expired signatures). Extracted from the extension-import route so it can
// be unit-tested directly.
//
// GUARANTEE: every object at a target index leaves this function WITHOUT an unfetchable src —
// refetch → snapshot/backdrop crop → transparent placeholder, in that order. The old in-route
// version could silently skip objects (type/src filters, crop throws), leaving unfetchable srcs
// behind; the route's retry loop then saw no progress and collapsed the WHOLE design to a single
// flattened snapshot. A guaranteed pass means the design always stays layered.

const TRANSPARENT_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// A snapshot crop is a flat rectangle cut from the design preview, so a transparent graphic (a
// circular icon, a decoration) arrives with the PAGE BACKGROUND baked into its corners instead of
// being a clean cutout. When all four corners are the same flat colour, flood-fill that colour in
// from the border to transparency — this strips ONLY the page background connected to the edges,
// leaving the graphic (and any same-coloured pixels INSIDE it) intact. Conservative: bails unless
// the corners are genuinely uniform and the removed area is a sane fraction, so photos / full-bleed
// layers (non-uniform corners) are never touched. Mutates the passed canvas in place when it helps.
export function cutOutFlatBackgroundToTransparent(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 6 || h < 6 || w * h > 1200 * 1200) return false;
  const ctx = canvas.getContext("2d");
  let img;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch (_e) {
    return false;
  }
  const d = img.data;
  const at = (x, y) => (y * w + x) * 4;
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ].map(([x, y]) => {
    const i = at(x, y);
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  });
  // require all corners opaque + mutually close (a real flat backdrop, not a photo edge)
  if (corners.some((c) => c[3] < 200)) return false;
  const avg = [0, 1, 2].map((c) => corners.reduce((s, col) => s + col[c], 0) / corners.length);
  const cornerSpread = Math.max(
    ...corners.flatMap((col) => [0, 1, 2].map((c) => Math.abs(col[c] - avg[c])))
  );
  if (cornerSpread > 22) return false;

  const TOL = 34;
  const isBg = (i) =>
    d[i + 3] > 0 &&
    Math.abs(d[i] - avg[0]) <= TOL &&
    Math.abs(d[i + 1] - avg[1]) <= TOL &&
    Math.abs(d[i + 2] - avg[2]) <= TOL;

  const visited = new Uint8Array(w * h);
  const stackX = [];
  const stackY = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    stackX.push(x);
    stackY.push(y);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  let removed = 0;
  while (stackX.length) {
    const x = stackX.pop();
    const y = stackY.pop();
    const p = y * w + x;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!isBg(i)) continue;
    d[i + 3] = 0;
    removed += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  const frac = removed / (w * h);
  // ineffective (<4%) or nuked the graphic (>88%, meaning the graphic itself was ~bg colour) → skip
  if (frac < 0.04 || frac > 0.88) return false;
  ctx.putImageData(img, 0, 0);
  return true;
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function parseFailedFabricObjectIndexesFromError(errorMessage) {
  const source = String(errorMessage || "");
  const matches = source.matchAll(/fabricData\.objects\[(\d+)\]\.src/g);
  const indexes = new Set();
  for (const match of matches) {
    const index = Number(match?.[1]);
    if (!Number.isFinite(index) || index < 0) continue;
    indexes.add(index);
  }
  return indexes;
}

export async function fetchExternalImageSourceAsDataUrl(sourceUrl, maxBytes = 10_000_000) {
  const normalizedUrl = String(sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) return "";
  try {
    const response = await fetch(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      cache: "force-cache",
    });
    if (!response.ok) return "";
    const contentType = String(response.headers.get("content-type") || "").trim().toLowerCase();
    if (contentType && !contentType.startsWith("image/")) return "";
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > maxBytes) return "";
    const mimeType = contentType || "image/png";
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return base64 ? `data:${mimeType};base64,${base64}` : "";
  } catch (_error) {
    return "";
  }
}

export async function replaceExternalImageSourcesWithSnapshotCrops({
  fabricData,
  snapshotDataUrl,
  canvasWidth,
  canvasHeight,
  targetIndexes,
}) {
  const sourceDataUrl = String(snapshotDataUrl || "").trim();
  if (!fabricData || typeof fabricData !== "object") {
    return { fabricData, replacedCount: 0, warnings: [] };
  }

  const objects = Array.isArray(fabricData.objects) ? fabricData.objects : [];
  if (objects.length === 0) {
    return { fabricData, replacedCount: 0, warnings: [] };
  }

  const targetCanvasWidth = Math.max(1, Math.round(numberOr(canvasWidth, 1)));
  const targetCanvasHeight = Math.max(1, Math.round(numberOr(canvasHeight, 1)));
  const warnings = [];

  // The canvas module and a decodable snapshot are OPTIONAL: without them we still guarantee
  // progress via refetch + placeholder (never bail with replacedCount 0 while targets remain).
  let createCanvasFn = null;
  let loadImageFn = null;
  try {
    const canvasLib = await import("canvas");
    createCanvasFn = canvasLib.createCanvas;
    loadImageFn = canvasLib.loadImage;
  } catch (error) {
    warnings.push(
      `Layer snapshot crops unavailable (canvas module): ${error?.message || "unknown error"}`
    );
  }

  let snapshotImage = null;
  if (loadImageFn && sourceDataUrl.startsWith("data:image/")) {
    try {
      snapshotImage = await loadImageFn(sourceDataUrl);
    } catch (error) {
      warnings.push(
        `Layer snapshot crops unavailable (decode failed): ${error?.message || "unknown error"}`
      );
    }
  }

  const snapshotWidth = Math.max(1, Math.round(numberOr(snapshotImage?.width, 1)));
  const snapshotHeight = Math.max(1, Math.round(numberOr(snapshotImage?.height, 1)));
  const nextObjects = objects.map((item) => ({ ...(item && typeof item === "object" ? item : {}) }));
  const pageArea = Math.max(1, targetCanvasWidth * targetCanvasHeight);
  const backdropCanvasCache = new Map();
  const droppedIndexSet = new Set();
  let snapshotCropReplacedCount = 0;
  let backdropCropReplacedCount = 0;
  let backgroundCutoutCount = 0;
  let refetchedCount = 0;
  let placeholderCount = 0;
  let droppedProtectedLayerCount = 0;
  let replacedCount = 0;

  function getRenderedBounds(object) {
    const scaleX = Math.max(0.0001, Math.abs(numberOr(object?.scaleX, 1)));
    const scaleY = Math.max(0.0001, Math.abs(numberOr(object?.scaleY, 1)));
    const width = Math.max(1, numberOr(object?.width, 1) * scaleX);
    const height = Math.max(1, numberOr(object?.height, 1) * scaleY);
    const originX = String(object?.originX || "left").toLowerCase();
    const originY = String(object?.originY || "top").toLowerCase();
    let left = numberOr(object?.left, 0);
    let top = numberOr(object?.top, 0);
    if (originX === "center") left -= width / 2;
    if (originX === "right") left -= width;
    if (originY === "center") top -= height / 2;
    if (originY === "bottom") top -= height;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  function normalizeBoundsToCanvas(bounds) {
    const normalizedLeft = Math.max(0, Math.min(targetCanvasWidth - 1, numberOr(bounds?.left, 0)));
    const normalizedTop = Math.max(0, Math.min(targetCanvasHeight - 1, numberOr(bounds?.top, 0)));
    const normalizedRight = Math.max(
      normalizedLeft + 1,
      Math.min(targetCanvasWidth, numberOr(bounds?.right, 0))
    );
    const normalizedBottom = Math.max(
      normalizedTop + 1,
      Math.min(targetCanvasHeight, numberOr(bounds?.bottom, 0))
    );
    return {
      left: normalizedLeft,
      top: normalizedTop,
      right: normalizedRight,
      bottom: normalizedBottom,
      width: Math.max(1, normalizedRight - normalizedLeft),
      height: Math.max(1, normalizedBottom - normalizedTop),
    };
  }

  function shouldPreferBackdropCrop(bounds) {
    const widthRatio = bounds.width / targetCanvasWidth;
    const heightRatio = bounds.height / targetCanvasHeight;
    const coverage = (bounds.width * bounds.height) / pageArea;
    const anchoredToLeftEdge = bounds.left <= targetCanvasWidth * 0.08;
    const anchoredToRightEdge = bounds.right >= targetCanvasWidth * 0.92;
    const anchoredToTopEdge = bounds.top <= targetCanvasHeight * 0.08;
    const anchoredToBottomEdge = bounds.bottom >= targetCanvasHeight * 0.92;
    return (
      coverage >= 0.45 &&
      widthRatio <= 0.9 &&
      heightRatio >= 0.82 &&
      (anchoredToLeftEdge || anchoredToRightEdge) &&
      (anchoredToTopEdge || anchoredToBottomEdge)
    );
  }

  function resolveCropRect(bounds, sourceWidth, sourceHeight) {
    const sx = Math.max(
      0,
      Math.min(sourceWidth - 1, Math.round((bounds.left / targetCanvasWidth) * sourceWidth))
    );
    const sy = Math.max(
      0,
      Math.min(sourceHeight - 1, Math.round((bounds.top / targetCanvasHeight) * sourceHeight))
    );
    const sw = Math.max(
      1,
      Math.min(sourceWidth - sx, Math.round((bounds.width / targetCanvasWidth) * sourceWidth))
    );
    const sh = Math.max(
      1,
      Math.min(sourceHeight - sy, Math.round((bounds.height / targetCanvasHeight) * sourceHeight))
    );
    return { sx, sy, sw, sh };
  }

  function findNearestFullPageBackdropLayer(targetIndex) {
    for (let scanIndex = targetIndex - 1; scanIndex >= 0; scanIndex -= 1) {
      const candidate = nextObjects[scanIndex];
      const candidateType = String(candidate?.type || "").toLowerCase();
      const candidateSrc = String(candidate?.src || "").trim();
      if (candidateType !== "image") continue;
      if (!candidateSrc.startsWith("data:image/") && !/^https?:\/\//i.test(candidateSrc)) continue;

      const candidateBounds = normalizeBoundsToCanvas(getRenderedBounds(candidate));
      const coverage = (candidateBounds.width * candidateBounds.height) / pageArea;
      const nearOrigin =
        candidateBounds.left <= targetCanvasWidth * 0.06 &&
        candidateBounds.top <= targetCanvasHeight * 0.06;
      const fullPageLike =
        coverage >= 0.88 &&
        candidateBounds.width >= targetCanvasWidth * 0.9 &&
        candidateBounds.height >= targetCanvasHeight * 0.9 &&
        nearOrigin;
      if (!fullPageLike) continue;

      return {
        cacheKey: `${scanIndex}:${candidateSrc}`,
        src: candidateSrc,
        bounds: candidateBounds,
      };
    }
    return null;
  }

  async function getBackdropCanvas(candidate) {
    if (!candidate || !createCanvasFn || !loadImageFn) return null;
    if (backdropCanvasCache.has(candidate.cacheKey)) {
      return backdropCanvasCache.get(candidate.cacheKey);
    }
    const backdropPromise = (async () => {
      const image = await loadImageFn(candidate.src);
      const backdropCanvas = createCanvasFn(targetCanvasWidth, targetCanvasHeight);
      const backdropContext = backdropCanvas.getContext("2d");
      backdropContext.clearRect(0, 0, targetCanvasWidth, targetCanvasHeight);
      backdropContext.drawImage(
        image,
        candidate.bounds.left,
        candidate.bounds.top,
        candidate.bounds.width,
        candidate.bounds.height
      );
      return backdropCanvas;
    })();
    backdropCanvasCache.set(candidate.cacheKey, backdropPromise);
    return backdropPromise;
  }

  function shouldDropSnapshotFallbackLayer(bounds, hasBackdropLayer) {
    if (!hasBackdropLayer) return false;
    const coverage = (bounds.width * bounds.height) / pageArea;
    if (coverage < 0.14 || coverage > 0.78) return false;
    const widthRatio = bounds.width / targetCanvasWidth;
    const heightRatio = bounds.height / targetCanvasHeight;
    if (widthRatio < 0.28 || heightRatio < 0.22) return false;
    const nearLeftEdge = bounds.left <= targetCanvasWidth * 0.07;
    const nearRightEdge = bounds.right >= targetCanvasWidth * 0.93;
    const nearTopEdge = bounds.top <= targetCanvasHeight * 0.07;
    const nearBottomEdge = bounds.bottom >= targetCanvasHeight * 0.93;
    const edgeAnchored = nearLeftEdge || nearRightEdge || nearTopEdge || nearBottomEdge;
    return !edgeAnchored;
  }

  const isUnfetchableSrc = (value) => {
    const src = String(value || "").trim();
    if (!src) return false;
    if (src.startsWith("data:")) return false;
    // http(s) may or may not be fetchable — the refetch step decides; blob:/filesystem: never are.
    return true;
  };

  for (let index = 0; index < nextObjects.length; index += 1) {
    if (targetIndexes instanceof Set && targetIndexes.size > 0 && !targetIndexes.has(index)) {
      continue;
    }
    const object = nextObjects[index];
    const src = String(object?.src || "").trim();
    // ANY object type with an unfetchable src is handled — the old type==="image" filter let
    // non-image objects with src slip through and re-fail sanitization forever.
    if (!isUnfetchableSrc(src)) continue;

    // 1) refetch (server-side) — counts as progress so the route's retry loop advances
    if (/^https?:\/\//i.test(src)) {
      const fetchedImageDataUrl = await fetchExternalImageSourceAsDataUrl(src);
      if (fetchedImageDataUrl.startsWith("data:image/")) {
        object.src = fetchedImageDataUrl;
        object.crossOrigin = undefined;
        refetchedCount += 1;
        replacedCount += 1;
        continue;
      }
    }

    const bounds = normalizeBoundsToCanvas(getRenderedBounds(object));
    const backdropCandidate = findNearestFullPageBackdropLayer(index);
    if (shouldDropSnapshotFallbackLayer(bounds, Boolean(backdropCandidate))) {
      droppedIndexSet.add(index);
      droppedProtectedLayerCount += 1;
      continue;
    }

    // 2) snapshot / backdrop crop
    let cropped = "";
    if (createCanvasFn && snapshotImage) {
      let cropSource = snapshotImage;
      let cropSourceWidth = snapshotWidth;
      let cropSourceHeight = snapshotHeight;
      let usedBackdropFallback = false;

      if (shouldPreferBackdropCrop(bounds) && backdropCandidate) {
        try {
          const backdropCanvas = await getBackdropCanvas(backdropCandidate);
          if (backdropCanvas) {
            cropSource = backdropCanvas;
            cropSourceWidth = targetCanvasWidth;
            cropSourceHeight = targetCanvasHeight;
            usedBackdropFallback = true;
          }
        } catch (_error) {
          // Fall back to the plain snapshot crop.
        }
      }

      try {
        const { sx, sy, sw, sh } = resolveCropRect(bounds, cropSourceWidth, cropSourceHeight);
        const cropCanvas = createCanvasFn(sw, sh);
        const cropContext = cropCanvas.getContext("2d");
        cropContext.drawImage(cropSource, sx, sy, sw, sh, 0, 0, sw, sh);
        // Strip the flat page background out of icon/decoration crops so they read as clean
        // cutouts instead of rectangles with baked-in backdrop.
        if (cutOutFlatBackgroundToTransparent(cropCanvas)) backgroundCutoutCount += 1;
        const croppedDataUrl = cropCanvas.toDataURL("image/png");
        if (String(croppedDataUrl).startsWith("data:image/")) {
          cropped = croppedDataUrl;
          if (usedBackdropFallback) backdropCropReplacedCount += 1;
          else snapshotCropReplacedCount += 1;
        }
      } catch (_error) {
        // Placeholder below guarantees progress.
      }
    }

    // 3) last-resort transparent placeholder — the layer keeps its slot/geometry but renders
    // empty rather than sinking the ENTIRE design to a flattened snapshot.
    if (!cropped) {
      cropped = TRANSPARENT_PIXEL_PNG;
      placeholderCount += 1;
    }

    object.src = cropped;
    object.crossOrigin = undefined;
    object.fallback = true;
    object.fallbackReason = String(object?.fallbackReason || "protected-src-recovered");
    replacedCount += 1;
  }

  const finalObjects =
    droppedIndexSet.size > 0
      ? nextObjects.filter((_object, index) => !droppedIndexSet.has(index))
      : nextObjects;

  if (replacedCount <= 0 && droppedIndexSet.size <= 0) {
    return { fabricData, replacedCount: 0, warnings };
  }

  if (refetchedCount > 0) {
    warnings.push(`${refetchedCount} image layer(s) re-fetched server-side.`);
  }
  if (snapshotCropReplacedCount > 0) {
    warnings.push(
      `${snapshotCropReplacedCount} protected image layer${snapshotCropReplacedCount === 1 ? "" : "s"} replaced using snapshot crops` +
        (backgroundCutoutCount > 0 ? ` (${backgroundCutoutCount} background-cut to transparent)` : "") +
        "."
    );
  }
  if (backdropCropReplacedCount > 0) {
    warnings.push(
      `${backdropCropReplacedCount} protected image layer${backdropCropReplacedCount === 1 ? "" : "s"} replaced using backdrop crops.`
    );
  }
  if (placeholderCount > 0) {
    warnings.push(
      `${placeholderCount} protected image layer${placeholderCount === 1 ? "" : "s"} could not be recovered and imported as empty placeholders.`
    );
  }
  if (droppedProtectedLayerCount > 0) {
    warnings.push(
      `${droppedProtectedLayerCount} protected image layer${droppedProtectedLayerCount === 1 ? "" : "s"} removed to avoid snapshot artifact duplication.`
    );
  }

  return {
    fabricData: { ...fabricData, objects: finalObjects },
    replacedCount: replacedCount + droppedProtectedLayerCount,
    warnings,
  };
}
