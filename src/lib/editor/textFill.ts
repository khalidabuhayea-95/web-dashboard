/**
 * A TEXT layer's glyph fill when it is not a flat colour: a gradient painted through the letters.
 *
 * The model is the mobile app's `TextLayer.fill` (`TextFill.Gradient` embedding a
 * `Background.Gradient`), so a template paints the same on both sides:
 *   - `angle` in degrees, 0 runs left → right and 90 top → bottom;
 *   - the ramp spans the text BOX: from the box centre, out along the angle to the farthest corner
 *     either way — the geometry of the app's `resolveLinearGradientEndpoints` (and of CSS);
 *   - radial ramps run from the box centre out to half its diagonal (`resolveRadialGradientRadius`);
 *   - stop positions are 0..1 along that ramp; colours outside the first/last stop clamp.
 * The layer's flat `color` stays the fallback for every renderer that cannot texture glyphs (the
 * per-letter animation path, the inline editor, older app builds).
 *
 * Canva imports arrive here: Canva paints gradient text as an SVG gradient clipped to the glyphs,
 * which the extension re-expresses on the text box (canva-scraper.js, canva-text-gradient block).
 */

export type TextFillStop = {
  /** `#rrggbb`. */
  color: string;
  /** 0..1; 1 when absent. */
  opacity?: number;
  /** 0..1 along the ramp. */
  position: number;
};

export type TextGradientFill = {
  type: "gradient";
  gradientKind: "linear" | "radial";
  angle: number;
  stops: TextFillStop[];
};

export type TextFill = TextGradientFill;

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeStopColor(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (HEX6.test(raw)) return raw.toLowerCase();
  if (HEX3.test(raw)) {
    return `#${raw
      .slice(1)
      .split("")
      .map((digit) => digit + digit)
      .join("")}`.toLowerCase();
  }
  return "";
}

/** A usable fill, or undefined for anything else (absent, malformed, fewer than two stops). */
export function normalizeTextFill(raw: unknown): TextFill | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if (record.type !== "gradient") return undefined;
  const stops = (Array.isArray(record.stops) ? record.stops : [])
    .map((stop): TextFillStop | null => {
      const item = stop && typeof stop === "object" ? (stop as Record<string, unknown>) : {};
      const color = normalizeStopColor(item.color);
      const position = Number(item.position);
      if (!color || !Number.isFinite(position)) return null;
      const opacity = Number(item.opacity);
      return {
        color,
        position: clamp01(position),
        ...(Number.isFinite(opacity) && opacity < 1 ? { opacity: clamp01(opacity) } : {}),
      };
    })
    .filter((stop): stop is TextFillStop => stop !== null)
    .sort((a, b) => a.position - b.position);
  if (stops.length < 2) return undefined;
  const angle = Number(record.angle);
  return {
    type: "gradient",
    gradientKind: record.gradientKind === "radial" ? "radial" : "linear",
    angle: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0,
    stops,
  };
}

/** The app's `resolveLinearGradientEndpoints`, in the text box's own coordinates. */
export function resolveLinearGradientEndpoints(width: number, height: number, angleDegrees: number) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const radians = ((angleDegrees % 360) * Math.PI) / 180;
  const directionX = Math.cos(radians);
  const directionY = Math.sin(radians);
  const halfProjection = Math.abs(directionX) * (safeWidth / 2) + Math.abs(directionY) * (safeHeight / 2);
  return {
    startX: safeWidth / 2 - directionX * halfProjection,
    startY: safeHeight / 2 - directionY * halfProjection,
    endX: safeWidth / 2 + directionX * halfProjection,
    endY: safeHeight / 2 + directionY * halfProjection,
  };
}

/** The app's `resolveRadialGradientRadius`: half the box diagonal. */
export function resolveRadialGradientRadius(width: number, height: number) {
  return Math.hypot(Math.max(1, width), Math.max(1, height)) / 2;
}

function cssStopColor(stop: TextFillStop) {
  if (stop.opacity === undefined || stop.opacity >= 1) return stop.color;
  const r = parseInt(stop.color.slice(1, 3), 16);
  const g = parseInt(stop.color.slice(3, 5), 16);
  const b = parseInt(stop.color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(stop.opacity * 1000) / 1000})`;
}

/**
 * Konva fill props painting `fill` over a `width` × `height` text box. `offsetX/Y` move the ramp
 * into a child node's coordinates (a per-word <Text> sitting at `offsetX` inside the box), so the
 * words share the one ramp instead of each restarting it. Empty for no fill.
 */
export function textFillKonvaProps(
  fill: unknown,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0
): Record<string, unknown> {
  const gradient = normalizeTextFill(fill);
  if (!gradient) return {};
  const colorStops = gradient.stops.flatMap((stop) => [stop.position, cssStopColor(stop)]);
  if (gradient.gradientKind === "radial") {
    const center = { x: Math.max(1, width) / 2 - offsetX, y: Math.max(1, height) / 2 - offsetY };
    return {
      fillPriority: "radial-gradient",
      fillRadialGradientStartPoint: center,
      fillRadialGradientEndPoint: center,
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: resolveRadialGradientRadius(width, height),
      fillRadialGradientColorStops: colorStops,
    };
  }
  const ends = resolveLinearGradientEndpoints(width, height, gradient.angle);
  return {
    fillPriority: "linear-gradient",
    fillLinearGradientStartPoint: { x: ends.startX - offsetX, y: ends.startY - offsetY },
    fillLinearGradientEndPoint: { x: ends.endX - offsetX, y: ends.endY - offsetY },
    fillLinearGradientColorStops: colorStops,
  };
}

/**
 * A CSS `background` for a swatch showing the fill (the toolbar's colour button), or "" for none.
 * CSS measures linear angles from "to top"; ours start at "to right", hence the +90.
 */
export function textFillCssBackground(fill: unknown): string {
  const gradient = normalizeTextFill(fill);
  if (!gradient) return "";
  const stops = gradient.stops
    .map((stop) => `${cssStopColor(stop)} ${Math.round(stop.position * 10000) / 100}%`)
    .join(", ");
  return gradient.gradientKind === "radial"
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${Math.round((gradient.angle + 90) * 1000) / 1000}deg, ${stops})`;
}

function argbHex(stop: TextFillStop) {
  const rgb = stop.color.slice(1).toUpperCase();
  if (stop.opacity === undefined || stop.opacity >= 1) return `#${rgb}`;
  const alpha = Math.round(clamp01(stop.opacity) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `#${alpha}${rgb}`;
}

/**
 * The mobile payload's `fill` for a TEXT layer — the app's `Background.Gradient` fields under
 * `type: "gradient"`. Colours are `#RRGGBB`, or `#AARRGGBB` when a stop is translucent (the app's
 * hex convention). Null for no fill, so the field is simply left out.
 */
export function textFillToMobilePayload(fill: unknown) {
  const gradient = normalizeTextFill(fill);
  if (!gradient) return null;
  const stops = gradient.stops.map((stop) => ({ colorHex: argbHex(stop), position: stop.position }));
  return {
    type: "gradient" as const,
    gradientKind: gradient.gradientKind,
    angle: Math.round(gradient.angle * 1000) / 1000,
    startColorHex: stops[0].colorHex,
    endColorHex: stops[stops.length - 1].colorHex,
    stops,
  };
}
