const SVG_MIME_PREFIX = "data:image/svg";
const SVG_XMLNS = "http://www.w3.org/2000/svg";

const COLOR_ATTRIBUTES = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"] as const;
const STYLE_COLOR_PROPERTIES = new Set<string>(COLOR_ATTRIBUTES);
const IGNORED_COLOR_TOKENS = new Set(["", "none", "transparent", "currentcolor", "inherit", "initial", "unset"]);

let colorContext: CanvasRenderingContext2D | null = null;
const svgTextCache = new Map<string, Promise<string>>();
const svgRecolorCache = new Map<string, Promise<string>>();

function asString(value: unknown) {
  return String(value || "").trim();
}

function toHex(value: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

function parseCssRgbToken(raw: string) {
  const source = asString(raw);
  const compact = source
    .replace(/^rgba?\(/i, "")
    .replace(/\)$/g, "")
    .replace(/\//g, " ")
    .trim();
  if (!compact) return null;

  const segments = compact.includes(",")
    ? compact.split(",").map((part) => part.trim())
    : compact.split(/\s+/).map((part) => part.trim());
  if (segments.length < 3) return null;

  const channels = segments.slice(0, 3).map((part) => {
    if (part.endsWith("%")) {
      const numeric = Number(part.slice(0, -1));
      if (!Number.isFinite(numeric)) return Number.NaN;
      return (numeric / 100) * 255;
    }
    return Number(part);
  });

  if (channels.some((value) => !Number.isFinite(value))) return null;
  return `#${toHex(channels[0])}${toHex(channels[1])}${toHex(channels[2])}`;
}

function normalizeHexToken(raw: string) {
  const match = asString(raw).match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (!match) return null;
  const token = match[1].toLowerCase();

  if (token.length === 3 || token.length === 4) {
    const expanded = token
      .slice(0, 3)
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded}`;
  }

  if (token.length === 6 || token.length === 8) {
    return `#${token.slice(0, 6)}`;
  }

  return null;
}

function getColorContext() {
  if (colorContext) return colorContext;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  colorContext = canvas.getContext("2d");
  return colorContext;
}

export function normalizeHexColor(raw: string) {
  const source = asString(raw);
  if (!source) return null;

  const normalizedLower = source.toLowerCase();
  if (
    IGNORED_COLOR_TOKENS.has(normalizedLower) ||
    normalizedLower.startsWith("url(") ||
    normalizedLower.startsWith("var(")
  ) {
    return null;
  }

  const hex = normalizeHexToken(source);
  if (hex) return hex;

  if (/^rgba?\(/i.test(source)) {
    const rgb = parseCssRgbToken(source);
    if (rgb) return rgb;
  }

  const ctx = getColorContext();
  if (!ctx) return null;

  const sentinel = "#010203";
  ctx.fillStyle = sentinel;
  try {
    ctx.fillStyle = source;
  } catch {
    return null;
  }

  const resolved = asString(ctx.fillStyle).toLowerCase();
  if (resolved === sentinel && source.toLowerCase() !== sentinel) return null;

  const resolvedHex = normalizeHexToken(resolved);
  if (resolvedHex) return resolvedHex;
  if (resolved.startsWith("rgb")) {
    return parseCssRgbToken(resolved);
  }

  return null;
}

function parseDataUriSvgText(dataUri: string) {
  const source = asString(dataUri);
  const commaIndex = source.indexOf(",");
  if (commaIndex < 0) return "";
  const meta = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);

  try {
    if (meta.includes(";base64")) {
      return atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return "";
  }
}

function serializeSvgTextToDataUrl(svgText: string) {
  const encoded = new TextEncoder().encode(svgText);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < encoded.length; index += chunkSize) {
    const slice = encoded.subarray(index, Math.min(encoded.length, index + chunkSize));
    binary += String.fromCharCode(...slice);
  }
  return `${SVG_MIME_PREFIX}+xml;base64,${btoa(binary)}`;
}

function ensureParsedSvgDocument(svgText: string) {
  if (typeof DOMParser === "undefined") {
    throw new Error("SVG parsing is unavailable in this environment.");
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (!doc?.documentElement || doc.documentElement.nodeName.toLowerCase() === "parsererror") {
    throw new Error("Invalid SVG document.");
  }
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid SVG parser output.");
  }
  return doc;
}

function parseInlineStyle(styleText: string) {
  const declarations: Array<{ property: string; value: string }> = [];
  styleText
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((chunk) => {
      const separatorIndex = chunk.indexOf(":");
      if (separatorIndex < 1) return;
      const property = chunk.slice(0, separatorIndex).trim().toLowerCase();
      const value = chunk.slice(separatorIndex + 1).trim();
      if (!property || !value) return;
      declarations.push({ property, value });
    });
  return declarations;
}

function buildInlineStyle(declarations: Array<{ property: string; value: string }>) {
  return declarations.map((declaration) => `${declaration.property}:${declaration.value}`).join(";");
}

function readSvgColors(doc: Document) {
  const colors = new Set<string>();
  const nodes = doc.querySelectorAll("*");

  nodes.forEach((node) => {
    COLOR_ATTRIBUTES.forEach((attribute) => {
      const token = node.getAttribute(attribute);
      const normalized = normalizeHexColor(token || "");
      if (normalized) colors.add(normalized);
    });

    const styleToken = node.getAttribute("style");
    if (!styleToken) return;
    const declarations = parseInlineStyle(styleToken);
    declarations.forEach((declaration) => {
      if (!STYLE_COLOR_PROPERTIES.has(declaration.property)) return;
      const normalized = normalizeHexColor(declaration.value);
      if (normalized) colors.add(normalized);
    });
  });

  return Array.from(colors).sort();
}

async function fetchSvgText(source: string) {
  const rawSource = asString(source);
  if (!rawSource) throw new Error("Missing SVG source.");

  if (rawSource.toLowerCase().startsWith("data:image/svg")) {
    const dataText = parseDataUriSvgText(rawSource);
    if (!dataText) throw new Error("Failed to decode SVG data URI.");
    return dataText;
  }

  const response = await fetch(rawSource, {
    method: "GET",
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`Failed to load SVG source (HTTP ${response.status}).`);
  }
  return response.text();
}

async function getSvgTextCached(source: string) {
  const cacheKey = asString(source);
  if (!cacheKey) throw new Error("Missing SVG source.");
  if (!svgTextCache.has(cacheKey)) {
    svgTextCache.set(cacheKey, fetchSvgText(cacheKey));
  }
  return svgTextCache.get(cacheKey) as Promise<string>;
}

export function isSvgSource(source: unknown) {
  const value = asString(source).toLowerCase();
  if (!value) return false;
  if (value.startsWith(SVG_MIME_PREFIX)) return true;
  if (value.startsWith("data:image/svg+xml")) return true;

  try {
    const parsed = new URL(value);
    return /\.svg$/i.test(parsed.pathname || "");
  } catch {
    return /\.svg(?:$|[?#])/i.test(value);
  }
}

export function normalizeSvgColorMap(input: unknown) {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input as Record<string, unknown>);
  const map: Record<string, string> = {};

  entries.forEach(([rawKey, rawValue]) => {
    const key = normalizeHexColor(rawKey);
    const value = normalizeHexColor(asString(rawValue));
    if (!key || !value || key === value) return;
    map[key] = value;
  });

  return map;
}

export function serializeSvgColorMap(input: unknown) {
  const normalized = normalizeSvgColorMap(input);
  const sortedEntries = Object.entries(normalized).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return JSON.stringify(sortedEntries);
}

export function extractSvgPaletteFromText(svgText: string) {
  const source = asString(svgText);
  if (!source) return [];
  const doc = ensureParsedSvgDocument(source);
  return readSvgColors(doc);
}

export async function extractSvgPaletteFromSource(source: string) {
  if (!isSvgSource(source)) return [];
  const svgText = await getSvgTextCached(source);
  return extractSvgPaletteFromText(svgText);
}

function applySvgColorMapToDocument(doc: Document, colorMap: Record<string, string>) {
  const nodes = doc.querySelectorAll("*");

  nodes.forEach((node) => {
    COLOR_ATTRIBUTES.forEach((attribute) => {
      const current = node.getAttribute(attribute);
      const normalized = normalizeHexColor(current || "");
      if (!normalized) return;
      const replacement = colorMap[normalized];
      if (!replacement) return;
      node.setAttribute(attribute, replacement);
    });

    const styleToken = node.getAttribute("style");
    if (!styleToken) return;
    const declarations = parseInlineStyle(styleToken);
    if (declarations.length === 0) return;

    let changed = false;
    const nextDeclarations = declarations.map((declaration) => {
      if (!STYLE_COLOR_PROPERTIES.has(declaration.property)) return declaration;
      const normalized = normalizeHexColor(declaration.value);
      if (!normalized) return declaration;
      const replacement = colorMap[normalized];
      if (!replacement) return declaration;
      changed = true;
      return {
        ...declaration,
        value: replacement,
      };
    });

    if (changed) {
      node.setAttribute("style", buildInlineStyle(nextDeclarations));
    }
  });
}

export function recolorSvgText(svgText: string, colorMapInput: unknown) {
  const normalizedColorMap = normalizeSvgColorMap(colorMapInput);
  if (Object.keys(normalizedColorMap).length === 0) {
    return asString(svgText);
  }

  const doc = ensureParsedSvgDocument(svgText);
  applySvgColorMapToDocument(doc, normalizedColorMap);

  const root = doc.documentElement;
  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", SVG_XMLNS);
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(root);
}

export async function recolorSvgSourceToDataUrl(source: string, colorMapInput: unknown) {
  if (!isSvgSource(source)) return asString(source);

  const normalizedColorMap = normalizeSvgColorMap(colorMapInput);
  if (Object.keys(normalizedColorMap).length === 0) return asString(source);

  const mapKey = serializeSvgColorMap(normalizedColorMap);
  const cacheKey = `${asString(source)}::${mapKey}`;

  if (!svgRecolorCache.has(cacheKey)) {
    svgRecolorCache.set(
      cacheKey,
      (async () => {
        const svgText = await getSvgTextCached(source);
        const recolored = recolorSvgText(svgText, normalizedColorMap);
        return serializeSvgTextToDataUrl(recolored);
      })()
    );
  }

  return svgRecolorCache.get(cacheKey) as Promise<string>;
}
