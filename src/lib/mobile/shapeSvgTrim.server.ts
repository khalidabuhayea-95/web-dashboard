// Trims the transparent padding baked into built-in shape SVGs by cropping the <svg> viewBox to
// the rendered content's bounding box. The raster pipeline already trims (sharp .trim() +
// computeTrimTransparentPaddingPatch); this gives the vector (?format=svg) path the SAME tight
// bounds so a shape fills its layer box instead of floating with margin — and so the reported
// dimensions match the vector's aspect (else the mobile app's FillBounds would distort it).
//
// Results are memoized per source string: the catalog is static and URLs are versioned+immutable,
// so each shape is rendered at most once per server lifetime.

export interface TrimmedShapeSvg {
  svg: string;
  width: number;
  height: number;
}

const trimCache = new Map<string, TrimmedShapeSvg>();

function decodeSvgSource(source: string): string {
  const raw = String(source || "").trim();
  if (raw.startsWith("<svg")) return raw;
  if (!raw.startsWith("data:image/svg+xml")) return raw;
  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) return raw;
  const metadata = raw.slice(0, commaIndex).toLowerCase();
  const payload = raw.slice(commaIndex + 1);
  return metadata.includes(";base64")
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
}

function parseViewBox(svg: string): [number, number, number, number] | null {
  const match = svg.match(/viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/);
  if (!match) return null;
  const values = match.slice(1, 5).map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) return null;
  return [values[0], values[1], values[2], values[3]];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Returns the SVG cropped to its content bounding box, plus the tight width/height (in viewBox
 * units). Falls back to the original SVG + viewBox size if it can't be parsed/rendered or the
 * content is fully transparent. Never throws.
 */
export async function trimShapeSvg(source: string): Promise<TrimmedShapeSvg> {
  const cacheKey = String(source || "");
  const cached = trimCache.get(cacheKey);
  if (cached) return cached;

  const svg = decodeSvgSource(cacheKey);
  const viewBox = parseViewBox(svg);

  const fallback: TrimmedShapeSvg = {
    svg,
    width: viewBox ? Math.max(1, Math.round(viewBox[2])) : 1,
    height: viewBox ? Math.max(1, Math.round(viewBox[3])) : 1,
  };

  if (!viewBox) {
    trimCache.set(cacheKey, fallback);
    return fallback;
  }

  try {
    const [vx, vy, vw, vh] = viewBox;
    // Render at ~400px on the longest edge — enough precision for a tight crop, cheap to scan.
    const density = Math.min(2400, Math.max(72, Math.round((72 * 400) / Math.max(vw, vh))));
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default || sharpModule;
    const { data, info } = await sharp(Buffer.from(svg), { density })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width: rw, height: rh, channels } = info;
    let minX = rw;
    let minY = rh;
    let maxX = -1;
    let maxY = -1;
    const alphaThreshold = 8;
    for (let y = 0; y < rh; y += 1) {
      for (let x = 0; x < rw; x += 1) {
        const alpha = data[(y * rw + x) * channels + (channels - 1)];
        if (alpha > alphaThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      // Fully transparent (shouldn't happen for a real shape) — keep the original.
      trimCache.set(cacheKey, fallback);
      return fallback;
    }

    // Map the pixel bbox back into viewBox units.
    const nx = vx + (minX / rw) * vw;
    const ny = vy + (minY / rh) * vh;
    const nw = ((maxX - minX + 1) / rw) * vw;
    const nh = ((maxY - minY + 1) / rh) * vh;

    // Leave thin line/stroke shapes untrimmed: their transparent box is intentional (the app
    // applies a line-specific insert crop that assumes it), and cropping to the stroke would
    // collapse the box to a sliver. An extreme trimmed aspect ratio is the tell.
    const trimmedAspect = nw / Math.max(nh, 0.0001);
    if (trimmedAspect > 8 || trimmedAspect < 0.125) {
      trimCache.set(cacheKey, fallback);
      return fallback;
    }

    // Rewrite only the opening <svg> tag so width/height on inner elements (e.g. <rect>) are safe.
    const tagEnd = svg.indexOf(">");
    if (tagEnd < 0) {
      trimCache.set(cacheKey, fallback);
      return fallback;
    }
    const head = svg
      .slice(0, tagEnd)
      .replace(/\swidth="[^"]*"/, ` width="${round(nw)}"`)
      .replace(/\sheight="[^"]*"/, ` height="${round(nh)}"`)
      .replace(/viewBox="[^"]*"/, `viewBox="${round(nx)} ${round(ny)} ${round(nw)} ${round(nh)}"`);
    const trimmed: TrimmedShapeSvg = {
      svg: head + svg.slice(tagEnd),
      width: Math.max(1, Math.round(nw)),
      height: Math.max(1, Math.round(nh)),
    };
    trimCache.set(cacheKey, trimmed);
    return trimmed;
  } catch {
    trimCache.set(cacheKey, fallback);
    return fallback;
  }
}
