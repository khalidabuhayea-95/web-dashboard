const DEFAULT_WHITE_THRESHOLD = 242;
const DEFAULT_CHROMA_TOLERANCE = 24;
const DEFAULT_SOFTNESS = 16;
const DEFAULT_MIN_WHITE_RATIO = 0.08;
const MAX_PROCESSABLE_PIXELS = 6_500_000;

let gifModulesPromise = null;

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

async function loadGifModules() {
  if (gifModulesPromise) return gifModulesPromise;

  gifModulesPromise = Promise.all([import("gifuct-js"), import("gifenc")])
    .then(([gifuctModule, gifencModule]) => {
      const parseGIF =
        gifuctModule?.parseGIF ||
        gifuctModule?.default?.parseGIF;
      const decompressFrames =
        gifuctModule?.decompressFrames ||
        gifuctModule?.default?.decompressFrames;
      const GIFEncoder =
        gifencModule?.GIFEncoder ||
        gifencModule?.default?.GIFEncoder;
      const quantize =
        gifencModule?.quantize ||
        gifencModule?.default?.quantize;
      const applyPalette =
        gifencModule?.applyPalette ||
        gifencModule?.default?.applyPalette;

      if (
        typeof parseGIF !== "function" ||
        typeof decompressFrames !== "function" ||
        typeof GIFEncoder !== "function" ||
        typeof quantize !== "function" ||
        typeof applyPalette !== "function"
      ) {
        throw new Error("GIF processing modules are unavailable.");
      }

      return {
        parseGIF,
        decompressFrames,
        GIFEncoder,
        quantize,
        applyPalette,
      };
    })
    .catch((error) => {
      gifModulesPromise = null;
      throw error;
    });

  return gifModulesPromise;
}

function clearRectRgba(target, canvasWidth, canvasHeight, dims) {
  if (!dims) return;
  const left = Math.max(0, Math.min(canvasWidth, Math.round(Number(dims.left) || 0)));
  const top = Math.max(0, Math.min(canvasHeight, Math.round(Number(dims.top) || 0)));
  const width = Math.max(0, Math.min(canvasWidth - left, Math.round(Number(dims.width) || 0)));
  const height = Math.max(0, Math.min(canvasHeight - top, Math.round(Number(dims.height) || 0)));
  if (width === 0 || height === 0) return;

  for (let y = 0; y < height; y += 1) {
    const rowStart = ((top + y) * canvasWidth + left) * 4;
    target.fill(0, rowStart, rowStart + width * 4);
  }
}

function drawFramePatchOntoRgba(target, canvasWidth, canvasHeight, frame) {
  const dims = frame?.dims || null;
  const patch = frame?.patch;
  if (!dims || !(patch instanceof Uint8ClampedArray || patch instanceof Uint8Array)) return;

  const left = Math.max(0, Math.round(Number(dims.left) || 0));
  const top = Math.max(0, Math.round(Number(dims.top) || 0));
  const width = Math.max(0, Math.round(Number(dims.width) || 0));
  const height = Math.max(0, Math.round(Number(dims.height) || 0));
  if (width === 0 || height === 0) return;

  for (let y = 0; y < height; y += 1) {
    const destY = top + y;
    if (destY < 0 || destY >= canvasHeight) continue;

    for (let x = 0; x < width; x += 1) {
      const destX = left + x;
      if (destX < 0 || destX >= canvasWidth) continue;

      const srcIndex = (y * width + x) * 4;
      const alpha = patch[srcIndex + 3];
      if (alpha === 0) continue;

      const destIndex = (destY * canvasWidth + destX) * 4;
      target[destIndex] = patch[srcIndex];
      target[destIndex + 1] = patch[srcIndex + 1];
      target[destIndex + 2] = patch[srcIndex + 2];
      target[destIndex + 3] = alpha;
    }
  }
}

function estimateWhiteRatio(rgba, options) {
  const threshold = clampNumber(options?.threshold, DEFAULT_WHITE_THRESHOLD, 180, 255);
  const chromaTolerance = clampNumber(options?.chromaTolerance, DEFAULT_CHROMA_TOLERANCE, 0, 80);

  let opaqueCount = 0;
  let whiteLikeCount = 0;

  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3];
    if (alpha === 0) continue;

    opaqueCount += 1;
    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);

    if (minChannel >= threshold && maxChannel - minChannel <= chromaTolerance) {
      whiteLikeCount += 1;
    }
  }

  if (opaqueCount === 0) return 0;
  return whiteLikeCount / opaqueCount;
}

function applyWhiteChromaKey(rgba, options) {
  const threshold = clampNumber(options?.threshold, DEFAULT_WHITE_THRESHOLD, 180, 255);
  const chromaTolerance = clampNumber(options?.chromaTolerance, DEFAULT_CHROMA_TOLERANCE, 0, 80);
  const softness = clampNumber(options?.softness, DEFAULT_SOFTNESS, 0, 80);
  const softFloor = threshold - softness;

  let changedPixels = 0;

  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3];
    if (alpha === 0) continue;

    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];

    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const spread = maxChannel - minChannel;

    if (spread > chromaTolerance + Math.max(0, Math.round(softness / 2))) {
      continue;
    }

    if (minChannel >= threshold && spread <= chromaTolerance) {
      rgba[index + 3] = 0;
      changedPixels += 1;
      continue;
    }

    if (softness <= 0 || minChannel < softFloor) continue;

    const t = clampNumber((minChannel - softFloor) / Math.max(1, softness), 0, 0, 1);
    const nextAlpha = Math.max(0, Math.min(255, Math.round(alpha * (1 - t))));
    if (nextAlpha < alpha) {
      rgba[index + 3] = nextAlpha;
      changedPixels += 1;
    }
  }

  return changedPixels;
}

function isNearWhitePixel(
  rgba,
  pixelIndex,
  threshold,
  chromaTolerance,
  brightThreshold,
  brightSpreadTolerance
) {
  const rgbaIndex = pixelIndex * 4;
  const alpha = rgba[rgbaIndex + 3];
  if (alpha === 0) return false;

  const r = rgba[rgbaIndex];
  const g = rgba[rgbaIndex + 1];
  const b = rgba[rgbaIndex + 2];
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const spread = maxChannel - minChannel;
  if (minChannel >= threshold && spread <= chromaTolerance) {
    return true;
  }

  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma >= brightThreshold && spread <= brightSpreadTolerance;
}

function removeBackgroundConnectedWhiteFringe(rgba, width, height, options) {
  const baseThreshold = clampNumber(options?.threshold, DEFAULT_WHITE_THRESHOLD, 180, 255);
  const baseTolerance = clampNumber(options?.chromaTolerance, DEFAULT_CHROMA_TOLERANCE, 0, 80);
  const threshold = clampNumber(options?.fringeThreshold, baseThreshold - 20, 160, 255);
  const chromaTolerance = clampNumber(options?.fringeTolerance, baseTolerance + 14, 0, 100);
  const brightThreshold = clampNumber(options?.fringeBrightThreshold, threshold - 18, 145, 255);
  const brightSpreadTolerance = clampNumber(
    options?.fringeBrightSpreadTolerance,
    chromaTolerance + 48,
    10,
    160
  );

  const total = width * height;
  const nearWhite = new Uint8Array(total);
  for (let pixel = 0; pixel < total; pixel += 1) {
    nearWhite[pixel] = isNearWhitePixel(
      rgba,
      pixel,
      threshold,
      chromaTolerance,
      brightThreshold,
      brightSpreadTolerance
    )
      ? 1
      : 0;
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueueIfTraversable = (pixel) => {
    if (pixel < 0 || pixel >= total) return;
    if (visited[pixel]) return;
    const alpha = rgba[pixel * 4 + 3];
    const traversable = alpha === 0 || nearWhite[pixel] === 1;
    if (!traversable) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueueIfTraversable(x);
    enqueueIfTraversable((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueueIfTraversable(y * width);
    enqueueIfTraversable(y * width + (width - 1));
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueueIfTraversable(pixel - 1);
    if (x < width - 1) enqueueIfTraversable(pixel + 1);
    if (y > 0) enqueueIfTraversable(pixel - width);
    if (y < height - 1) enqueueIfTraversable(pixel + width);
  }

  let removed = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (!visited[pixel] || nearWhite[pixel] !== 1) continue;
    const rgbaIndex = pixel * 4;
    if (rgba[rgbaIndex + 3] === 0) continue;
    rgba[rgbaIndex + 3] = 0;
    removed += 1;
  }

  return removed;
}

function bleedOpaqueColorsIntoTransparent(rgba, width, height) {
  const source = rgba.slice();
  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const rgbaIndex = pixel * 4;
      if (source[rgbaIndex + 3] !== 0) continue;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let index = 0; index < directions.length; index += 1) {
        const [dx, dy] = directions[index];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nPixel = ny * width + nx;
        const nIndex = nPixel * 4;
        if (source[nIndex + 3] === 0) continue;
        sumR += source[nIndex];
        sumG += source[nIndex + 1];
        sumB += source[nIndex + 2];
        count += 1;
      }

      if (count === 0) continue;
      rgba[rgbaIndex] = Math.round(sumR / count);
      rgba[rgbaIndex + 1] = Math.round(sumG / count);
      rgba[rgbaIndex + 2] = Math.round(sumB / count);
    }
  }
}

function computeAdaptiveTransparentColor(rgba, width, height) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      if (rgba[index + 3] !== 0) continue;

      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (let i = 0; i < neighbors.length; i += 1) {
        const nIndex = neighbors[i] * 4;
        if (rgba[nIndex + 3] === 0) continue;
        sumR += rgba[nIndex];
        sumG += rgba[nIndex + 1];
        sumB += rgba[nIndex + 2];
        count += 1;
      }
    }
  }

  if (count === 0) return [255, 255, 255];
  return [
    Math.round(sumR / count),
    Math.round(sumG / count),
    Math.round(sumB / count),
  ];
}

function applyTransparentRgb(rgba, rgb) {
  const r = clampNumber(rgb?.[0], 255, 0, 255);
  const g = clampNumber(rgb?.[1], 255, 0, 255);
  const b = clampNumber(rgb?.[2], 255, 0, 255);
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] !== 0) continue;
    rgba[index] = r;
    rgba[index + 1] = g;
    rgba[index + 2] = b;
  }
}

function trimLightEdgePixels(rgba, width, height, options) {
  const lumaThreshold = clampNumber(options?.edgeTrimLumaThreshold, 178, 120, 255);
  const spreadThreshold = clampNumber(options?.edgeTrimSpreadThreshold, 132, 20, 220);
  const alphaSnapshot = new Uint8Array(width * height);
  for (let pixel = 0; pixel < alphaSnapshot.length; pixel += 1) {
    alphaSnapshot[pixel] = rgba[pixel * 4 + 3];
  }

  let trimmed = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      if (alphaSnapshot[pixel] === 0) continue;

      const left = alphaSnapshot[pixel - 1];
      const right = alphaSnapshot[pixel + 1];
      const up = alphaSnapshot[pixel - width];
      const down = alphaSnapshot[pixel + width];
      const adjacentToTransparent =
        left === 0 || right === 0 || up === 0 || down === 0;
      if (!adjacentToTransparent) continue;

      const rgbaIndex = pixel * 4;
      const r = rgba[rgbaIndex];
      const g = rgba[rgbaIndex + 1];
      const b = rgba[rgbaIndex + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (luma < lumaThreshold || spread > spreadThreshold) continue;

      rgba[rgbaIndex + 3] = 0;
      trimmed += 1;
    }
  }

  return trimmed;
}

function buildOpaqueEdgeMask(rgba, width, height) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      if (rgba[index + 3] === 0) continue;

      const leftTransparent = x <= 0 || rgba[(pixel - 1) * 4 + 3] === 0;
      const rightTransparent = x >= width - 1 || rgba[(pixel + 1) * 4 + 3] === 0;
      const upTransparent = y <= 0 || rgba[(pixel - width) * 4 + 3] === 0;
      const downTransparent = y >= height - 1 || rgba[(pixel + width) * 4 + 3] === 0;
      if (leftTransparent || rightTransparent || upTransparent || downTransparent) {
        mask[pixel] = 1;
      }
    }
  }
  return mask;
}

function buildOpaqueHaloDistanceMask(rgba, width, height, maxDistance = 2) {
  const total = width * height;
  const mask = new Uint8Array(total);
  if (maxDistance <= 0) return mask;

  const edgeMask = buildOpaqueEdgeMask(rgba, width, height);
  let frontier = [];
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (edgeMask[pixel] !== 1) continue;
    mask[pixel] = 1;
    frontier.push(pixel);
  }

  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (let distance = 2; distance <= maxDistance && frontier.length > 0; distance += 1) {
    const nextFrontier = [];
    for (let index = 0; index < frontier.length; index += 1) {
      const pixel = frontier[index];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
        const [dx, dy] = directions[directionIndex];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (mask[neighbor] !== 0) continue;
        if (rgba[neighbor * 4 + 3] === 0) continue;
        mask[neighbor] = distance;
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  return mask;
}

function colorDistanceAbs(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

function findInteriorReferenceColor(rgba, haloMask, width, height, x, y, radius) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let weightTotal = 0;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const pixel = ny * width + nx;
      if (haloMask[pixel] !== 0) continue;

      const rgbaIndex = pixel * 4;
      if (rgba[rgbaIndex + 3] === 0) continue;

      const distanceSquared = dx * dx + dy * dy;
      const weight = 1 / Math.max(1, distanceSquared);
      sumR += rgba[rgbaIndex] * weight;
      sumG += rgba[rgbaIndex + 1] * weight;
      sumB += rgba[rgbaIndex + 2] * weight;
      weightTotal += weight;
    }
  }

  if (weightTotal <= 0) return null;
  return [
    Math.round(sumR / weightTotal),
    Math.round(sumG / weightTotal),
    Math.round(sumB / weightTotal),
  ];
}

function estimateWhiteMatteAlpha(currentChannel, targetChannel) {
  const denominator = 255 - targetChannel;
  if (denominator <= 6) return null;
  const alpha = (255 - currentChannel) / denominator;
  return clampNumber(alpha, 1, 0.05, 1);
}

function repairWhiteMattedEdgePixels(rgba, width, height, options) {
  const haloDistance = clampNumber(options?.edgeDematteDistance, 2, 1, 4);
  const referenceRadius = clampNumber(options?.edgeDematteRadius, 4, 1, 8);
  const minBrightnessDelta = clampNumber(options?.edgeDematteMinBrightnessDelta, 8, 0, 80);
  const minWhitenessDelta = clampNumber(options?.edgeDematteMinWhitenessDelta, 16, 0, 160);
  const minColorDelta = clampNumber(options?.edgeDematteMinColorDelta, 20, 0, 255 * 3);
  const spreadSlack = clampNumber(options?.edgeDematteSpreadSlack, 40, 0, 180);
  const mask = buildOpaqueHaloDistanceMask(rgba, width, height, haloDistance);

  let repaired = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const ring = mask[pixel];
      if (ring === 0) continue;

      const index = pixel * 4;
      if (rgba[index + 3] === 0) continue;

      const target = findInteriorReferenceColor(rgba, mask, width, height, x, y, referenceRadius);
      if (!target) continue;

      const r = rgba[index];
      const g = rgba[index + 1];
      const b = rgba[index + 2];
      const [targetR, targetG, targetB] = target;

      const currentLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const targetLuma = 0.2126 * targetR + 0.7152 * targetG + 0.0722 * targetB;
      const currentSpread = Math.max(r, g, b) - Math.min(r, g, b);
      const targetSpread = Math.max(targetR, targetG, targetB) - Math.min(targetR, targetG, targetB);
      const currentDistanceToWhite = (255 - r) + (255 - g) + (255 - b);
      const targetDistanceToWhite =
        (255 - targetR) + (255 - targetG) + (255 - targetB);
      const brightnessDelta = currentLuma - targetLuma;
      const whitenessDelta = targetDistanceToWhite - currentDistanceToWhite;
      const towardWhiteChannels =
        Number(r >= targetR - 4) + Number(g >= targetG - 4) + Number(b >= targetB - 4);

      const likelyWhiteMatted =
        towardWhiteChannels >= 2 &&
        brightnessDelta >= minBrightnessDelta &&
        whitenessDelta >= minWhitenessDelta &&
        currentSpread <= targetSpread + spreadSlack;
      if (!likelyWhiteMatted) continue;

      const alphaCandidates = [
        estimateWhiteMatteAlpha(r, targetR),
        estimateWhiteMatteAlpha(g, targetG),
        estimateWhiteMatteAlpha(b, targetB),
      ].filter((value) => typeof value === "number");
      if (alphaCandidates.length === 0) continue;

      alphaCandidates.sort((left, right) => left - right);
      const alpha = alphaCandidates[Math.floor(alphaCandidates.length / 2)];
      const recoveredR = clampNumber((r - 255 * (1 - alpha)) / Math.max(alpha, 0.05), targetR, 0, 255);
      const recoveredG = clampNumber((g - 255 * (1 - alpha)) / Math.max(alpha, 0.05), targetG, 0, 255);
      const recoveredB = clampNumber((b - 255 * (1 - alpha)) / Math.max(alpha, 0.05), targetB, 0, 255);

      const candidateR = Math.round((recoveredR + targetR) / 2);
      const candidateG = Math.round((recoveredG + targetG) / 2);
      const candidateB = Math.round((recoveredB + targetB) / 2);
      const candidateDelta = colorDistanceAbs(r, g, b, candidateR, candidateG, candidateB);
      if (candidateDelta < minColorDelta) continue;

      const influence = ring === 1 ? 0.92 : 0.72;
      rgba[index] = Math.round(r + (candidateR - r) * influence);
      rgba[index + 1] = Math.round(g + (candidateG - g) * influence);
      rgba[index + 2] = Math.round(b + (candidateB - b) * influence);
      repaired += 1;
    }
  }

  return repaired;
}

function recolorMatteEdgePixels(rgba, width, height, options) {
  const edgeMask = buildOpaqueEdgeMask(rgba, width, height);
  const radius = clampNumber(options?.edgeRecolorRadius, 3, 1, 6);
  const lumaThreshold = clampNumber(options?.edgeRecolorLumaThreshold, 156, 90, 255);
  const spreadThreshold = clampNumber(options?.edgeRecolorSpreadThreshold, 52, 5, 255);
  const minColorDelta = clampNumber(options?.edgeRecolorMinDelta, 38, 0, 255 * 3);

  let recolored = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (edgeMask[pixel] !== 1) continue;

      const index = pixel * 4;
      const r = rgba[index];
      const g = rgba[index + 1];
      const b = rgba[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const likelyMatte = luma >= lumaThreshold || (spread <= spreadThreshold && luma >= lumaThreshold - 24);
      if (!likelyMatte) continue;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighborPixel = ny * width + nx;
          if (edgeMask[neighborPixel] === 1) continue;
          const nIndex = neighborPixel * 4;
          if (rgba[nIndex + 3] === 0) continue;
          sumR += rgba[nIndex];
          sumG += rgba[nIndex + 1];
          sumB += rgba[nIndex + 2];
          count += 1;
        }
      }

      let targetR = 0;
      let targetG = 0;
      let targetB = 0;
      if (count > 0) {
        targetR = Math.round(sumR / count);
        targetG = Math.round(sumG / count);
        targetB = Math.round(sumB / count);
      } else {
        let bestScore = -1;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const neighborPixel = ny * width + nx;
            const nIndex = neighborPixel * 4;
            if (rgba[nIndex + 3] === 0) continue;
            const nr = rgba[nIndex];
            const ng = rgba[nIndex + 1];
            const nb = rgba[nIndex + 2];
            const nLuma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
            const nSpread = Math.max(nr, ng, nb) - Math.min(nr, ng, nb);
            const score = (255 - nLuma) * 2 + nSpread;
            if (score <= bestScore) continue;
            bestScore = score;
            targetR = nr;
            targetG = ng;
            targetB = nb;
          }
        }
        if (bestScore < 0) continue;
      }

      const delta = colorDistanceAbs(r, g, b, targetR, targetG, targetB);
      if (delta < minColorDelta) continue;
      rgba[index] = targetR;
      rgba[index + 1] = targetG;
      rgba[index + 2] = targetB;
      recolored += 1;
    }
  }

  return recolored;
}

function resolveTransparentPaletteIndex(palette, transparentRgb = [255, 255, 255]) {
  if (!Array.isArray(palette)) return 0;
  const [tr, tg, tb] = [
    clampNumber(transparentRgb?.[0], 255, 0, 255),
    clampNumber(transparentRgb?.[1], 255, 0, 255),
    clampNumber(transparentRgb?.[2], 255, 0, 255),
  ];

  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    if (Array.isArray(color) && Number(color[3]) === 0) {
      color[0] = tr;
      color[1] = tg;
      color[2] = tb;
      return index;
    }
  }

  if (palette.length < 256) {
    palette.push([tr, tg, tb, 0]);
    return palette.length - 1;
  }

  palette[0] = [tr, tg, tb, 0];
  return 0;
}

function writeTransparentIndexes(indexBitmap, rgba, transparentIndex) {
  if (!(indexBitmap instanceof Uint8Array)) return;
  for (let pixelIndex = 0, rgbaIndex = 3; rgbaIndex < rgba.length; rgbaIndex += 4, pixelIndex += 1) {
    if (rgba[rgbaIndex] === 0) {
      indexBitmap[pixelIndex] = transparentIndex;
    }
  }
}

function isFrameDelay(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export async function convertGifWhiteToTransparent(bytes, options = {}) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length === 0) {
    return null;
  }

  const {
    parseGIF,
    decompressFrames,
    GIFEncoder,
    quantize,
    applyPalette,
  } = await loadGifModules();

  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = parseGIF(arrayBuffer);
  const frames = decompressFrames(parsed, true);
  if (!Array.isArray(frames) || frames.length === 0) {
    return null;
  }

  const canvasWidth = Math.max(1, Math.round(Number(parsed?.lsd?.width) || Number(frames[0]?.dims?.width) || 1));
  const canvasHeight = Math.max(
    1,
    Math.round(Number(parsed?.lsd?.height) || Number(frames[0]?.dims?.height) || 1)
  );
  if (canvasWidth * canvasHeight > MAX_PROCESSABLE_PIXELS) {
    return null;
  }

  const composedRgba = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  let previousFrame = null;
  let restoreSnapshot = null;
  let hasAnyTransparentChange = false;

  const encoder = GIFEncoder();

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];

    if (previousFrame?.disposalType === 2) {
      clearRectRgba(composedRgba, canvasWidth, canvasHeight, previousFrame.dims);
    } else if (previousFrame?.disposalType === 3 && restoreSnapshot) {
      composedRgba.set(restoreSnapshot);
    }

    const frameNeedsRestore = frame?.disposalType === 3;
    restoreSnapshot = frameNeedsRestore ? composedRgba.slice() : null;

    drawFramePatchOntoRgba(composedRgba, canvasWidth, canvasHeight, frame);

    if (frameIndex === 0) {
      const whiteRatio = estimateWhiteRatio(composedRgba, options);
      const minWhiteRatio = clampNumber(options?.minWhiteRatio, DEFAULT_MIN_WHITE_RATIO, 0, 1);
      if (whiteRatio < minWhiteRatio) {
        return null;
      }
    }

    const frameRgba = composedRgba.slice();
    const changedPixels = applyWhiteChromaKey(frameRgba, options);
    const fringePixels = removeBackgroundConnectedWhiteFringe(
      frameRgba,
      canvasWidth,
      canvasHeight,
      options
    );
    const trimmedEdgePixels = trimLightEdgePixels(
      frameRgba,
      canvasWidth,
      canvasHeight,
      options
    );
    const repairedDematteEdges = repairWhiteMattedEdgePixels(
      frameRgba,
      canvasWidth,
      canvasHeight,
      options
    );
    const recoloredMatteEdges = recolorMatteEdgePixels(
      frameRgba,
      canvasWidth,
      canvasHeight,
      options
    );
    if (
      changedPixels > 0 ||
      fringePixels > 0 ||
      trimmedEdgePixels > 0 ||
      repairedDematteEdges > 0 ||
      recoloredMatteEdges > 0
    ) {
      bleedOpaqueColorsIntoTransparent(frameRgba, canvasWidth, canvasHeight);
      hasAnyTransparentChange = true;
    }
    const transparentRgb = computeAdaptiveTransparentColor(
      frameRgba,
      canvasWidth,
      canvasHeight
    );
    applyTransparentRgb(frameRgba, transparentRgb);

    const palette = quantize(frameRgba, 255, {
      format: "rgba4444",
      oneBitAlpha: true,
      clearAlpha: false,
    });
    const transparentIndex = resolveTransparentPaletteIndex(palette, transparentRgb);
    const indexBitmap = applyPalette(frameRgba, palette, "rgba4444");
    writeTransparentIndexes(indexBitmap, frameRgba, transparentIndex);

    encoder.writeFrame(indexBitmap, canvasWidth, canvasHeight, {
      palette,
      transparent: true,
      transparentIndex,
      delay: isFrameDelay(frame?.delay) ? Number(frame.delay) : 80,
      repeat: frameIndex === 0 ? 0 : undefined,
      // Force restore-to-background between full-canvas transparent frames
      // to avoid ghost trails from previous frame pixels.
      dispose: 2,
    });

    previousFrame = frame;
  }

  if (!hasAnyTransparentChange) {
    return null;
  }

  encoder.finish();
  const output = encoder.bytesView();
  if (!(output instanceof Uint8Array) || output.length === 0) {
    return null;
  }

  return {
    bytes: Buffer.from(output),
    mimeType: "image/gif",
    width: canvasWidth,
    height: canvasHeight,
  };
}
