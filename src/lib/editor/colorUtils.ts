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

let colorContext: CanvasRenderingContext2D | null = null;

function getColorContext() {
  if (colorContext) return colorContext;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  colorContext = canvas.getContext("2d");
  return colorContext;
}

const IGNORED_COLOR_TOKENS = new Set([
  "",
  "none",
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
]);

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
