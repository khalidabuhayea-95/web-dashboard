import { normalizeHexColor } from "@/lib/editor/colorUtils";

// v3: shapes with a `vectorSrc` derive their palette from the SVG's authored colors instead of
// pixel-extracting the rasterized PNG (whose anti-aliased edges hallucinate phantom entries).
export const RASTER_PALETTE_VERSION = 3;

type RgbColor = [number, number, number];
type HslColor = { h: number; s: number; l: number };
type QuantizedBin = { rgb: RgbColor; count: number };
type ColorCluster = {
  count: number;
  rSum: number;
  gSum: number;
  bSum: number;
  representative: RgbColor;
};

const recolorCache = new Map<string, Promise<string>>();

function asString(value: unknown) {
  return String(value || "").trim();
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(value: number) {
  return clampChannel(value).toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(value: string): RgbColor | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  const safe = normalized.slice(1);
  return [
    Number.parseInt(safe.slice(0, 2), 16),
    Number.parseInt(safe.slice(2, 4), 16),
    Number.parseInt(safe.slice(4, 6), 16),
  ];
}

function colorDistance(a: RgbColor, b: RgbColor) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const red = clampChannel(r) / 255;
  const green = clampChannel(g) / 255;
  const blue = clampChannel(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;
  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0);
      break;
    case green:
      hue = (blue - red) / delta + 2;
      break;
    default:
      hue = (red - green) / delta + 4;
      break;
  }

  return { h: hue / 6, s: saturation, l: lightness };
}

function hslToRgb(hsl: HslColor): RgbColor {
  const hue = ((hsl.h % 1) + 1) % 1;
  const saturation = clampUnit(hsl.s);
  const lightness = clampUnit(hsl.l);

  if (saturation <= 0.0001) {
    const gray = clampChannel(lightness * 255);
    return [gray, gray, gray];
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  const hueToChannel = (offset: number) => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  return [
    clampChannel(hueToChannel(1 / 3) * 255),
    clampChannel(hueToChannel(0) * 255),
    clampChannel(hueToChannel(-1 / 3) * 255),
  ];
}

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1 - diff);
}

function smartColorDistance(a: RgbColor, b: RgbColor) {
  const rgbDistance = colorDistance(a, b) / 255;
  const ahsl = rgbToHsl(a[0], a[1], a[2]);
  const bhsl = rgbToHsl(b[0], b[1], b[2]);
  const hueWeight = Math.max(ahsl.s, bhsl.s, 0.12);
  const hueGap = hueDistance(ahsl.h, bhsl.h) * hueWeight;
  const saturationGap = Math.abs(ahsl.s - bhsl.s);
  const lightnessGap = Math.abs(ahsl.l - bhsl.l);
  return rgbDistance * 0.52 + hueGap * 1.85 + saturationGap * 0.72 + lightnessGap * 1.08;
}

function decodeQuantizedColor(binKey: string) {
  const packed = Number(binKey);
  const r = ((packed >> 8) & 0x0f) * 17;
  const g = ((packed >> 4) & 0x0f) * 17;
  const b = (packed & 0x0f) * 17;
  return [r, g, b] as RgbColor;
}

async function loadImage(sourceInput: string) {
  const source = asString(sourceInput);
  if (!source) {
    throw new Error("Image source is required.");
  }
  if (typeof Image === "undefined") {
    throw new Error("Image API is unavailable in this environment.");
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load image source."));
    image.src = source;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      resolve();
    }
  });

  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("Invalid image dimensions.");
  }
  return image;
}

function normalizePalette(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => normalizeHexColor(String(value || "")))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function averageClusterColor(cluster: ColorCluster): RgbColor {
  const count = Math.max(1, cluster.count);
  return [
    clampChannel(cluster.rSum / count),
    clampChannel(cluster.gSum / count),
    clampChannel(cluster.bSum / count),
  ];
}

function buildColorClusters(bins: QuantizedBin[]) {
  const clusters: ColorCluster[] = [];

  for (let index = 0; index < bins.length; index += 1) {
    const bin = bins[index];
    const candidate = bin.rgb;
    const candidateHsl = rgbToHsl(candidate[0], candidate[1], candidate[2]);
    let bestCluster: ColorCluster | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const cluster = clusters[clusterIndex];
      const representative = averageClusterColor(cluster);
      const representativeHsl = rgbToHsl(
        representative[0],
        representative[1],
        representative[2]
      );
      const distance = smartColorDistance(candidate, representative);
      const closeInHue =
        hueDistance(candidateHsl.h, representativeHsl.h) <= 0.075 &&
        Math.abs(candidateHsl.l - representativeHsl.l) <= 0.2;
      const closeInGray =
        Math.max(candidateHsl.s, representativeHsl.s) <= 0.14 &&
        Math.abs(candidateHsl.l - representativeHsl.l) <= 0.16;
      if (distance < 0.18 || closeInHue || closeInGray) {
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = cluster;
        }
      }
    }

    if (bestCluster) {
      bestCluster.count += bin.count;
      bestCluster.rSum += candidate[0] * bin.count;
      bestCluster.gSum += candidate[1] * bin.count;
      bestCluster.bSum += candidate[2] * bin.count;
      bestCluster.representative = averageClusterColor(bestCluster);
      continue;
    }

    clusters.push({
      count: bin.count,
      rSum: candidate[0] * bin.count,
      gSum: candidate[1] * bin.count,
      bSum: candidate[2] * bin.count,
      representative: candidate,
    });
  }

  return clusters
    .map((cluster) => ({
      ...cluster,
      representative: averageClusterColor(cluster),
    }))
    .sort((a, b) => b.count - a.count);
}

function shouldIgnoreBackgroundCluster(cluster: ColorCluster) {
  const hsl = rgbToHsl(
    cluster.representative[0],
    cluster.representative[1],
    cluster.representative[2]
  );
  return (
    (hsl.l >= 0.94 && hsl.s <= 0.12) ||
    (hsl.l <= 0.07 && hsl.s <= 0.08)
  );
}

export function normalizeRasterColorMap(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => {
      const original = normalizeHexColor(String(key || ""));
      const mapped = normalizeHexColor(String(value || ""));
      return original && mapped ? ([original, mapped] as const) : null;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry))
    .sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

export function serializeRasterColorMap(input: unknown) {
  const normalized = normalizeRasterColorMap(input);
  return JSON.stringify(
    Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))
  );
}

export async function extractImagePaletteFromSource(sourceInput: string, maxColors = 6) {
  const source = asString(sourceInput);
  if (!source) return [];
  if (typeof document === "undefined") return [];

  const image = await loadImage(source);
  const sampleSide = 96;
  const width = Math.max(1, Math.min(sampleSide, image.naturalWidth));
  const height = Math.max(1, Math.min(sampleSide, image.naturalHeight));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const bins = new Map<string, number>();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 24) continue;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    const qr = Math.round(r / 17) & 0x0f;
    const qg = Math.round(g / 17) & 0x0f;
    const qb = Math.round(b / 17) & 0x0f;
    const packed = (qr << 8) | (qg << 4) | qb;
    const key = String(packed);
    bins.set(key, (bins.get(key) || 0) + 1);
  }

  if (bins.size === 0) return [];

  const quantizedBins = Array.from(bins.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([binKey, count]) => ({ rgb: decodeQuantizedColor(binKey), count }));

  const clusters = buildColorClusters(quantizedBins);
  const nonBackgroundClusters = clusters.filter((cluster) => !shouldIgnoreBackgroundCluster(cluster));
  const visibleClusters =
    nonBackgroundClusters.length >= 2 ? nonBackgroundClusters : clusters;
  const picked = visibleClusters
    .slice(0, Math.max(1, maxColors))
    .map((cluster) => cluster.representative);

  return Array.from(
    new Set(
      picked
        .map(([r, g, b]) => normalizeHexColor(rgbToHex(r, g, b)))
        .filter((value): value is string => Boolean(value))
    )
  );
}

type RecolorEntry = {
  originalHex: string;
  originalRgb: RgbColor;
  replacementRgb: RgbColor;
};

function buildRecolorEntries(paletteInput: unknown, colorMapInput: unknown) {
  const palette = normalizePalette(paletteInput);
  const colorMap = normalizeRasterColorMap(colorMapInput);
  return palette
    .map((originalHex) => {
      const mappedHex = colorMap[originalHex];
      if (!mappedHex || mappedHex === originalHex) return null;
      const originalRgb = hexToRgb(originalHex);
      const replacementRgb = hexToRgb(mappedHex);
      if (!originalRgb || !replacementRgb) return null;
      return {
        originalHex,
        originalRgb,
        replacementRgb,
      } satisfies RecolorEntry;
    })
    .filter((entry): entry is RecolorEntry => Boolean(entry));
}

function recolorPixel(pixel: RgbColor, originalRgb: RgbColor, replacementRgb: RgbColor) {
  const pixelHsl = rgbToHsl(pixel[0], pixel[1], pixel[2]);
  const originalHsl = rgbToHsl(originalRgb[0], originalRgb[1], originalRgb[2]);
  const replacementHsl = rgbToHsl(
    replacementRgb[0],
    replacementRgb[1],
    replacementRgb[2]
  );

  const lightnessOffset = pixelHsl.l - originalHsl.l;
  const originalSaturation = Math.max(originalHsl.s, 0.08);
  const saturationRatio = pixelHsl.s / originalSaturation;

  const next = hslToRgb({
    h: replacementHsl.h,
    s: clampUnit(replacementHsl.s * (0.7 + Math.min(1.4, saturationRatio) * 0.4)),
    l: clampUnit(replacementHsl.l + lightnessOffset),
  });

  return next;
}

export async function recolorRasterSourceToDataUrl(
  sourceInput: string,
  paletteInput: unknown,
  colorMapInput: unknown
) {
  const source = asString(sourceInput);
  if (!source || typeof document === "undefined") return source;

  const recolorEntries = buildRecolorEntries(paletteInput, colorMapInput);
  if (recolorEntries.length === 0) return source;

  const cacheKey = `${source}::${JSON.stringify(
    recolorEntries.map((entry) => [entry.originalHex, rgbToHex(...entry.replacementRgb)])
  )}`;
  const cached = recolorCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    const image = await loadImage(source);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth);
    canvas.height = Math.max(1, image.naturalHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return source;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = frame;
    const threshold = 0.34;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 8) continue;

      const pixel: RgbColor = [data[index], data[index + 1], data[index + 2]];

      let nearest: RecolorEntry | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (let colorIndex = 0; colorIndex < recolorEntries.length; colorIndex += 1) {
        const candidate = recolorEntries[colorIndex];
        const distance = smartColorDistance(pixel, candidate.originalRgb);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }

      if (!nearest || nearestDistance > threshold) continue;

      const influence = Math.pow(1 - nearestDistance / threshold, 0.5);
      const [recoloredR, recoloredG, recoloredB] = recolorPixel(
        pixel,
        nearest.originalRgb,
        nearest.replacementRgb
      );

      data[index] = clampChannel(pixel[0] * (1 - influence) + recoloredR * influence);
      data[index + 1] = clampChannel(pixel[1] * (1 - influence) + recoloredG * influence);
      data[index + 2] = clampChannel(pixel[2] * (1 - influence) + recoloredB * influence);
    }

    context.putImageData(frame, 0, 0);
    return canvas.toDataURL("image/png");
  })()
    .catch(() => source)
    .finally(() => {
      recolorCache.delete(cacheKey);
    });

  recolorCache.set(cacheKey, task);
  return task;
}

/** Decodes a raw `<svg …>` string or an SVG data URL (utf8 or base64) to its markup. */
function decodeSvgSource(input: string): { svg: string; isDataUrl: boolean } | null {
  const source = asString(input);
  if (!source) return null;
  if (source.startsWith("data:image/svg+xml")) {
    const comma = source.indexOf(",");
    if (comma < 0) return null;
    const payload = source.slice(comma + 1);
    try {
      const svg = source.slice(0, comma).includes(";base64")
        ? typeof atob === "function"
          ? atob(payload)
          : Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return { svg, isDataUrl: true };
    } catch {
      return null;
    }
  }
  if (source.startsWith("<")) return { svg: source, isDataUrl: false };
  return null;
}

/**
 * Lists the distinct colours actually authored inside an SVG (its `#rgb`/`#rrggbb` tokens), in
 * document order. For shapes that keep their original SVG this is the TRUE palette — unlike pixel
 * extraction from the rasterized PNG, whose anti-aliased edge pixels can hallucinate near-black
 * phantom entries (e.g. a flat #111827 shape yielding a bogus second "#001122" swatch).
 * Returns [] when the input isn't an SVG or holds no hex colours (caller should fall back).
 */
export function extractSvgPaletteColors(svgInput: string, maxColors = 6): string[] {
  const decoded = decodeSvgSource(asString(svgInput));
  if (!decoded) return [];
  const seen = new Set<string>();
  const colors: string[] = [];
  const matches = decoded.svg.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || [];
  for (const token of matches) {
    const normalized = normalizeHexColor(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    colors.push(normalized);
    if (colors.length >= Math.max(1, maxColors)) break;
  }
  return colors;
}

/**
 * Re-keys a raster colour map onto a re-derived palette: every original→target entry moves to the
 * nearest colour of `newPalette` (plain RGB distance), so a user's recolour survives a palette
 * refresh. When several old keys collapse onto one new colour, the closest original wins — e.g.
 * a phantom edge-artifact entry loses to the shape's real fill. Identity mappings are dropped.
 */
export function migrateRasterColorMap(colorMapInput: unknown, newPalette: string[]) {
  const colorMap = normalizeRasterColorMap(colorMapInput);
  const paletteRgb = (Array.isArray(newPalette) ? newPalette : [])
    .map((value) => {
      const hex = normalizeHexColor(String(value || ""));
      const rgb = hex ? hexToRgb(hex) : null;
      return hex && rgb ? { hex, rgb } : null;
    })
    .filter((entry): entry is { hex: string; rgb: RgbColor } => Boolean(entry));
  if (paletteRgb.length === 0) return {};

  const best = new Map<string, { target: string; distance: number }>();
  for (const [originalHex, targetHex] of Object.entries(colorMap)) {
    const originalRgb = hexToRgb(originalHex);
    if (!originalRgb) continue;
    let nearest = paletteRgb[0];
    let nearestDistance = colorDistance(originalRgb, nearest.rgb);
    for (let i = 1; i < paletteRgb.length; i += 1) {
      const distance = colorDistance(originalRgb, paletteRgb[i].rgb);
      if (distance < nearestDistance) {
        nearest = paletteRgb[i];
        nearestDistance = distance;
      }
    }
    const current = best.get(nearest.hex);
    if (!current || nearestDistance < current.distance) {
      best.set(nearest.hex, { target: targetHex, distance: nearestDistance });
    }
  }

  const migrated: Record<string, string> = {};
  for (const [hex, entry] of best) {
    if (entry.target !== hex) migrated[hex] = entry.target;
  }
  return normalizeRasterColorMap(migrated);
}

/**
 * Applies the same palette→target recolour that {@link recolorRasterSourceToDataUrl} performs on
 * pixels, but to the solid colour tokens inside an SVG string — so a recoloured shape can render as
 * a crisp vector instead of a rasterised PNG. Each `#rgb`/`#rrggbb` token in the SVG is matched to
 * the nearest mapped palette colour (identical distance + 0.34 threshold as the raster path) and
 * transformed with the same HSL {@link recolorPixel} maths + influence blend, so the vector looks
 * the same as the recoloured raster would, just sharp.
 *
 * Pure + synchronous (no canvas/DOM) so it runs on the server (template asset route) and client.
 * Accepts a raw `<svg …>` string or an SVG data URL and returns the same shape it was given.
 * Returns the source unchanged when there is no active remap or nothing matches. Never throws.
 */
export function recolorSvgSource(
  svgSource: string,
  paletteInput: unknown,
  colorMapInput: unknown
): string {
  const source = asString(svgSource);
  if (!source) return svgSource;

  const recolorEntries = buildRecolorEntries(paletteInput, colorMapInput);
  if (recolorEntries.length === 0) return svgSource;

  const decoded = decodeSvgSource(source);
  if (!decoded) return svgSource;
  const { svg, isDataUrl } = decoded;

  const threshold = 0.34;
  const recolored = svg.replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, (token) => {
    const rgb = hexToRgb(token);
    if (!rgb) return token;

    let nearest: RecolorEntry | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < recolorEntries.length; i += 1) {
      const distance = smartColorDistance(rgb, recolorEntries[i].originalRgb);
      if (distance < nearestDistance) {
        nearest = recolorEntries[i];
        nearestDistance = distance;
      }
    }
    if (!nearest || nearestDistance > threshold) return token;

    const influence = Math.pow(1 - nearestDistance / threshold, 0.5);
    const [rr, rg, rb] = recolorPixel(rgb, nearest.originalRgb, nearest.replacementRgb);
    return rgbToHex(
      rgb[0] * (1 - influence) + rr * influence,
      rgb[1] * (1 - influence) + rg * influence,
      rgb[2] * (1 - influence) + rb * influence
    );
  });

  if (recolored === svg) return svgSource;

  return isDataUrl
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(recolored)}`
    : recolored;
}
