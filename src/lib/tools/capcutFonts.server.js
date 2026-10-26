import { inflateRawSync } from "node:zlib";

// CapCut ships every font as a small zip (config.json + the .ttf/.otf) listed in the package's
// material_list as `schema: "loki://fonts/<resource id>"`; a text style names it by `font.id`.
// CapCut sizes text by the font's line box (hhea ascender − descender, in em) of ITS OWN file,
// and its files differ from Google's (Gloock: 0.98 em vs 1.20), so the import reads them — and adds
// the ones the library lacks to it.

const FONT_FETCH_TIMEOUT_MS = 20_000;
const MAX_FONT_PACKAGE_BYTES = 15 * 1024 * 1024;

/** Entries of a zip archive as { name → Buffer }. Stored and deflated entries only. */
export function readZipEntries(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65_557); index -= 1) {
    if (data.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries = {};
  for (let entry = 0; entry < count; entry += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) break;
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localHeader = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    const start = localHeader + 30 + data.readUInt16LE(localHeader + 26) + data.readUInt16LE(localHeader + 28);
    const raw = data.subarray(start, start + compressedSize);
    if (method === 0) entries[name] = Buffer.from(raw);
    else if (method === 8) entries[name] = inflateRawSync(raw);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The font's line box — hhea (ascender − descender) / unitsPerEm — or null when unreadable. */
export function fontLineBox(fontBytes) {
  const data = Buffer.isBuffer(fontBytes) ? fontBytes : Buffer.from(fontBytes);
  const tables = sfntTables(data);
  if (!tables || tables.head === undefined || tables.hhea === undefined) return null;
  const unitsPerEm = data.readUInt16BE(tables.head + 18);
  const ascender = data.readInt16BE(tables.hhea + 4);
  const descender = data.readInt16BE(tables.hhea + 6);
  if (!unitsPerEm || ascender - descender <= 0) return null;
  const hhea = (ascender - descender) / unitsPerEm;
  // CapCut takes the SMALLER of the hhea and OS/2 typo boxes (whatever USE_TYPO_METRICS says):
  // SymphonyPro (hhea 1.20, typo 1.00, flag off) is drawn 1.2× bigger than an hhea sizing gives,
  // while HarmonyOS Sans (hhea 1.213, typo 1.327, flag off) matched its hhea box. Every other font
  // seen so far has the two equal.
  const os2 = tables["OS/2"];
  if (os2 !== undefined && os2 + 72 <= data.length) {
    const typo = (data.readInt16BE(os2 + 68) - data.readInt16BE(os2 + 70)) / unitsPerEm;
    if (typo > 0) return Math.min(hhea, typo);
  }
  return hhea;
}

/** Font file (.ttf/.otf) inside a CapCut font package, skipping macOS resource forks. */
function sfntTables(data) {
  if (data.length < 12) return null;
  const tableCount = data.readUInt16BE(4);
  const tables = {};
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > data.length) return null;
    tables[data.toString("latin1", record, record + 4)] = data.readUInt32BE(record + 8);
  }
  return tables;
}

/** The font's cmap as code point → glyph id (formats 4 and 12, the Unicode subtables). */
function readCmap(data, offset) {
  const glyphs = new Map();
  const count = data.readUInt16BE(offset + 2);
  const subtables = [];
  for (let index = 0; index < count; index += 1) {
    const record = offset + 4 + index * 8;
    const platform = data.readUInt16BE(record);
    const encoding = data.readUInt16BE(record + 2);
    if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) {
      subtables.push(offset + data.readUInt32BE(record + 4));
    }
  }
  for (const table of subtables) {
    const format = data.readUInt16BE(table);
    if (format === 4) {
      const segments = data.readUInt16BE(table + 6) / 2;
      const ends = table + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const end = data.readUInt16BE(ends + segment * 2);
        const start = data.readUInt16BE(starts + segment * 2);
        const delta = data.readInt16BE(deltas + segment * 2);
        const rangeOffset = data.readUInt16BE(ranges + segment * 2);
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          if (glyphs.has(code)) continue;
          let glyph;
          if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
          else {
            const at = ranges + segment * 2 + rangeOffset + (code - start) * 2;
            glyph = at + 2 <= data.length ? data.readUInt16BE(at) : 0;
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) glyphs.set(code, glyph);
        }
      }
    } else if (format === 12) {
      const groups = data.readUInt32BE(table + 12);
      for (let group = 0; group < groups; group += 1) {
        const record = table + 16 + group * 12;
        const start = data.readUInt32BE(record);
        const end = data.readUInt32BE(record + 4);
        const first = data.readUInt32BE(record + 8);
        for (let code = start; code <= end && code - start < 0x10000; code += 1) {
          if (!glyphs.has(code)) glyphs.set(code, first + (code - start));
        }
      }
    }
  }
  return glyphs;
}

/**
 * How wide a line of text is in this font, in em: the sum of its glyphs' advance widths (cmap +
 * hmtx; no kerning or shaping, so joined Arabic and kerned pairs come out a little wide — the
 * import only needs a box that does not wrap). Unknown characters count half an em; combining
 * marks and format characters nothing. Null when the file cannot be read.
 */
export function fontAdvanceMeasure(fontBytes) {
  try {
    const data = Buffer.isBuffer(fontBytes) ? fontBytes : Buffer.from(fontBytes);
    const tables = sfntTables(data);
    if (!tables || tables.head === undefined || tables.hhea === undefined || tables.hmtx === undefined || tables.cmap === undefined) {
      return null;
    }
    const unitsPerEm = data.readUInt16BE(tables.head + 18);
    const metrics = data.readUInt16BE(tables.hhea + 34);
    if (!unitsPerEm || !metrics) return null;
    const cmap = readCmap(data, tables.cmap);
    const advance = (glyph) => data.readUInt16BE(tables.hmtx + Math.min(glyph, metrics - 1) * 4);
    return (text) => {
      let units = 0;
      for (const char of String(text)) {
        if (/[\p{M}\p{Cf}\n]/u.test(char)) continue;
        const glyph = cmap.get(char.codePointAt(0));
        units += glyph ? advance(glyph) : unitsPerEm / 2;
      }
      return units / unitsPerEm;
    };
  } catch {
    return null;
  }
}

export function fontFileFromPackage(zipBytes) {
  const entries = readZipEntries(zipBytes);
  const name = Object.keys(entries).find((entry) => /\.(ttf|otf)$/i.test(entry) && !/(^|\/)(__MACOSX|\._)/.test(entry));
  return name ? { fileName: name.split("/").pop(), bytes: entries[name] } : null;
}

/** Font resource ids the draft's text styles use. */
export function capcutFontResourceIds(draft) {
  const ids = new Set();
  for (const material of Array.isArray(draft?.materials?.texts) ? draft.materials.texts : []) {
    let content = null;
    try {
      content = JSON.parse(material.content);
    } catch {
      content = null;
    }
    for (const style of Array.isArray(content?.styles) ? content.styles : []) {
      if (style?.font?.id) ids.add(String(style.font.id));
    }
  }
  return ids;
}

async function fetchFontPackage(urls) {
  let lastError = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_FONT_PACKAGE_BYTES) throw new Error("bad size");
      return bytes;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("no download url");
}

/**
 * CapCut's own font files for the fonts the draft uses: per font resource id, the line box (for
 * sizing), a line-width measure (for the text box) and the file (for adding it to the library). Fonts that cannot be fetched or parsed
 * are left out (the mapper falls back to a default line box).
 */
export async function loadCapcutFonts({ draft, materialList }) {
  const needed = capcutFontResourceIds(draft);
  const lineBoxes = new Map();
  const files = new Map();
  const measures = new Map();
  const failures = [];
  // Font packages come two ways: `loki://fonts/<id>` (FileUrl.UrlList) and, in newer
  // templates, `heycan://<id>` (common_attr.item_urls) — the same zip either way.
  const packages = (Array.isArray(materialList) ? materialList : [])
    .map((item) => {
      const schema = String(item?.schema || "");
      const loki = /^loki:\/\/fonts\/(\d+)/.exec(schema);
      if (loki) return { resourceId: loki[1], item, urls: item?.loki_item?.FileUrl?.UrlList };
      const heycan = /^heycan:\/\/(\d+)/.exec(schema);
      if (heycan) return { resourceId: heycan[1], item, urls: item?.heycan_item?.common_attr?.item_urls };
      return null;
    })
    .filter((entry) => entry && needed.has(entry.resourceId));
  await Promise.all(
    packages.map(async ({ resourceId, item, urls: rawUrls }) => {
      const urls = Array.isArray(rawUrls) ? rawUrls.filter(Boolean) : [];
      const name = String(item?.loki_item?.Name || item?.heycan_item?.common_attr?.title || resourceId);
      try {
        const font = fontFileFromPackage(await fetchFontPackage(urls));
        const lineBox = font ? fontLineBox(font.bytes) : null;
        if (lineBox) {
          lineBoxes.set(resourceId, lineBox);
          files.set(resourceId, font);
          const measure = fontAdvanceMeasure(font.bytes);
          if (measure) measures.set(resourceId, measure);
        } else {
          failures.push(name);
        }
      } catch {
        failures.push(name);
      }
    })
  );
  return { lineBoxes, files, measures, failures };
}
