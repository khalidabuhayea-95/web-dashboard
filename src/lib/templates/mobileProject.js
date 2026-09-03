import { performance } from "node:perf_hooks";

import { appendVersionParam } from "@/lib/storage/objectStorage.server";
import { extractEditorPagesData, extractFabricData } from "@/lib/templates/editorData";
import { resolveEditorTextFontName } from "@/lib/templates/mobileCompatibility";
import {
  DEFAULT_ANIMATION_DURATION_MS,
  DEFAULT_PAGE_DURATION_MS,
  isAnimationInfiniteActive,
} from "@/lib/editor/animationTimeline";
import { resolveElementAnimations } from "@/lib/editor/animationSlots";
import {
  getAnimationDefaults,
  normalizeSpecAnimationType,
  normalizeSpecDirection,
  normalizeSpecEasing,
} from "@/lib/editor/animationSpec";
import { recolorSvgSource } from "@/lib/editor/imagePalette";
import {
  getShapeRasterFrame,
  isRasterizableShapeLayer,
  renderShapeLayerToDataUrl,
} from "@/lib/templates/shapeRaster";

function numberOr(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundTiming(value) {
  return Math.round(value * 100) / 100;
}

function addTiming(telemetry, key, duration) {
  if (!telemetry || typeof telemetry !== "object" || !key) return;
  const currentValue = Number(telemetry[key]) || 0;
  telemetry[key] = roundTiming(currentValue + duration);
}

function incrementCount(telemetry, key, amount = 1) {
  if (!telemetry || typeof telemetry !== "object" || !key) return;
  const currentValue = Number(telemetry[key]) || 0;
  telemetry[key] = currentValue + amount;
}

function resolveLayerTelemetryPrefix(layer) {
  const normalizedType = String(layer?.type || "").trim().toUpperCase();
  switch (normalizedType) {
    case "TEXT":
      return "text";
    case "FRAME":
      return "frame";
    case "IMAGE":
      return "image";
    case "VIDEO_CLIP":
      return "video";
    case "SHAPE":
      return "shape";
    case "STICKER":
      return "sticker";
    default:
      return "other";
  }
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstDefined(values) {
  for (const value of values) {
    if (typeof value === "undefined" || value === null) continue;
    return value;
  }
  return undefined;
}

function resolveOptionalBoolean(values) {
  const match = firstDefined(values);
  if (typeof match === "undefined") return undefined;
  return parseBoolean(match, false);
}

function resolveBoldFromWeight(value) {
  if (typeof value === "undefined" || value === null) return undefined;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return undefined;
  const numeric = Number.parseInt(raw.replace(/[^\d]/g, ""), 10);
  if (Number.isFinite(numeric)) return numeric >= 600;
  if (raw.includes("bold")) return true;
  if (["normal", "regular", "book", "roman", "light", "thin", "medium"].some((token) => raw.includes(token))) {
    return false;
  }
  return undefined;
}

function resolveItalicFromStyle(value) {
  if (typeof value === "undefined" || value === null) return undefined;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return undefined;
  if (raw.includes("italic") || raw.includes("oblique")) return true;
  if (["normal", "regular", "roman", "book", "upright"].some((token) => raw.includes(token))) return false;
  return undefined;
}

function parseTextDecoration(value) {
  if (typeof value === "undefined" || value === null) return undefined;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return undefined;
  const underline = raw.includes("underline");
  const strikethrough =
    raw.includes("line-through") ||
    raw.includes("linethrough") ||
    raw.includes("strikethrough") ||
    raw.includes("strike-through");
  if (!underline && !strikethrough) return undefined;
  return { underline, strikethrough };
}

function normalizeTextCase(value) {
  if (typeof value === "undefined" || value === null) return undefined;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || ["none", "normal", "original", "default", "keep"].includes(raw)) return "ORIGINAL";
  if (
    raw === "uppercase" ||
    raw === "upper" ||
    raw === "allcaps" ||
    raw === "all_caps" ||
    raw.includes("upper")
  ) {
    return "UPPERCASE";
  }
  if (raw === "lowercase" || raw === "lower" || raw.includes("lower")) return "LOWERCASE";
  return "ORIGINAL";
}

function resolveTextFormat(item) {
  const format = asObject(item?.format);
  const textStyle = asObject(item?.textStyle) || asObject(item?.text_style);
  const style = asObject(item?.style);

  const explicitBold = resolveOptionalBoolean([
    item?.bold,
    item?.isBold,
    item?.is_bold,
    format?.bold,
    format?.isBold,
    format?.is_bold,
    textStyle?.bold,
    textStyle?.isBold,
    textStyle?.is_bold,
    style?.bold,
    style?.isBold,
    style?.is_bold,
  ]);
  const boldFromWeight = resolveBoldFromWeight(
    firstDefined([
      item?.fontWeight,
      item?.font_weight,
      format?.fontWeight,
      format?.font_weight,
      textStyle?.fontWeight,
      textStyle?.font_weight,
      style?.fontWeight,
      style?.font_weight,
    ])
  );

  const explicitItalic = resolveOptionalBoolean([
    item?.italic,
    item?.isItalic,
    item?.is_italic,
    format?.italic,
    format?.isItalic,
    format?.is_italic,
    textStyle?.italic,
    textStyle?.isItalic,
    textStyle?.is_italic,
    style?.italic,
    style?.isItalic,
    style?.is_italic,
  ]);
  const italicFromStyle = resolveItalicFromStyle(
    firstDefined([
      item?.fontStyle,
      item?.font_style,
      format?.fontStyle,
      format?.font_style,
      textStyle?.fontStyle,
      textStyle?.font_style,
      style?.fontStyle,
      style?.font_style,
    ])
  );

  const decoration = parseTextDecoration(
    firstDefined([
      item?.textDecoration,
      item?.text_decoration,
      format?.textDecoration,
      format?.text_decoration,
      textStyle?.textDecoration,
      textStyle?.text_decoration,
      style?.textDecoration,
      style?.text_decoration,
    ])
  );

  const explicitUnderline = resolveOptionalBoolean([
    item?.underline,
    item?.isUnderline,
    item?.is_underline,
    format?.underline,
    format?.isUnderline,
    format?.is_underline,
    textStyle?.underline,
    textStyle?.isUnderline,
    textStyle?.is_underline,
    style?.underline,
    style?.isUnderline,
    style?.is_underline,
  ]);
  const explicitStrikethrough = resolveOptionalBoolean([
    item?.strikethrough,
    item?.lineThrough,
    item?.linethrough,
    item?.isStrikethrough,
    item?.is_strikethrough,
    format?.strikethrough,
    format?.lineThrough,
    format?.linethrough,
    format?.isStrikethrough,
    format?.is_strikethrough,
    textStyle?.strikethrough,
    textStyle?.lineThrough,
    textStyle?.linethrough,
    textStyle?.isStrikethrough,
    textStyle?.is_strikethrough,
    style?.strikethrough,
    style?.lineThrough,
    style?.linethrough,
    style?.isStrikethrough,
    style?.is_strikethrough,
  ]);

  const textCase = normalizeTextCase(
    firstDefined([
      item?.textCase,
      item?.text_case,
      item?.textTransform,
      item?.text_transform,
      format?.textCase,
      format?.text_case,
      format?.textTransform,
      format?.text_transform,
      textStyle?.textCase,
      textStyle?.text_case,
      textStyle?.textTransform,
      textStyle?.text_transform,
      style?.textCase,
      style?.text_case,
      style?.textTransform,
      style?.text_transform,
    ])
  );

  return {
    bold: explicitBold ?? boldFromWeight ?? false,
    italic: explicitItalic ?? italicFromStyle ?? false,
    underline: explicitUnderline ?? decoration?.underline ?? false,
    strikethrough: explicitStrikethrough ?? decoration?.strikethrough ?? false,
    textCase: textCase || "ORIGINAL",
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isDataUri(value) {
  return /^data:[^,]+,/i.test(String(value || "").trim());
}

function resolveClientMediaUri(value, options) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (typeof options?.mediaUrlResolver !== "function") return source;
  const resolved = String(options.mediaUrlResolver(source) || "").trim();
  return resolved || source;
}

function resolveMediaUri(rawUri, options) {
  const value = String(rawUri || "").trim();
  if (!value) return "";
  if (!isDataUri(value)) return resolveClientMediaUri(value, options);
  if (typeof options?.assetResolver !== "function") return value;
  const resolved = String(
    options.assetResolver({
      scope: options.scope || "layer",
      elementId: options.elementId || "",
      index: options.index ?? null,
      field: options.field || "",
    }) || ""
  ).trim();
  return resolved || value;
}

function appendQueryParam(url, key, value) {
  const target = String(url || "");
  if (!target || !value) return target;
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

// Stable short fingerprint of a raster color map, so a vector shape's ?field=vector URL (which is
// otherwise identical across recolors) changes when the recolor changes and the mobile image cache
// refetches the freshly-recolored SVG. Order-independent (entries are sorted).
function colorMapFingerprint(colorMap) {
  const serialized = Object.entries(colorMap || {})
    .map(([key, value]) => `${String(key).toLowerCase()}:${String(value).toLowerCase()}`)
    .sort()
    .join(",");
  let hash = 5381;
  for (let i = 0; i < serialized.length; i += 1) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeHex(value, fallback = "#000000") {
  const raw = String(value || "").trim();
  const rgba = raw.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (rgba) {
    const r = clamp(Math.round(numberOr(rgba[1], 0)), 0, 255);
    const g = clamp(Math.round(numberOr(rgba[2], 0)), 0, 255);
    const b = clamp(Math.round(numberOr(rgba[3], 0)), 0, 255);
    return `#${[r, g, b]
      .map((item) => item.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  }
  const full = /^#([0-9a-f]{6})$/i;
  const short = /^#([0-9a-f]{3})$/i;
  if (full.test(raw)) return raw.toUpperCase();
  if (short.test(raw)) {
    const [, hex] = raw.match(short);
    return `#${hex
      .split("")
      .map((it) => `${it}${it}`)
      .join("")}`.toUpperCase();
  }
  return fallback;
}

function rgbaToHexWithOpacity(value, fallbackHex = "#000000") {
  const input = String(value || "").trim();
  if (!input) return { hex: fallbackHex, opacity: 1 };
  if (input.startsWith("#")) return { hex: normalizeHex(input, fallbackHex), opacity: 1 };
  const rgba = input.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (!rgba) return { hex: fallbackHex, opacity: 1 };
  const r = clamp(Math.round(numberOr(rgba[1], 0)), 0, 255);
  const g = clamp(Math.round(numberOr(rgba[2], 0)), 0, 255);
  const b = clamp(Math.round(numberOr(rgba[3], 0)), 0, 255);
  const a = clamp(numberOr(rgba[4], 1), 0, 1);
  const hex = `#${[r, g, b]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
  return { hex, opacity: a };
}

function mapBlendMode(value) {
  const mapping = {
    "source-over": "NORMAL",
    multiply: "MULTIPLY",
    screen: "SCREEN",
    overlay: "OVERLAY",
    darken: "DARKEN",
    lighten: "LIGHTEN",
    "color-dodge": "COLOR_DODGE",
    "color-burn": "COLOR_BURN",
    "soft-light": "SOFT_LIGHT",
    "hard-light": "HARD_LIGHT",
    difference: "DIFFERENCE",
    exclusion: "EXCLUSION",
    add: "ADD",
    subtract: "SUBTRACT",
  };
  return mapping[String(value || "").toLowerCase()] || "NORMAL";
}

/**
 * Fabric's `textAlign` is ABSOLUTE — `left` is the left edge whatever the script — so it must map
 * to the app's absolute LEFT/RIGHT, never to START/END.
 *
 * START/END are LOGICAL on the app side: they resolve against the text's own direction, so START
 * lands flush-RIGHT on Arabic. Mapping `left`->START therefore mirrored every Arabic template —
 * a heading the dashboard shows flush-right rendered flush-left in the app, and the app's
 * alignment row highlighted the opposite button. The fallback is `left` for the same reason:
 * that is what fabric (and normalizeTextAlign in the editor) treats a missing value as.
 */
function mapTextAlignment(value) {
  const mapping = {
    left: "LEFT",
    center: "CENTER",
    right: "RIGHT",
    justify: "JUSTIFY",
  };
  return mapping[String(value || "").toLowerCase()] || "LEFT";
}

function mapMediaShape(value) {
  const mapping = {
    rectangle: "RECTANGLE",
    rounded: "ROUNDED",
    circle: "CIRCLE",
  };
  return mapping[String(value || "").toLowerCase()] || "RECTANGLE";
}

function mapAnimationType(value) {
  const allowed = new Set([
    "NONE",
    "FADE",
    "WIPE",
    "WIPE_GRADIENT",
    "SLIDE",
    "ZOOM",
    "ZOOM_FADE",
    "CIRCULAR",
    "CIRCULAR_FADE",
    "RADIAL",
    "FLOAT",
    "PULSE",
    "SPIN",
  ]);
  const next = String(value || "NONE").toUpperCase();
  return allowed.has(next) ? next : "NONE";
}

function mapAnimationMode(value) {
  const allowed = new Set(["IN", "OUT", "LOOP"]);
  const next = String(value || "LOOP").toUpperCase();
  return allowed.has(next) ? next : "LOOP";
}

function mapLayerAnimationType(value) {
  const allowed = new Set([
    "NONE",
    "RISE",
    "PAN",
    "FADE",
    "POP",
    "WIPE",
    "BLUR",
    "SUCCESSION",
    "BREATHE",
    "BASELINE",
    "DRIFT",
    "TECTONIC",
    "TUMBLE",
    "NEON",
    "SCRAPBOOK",
    "STOMP",
    "ROTATE",
    "FLICKER",
    "PULSE",
    "WIGGLE",
  ]);
  const next = String(value || "NONE").toUpperCase();
  return allowed.has(next) ? next : "NONE";
}

// Legacy direction vocabulary. The spec calls the neutral value DEFAULT; the legacy object has
// always called the same thing CENTER, so it maps across cleanly.
function mapLayerAnimationDirection(value) {
  const allowed = new Set(["LEFT", "RIGHT", "UP", "DOWN", "CENTER", "CLOCKWISE", "COUNTERCLOCKWISE"]);
  const next = String(value || "CENTER").toUpperCase();
  if (next === "DEFAULT") return "CENTER";
  return allowed.has(next) ? next : "CENTER";
}

// Legacy easing vocabulary — narrower than the spec's. DEFAULT and EASE_IN have no legacy
// equivalent, so both degrade to LINEAR: an old build showing an un-eased curve is honest,
// whereas the old catch-all (SOFT_OUT) would turn an accelerating curve into a decelerating one.
function mapLayerAnimationEasing(value) {
  const allowed = new Set(["LINEAR", "EASE_OUT", "EASE_IN_OUT", "SOFT_OUT", "SOFT_IN_OUT"]);
  const next = String(value || "SOFT_OUT").toUpperCase();
  if (next === "DEFAULT" || next === "EASE_IN") return "LINEAR";
  return allowed.has(next) ? next : "SOFT_OUT";
}

function mapLayerTimelineWindow(item) {
  const startMs = Math.max(0, Math.round(numberOr(item?.timelineStartMs, 0)));
  const rawEndMs = Math.round(numberOr(item?.timelineEndMs, DEFAULT_PAGE_DURATION_MS));
  const endMs = Math.max(startMs, rawEndMs);
  return { startMs, endMs };
}

/**
 * The LEGACY single-animation object, for app builds without three-slot support.
 *
 * Reads the element's legacy fields when it has them. When a layer was authored purely in the
 * three-slot model those fields are NONE, so we back-fill from the slots — otherwise an older
 * build would receive `type: "NONE"` and render the layer completely static. Only one slot fits
 * the legacy shape: entrance wins (it's the reveal, and it's what the legacy model encoded),
 * then loop, then exit. `mapLayerAnimationType` still narrows to the 20 types old builds know,
 * so a new-only effect degrades to NONE there rather than to something wrong.
 */
function mapLayerAnimation(item, slots) {
  const legacyType = mapLayerAnimationType(item?.mediaAnimationType);
  if (legacyType !== "NONE") {
    return {
      type: legacyType,
      infinite: isAnimationInfiniteActive(
        item?.mediaAnimationType,
        item?.mediaAnimationInfinite,
        item?.mediaAnimationMode
      ),
      durationMs: Math.max(0, Math.round(numberOr(item?.mediaAnimationDurationMs, DEFAULT_ANIMATION_DURATION_MS))),
      delayMs: Math.max(0, Math.round(numberOr(item?.mediaAnimationDelayMs, 0))),
      direction: mapLayerAnimationDirection(item?.mediaAnimationDirection),
      easing: mapLayerAnimationEasing(item?.mediaAnimationEasing),
      intensity: clamp(numberOr(item?.mediaAnimationIntensity, 1), 0, 2),
    };
  }

  const fallback = slots?.entrance || slots?.loop || slots?.exit || null;
  const isLoop = Boolean(fallback && fallback === slots?.loop);
  return {
    type: mapLayerAnimationType(fallback?.type),
    infinite: isLoop && Boolean(fallback?.infinite),
    durationMs: Math.max(0, Math.round(numberOr(fallback?.durationMs, DEFAULT_ANIMATION_DURATION_MS))),
    delayMs: Math.max(0, Math.round(numberOr(fallback?.delayMs, 0))),
    direction: mapLayerAnimationDirection(fallback?.direction),
    easing: mapLayerAnimationEasing(fallback?.easing),
    intensity: clamp(numberOr(fallback?.intensity, 1), 0, 2),
  };
}

function mapAnimationSlotSpec(spec, category) {
  if (!spec || typeof spec !== "object") return null;
  const type = normalizeSpecAnimationType(spec.type);
  if (type === "NONE") return null;
  const defaults = getAnimationDefaults(type);
  return {
    type,
    infinite: category === "LOOP" ? Boolean(spec.infinite) && defaults.supportsInfinite : false,
    durationMs: Math.max(1, Math.round(numberOr(spec.durationMs, defaults.durationMs))),
    delayMs: Math.max(0, Math.round(numberOr(spec.delayMs, defaults.delayMs))),
    direction: normalizeSpecDirection(spec.direction ?? defaults.direction),
    easing: normalizeSpecEasing(spec.easing ?? defaults.easing),
    intensity: clamp(numberOr(spec.intensity, defaults.intensity), 0, 2),
  };
}

/**
 * The three-slot `animations` object. Emitted ALONGSIDE the legacy single `animation` above,
 * never instead of it: the app prefers `animations` when non-empty and falls back to `animation`,
 * so builds without three-slot support keep rendering. Slots are resolved from the element's own
 * `animations` when present, otherwise migrated from its legacy fields.
 */
function mapLayerAnimations(slots) {
  const entrance = mapAnimationSlotSpec(slots.entrance, "ENTRANCE");
  const exit = mapAnimationSlotSpec(slots.exit, "EXIT");
  const loop = mapAnimationSlotSpec(slots.loop, "LOOP");
  if (!entrance && !exit && !loop) return null;
  return {
    ...(entrance ? { entrance } : {}),
    ...(exit ? { exit } : {}),
    ...(loop ? { loop } : {}),
  };
}

function mapTemplateCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["business", "corporate", "work"].includes(normalized)) return "BUSINESS";
  if (["education", "school", "course"].includes(normalized)) return "EDUCATION";
  if (["ramadan"].includes(normalized)) return "RAMADAN";
  if (["events", "event"].includes(normalized)) return "EVENTS";
  return "SOCIAL";
}

const MIN_MEDIA_VISUAL_SCALE = 0.01;
const MAX_MEDIA_VISUAL_SCALE = 16;
const MEDIA_LAYER_BASE_MAX_EDGE_DP = 1080;
const MEDIA_LAYER_BASE_MIN_EDGE_DP = 120;
const MIN_MEDIA_CROP_SIZE = 0.05;
// Matches the mobile TextLayer.wrapWidth guard (finite, > 0). The cap is a sanity bound on
// corrupt authoring data, well above any real canvas width.
const TEXT_WRAP_WIDTH_MAX_DP = 8192;

function readShadow(item) {
  if (item?.shadow && typeof item.shadow === "object") {
    return item.shadow;
  }
  return {
    color: item?.shadowColor,
    blur: item?.shadowBlur,
    offsetX: item?.shadowOffsetX,
    offsetY: item?.shadowOffsetY,
  };
}

/**
 * A shadow is visible only when it is blurred or offset away from the layer, and not fully
 * transparent — a 0-radius, 0-offset shadow sits exactly behind its layer and draws nothing.
 */
function isShadowVisible(shadow, opacity) {
  if (numberOr(opacity, 1) <= 0) return false;
  return (
    numberOr(shadow?.blur, 0) > 0 ||
    numberOr(shadow?.offsetX, 0) !== 0 ||
    numberOr(shadow?.offsetY, 0) !== 0
  );
}

function readTextAlignment(item) {
  return item?.textAlign || item?.align;
}

function readLetterSpacing(item) {
  if (typeof item?.charSpacing !== "undefined") return item.charSpacing;
  return item?.letterSpacing;
}

function readBlendMode(item) {
  return item?.mediaBlendMode || item?.blendMode;
}

function readCornerRadiusRatio(item) {
  if (typeof item?.mediaCornerRadius !== "undefined") {
    return numberOr(item.mediaCornerRadius, 0.1);
  }
  const radius = Math.max(0, numberOr(item?.cornerRadius, 0));
  // Rendered edge = base size × |scale| (editor elements carry ±1 scales; raw fabric
  // objects carry natural bitmap sizes with real scales — radius is display px in both).
  const renderedWidth = numberOr(item?.width, 1) * Math.abs(numberOr(item?.scaleX, 1));
  const renderedHeight = numberOr(item?.height, 1) * Math.abs(numberOr(item?.scaleY, 1));
  const minEdge = Math.max(1, Math.min(renderedWidth, renderedHeight));
  return radius / minEdge;
}

function readVideoDurationMs(item) {
  if (typeof item?.videoDurationSec !== "undefined") {
    return Math.max(Math.round(numberOr(item.videoDurationSec, 0) * 1000), 0);
  }
  return Math.max(Math.round(numberOr(item?.videoDuration, 0) * 1000), 0);
}

function readVideoTrimStartMs(item) {
  if (typeof item?.videoTrimStartMs !== "undefined") {
    return Math.max(Math.round(numberOr(item.videoTrimStartMs, 0)), 0);
  }
  return Math.max(Math.round(numberOr(item?.videoStart, 0) * 1000), 0);
}

function readVideoTrimEndMs(item, durationMs, trimStartMs) {
  const fallbackEndMs = durationMs > 0
    ? durationMs
    : Math.max(trimStartMs, Math.round(numberOr(item?.videoEnd, 3) * 1000));
  if (typeof item?.videoTrimEndMs !== "undefined") {
    return clamp(
      Math.round(numberOr(item.videoTrimEndMs, fallbackEndMs)),
      trimStartMs,
      Math.max(fallbackEndMs, trimStartMs)
    );
  }
  return clamp(
    Math.round(numberOr(item?.videoEnd, fallbackEndMs / 1000) * 1000),
    trimStartMs,
    Math.max(fallbackEndMs, trimStartMs)
  );
}

function computeMobileMediaBaseSize(sourceWidth, sourceHeight) {
  const width = Math.max(numberOr(sourceWidth, 1), 1);
  const height = Math.max(numberOr(sourceHeight, 1), 1);
  const aspect = width / height;
  if (aspect >= 1) {
    return {
      width: MEDIA_LAYER_BASE_MAX_EDGE_DP,
      height: clamp(
        MEDIA_LAYER_BASE_MAX_EDGE_DP / aspect,
        MEDIA_LAYER_BASE_MIN_EDGE_DP,
        MEDIA_LAYER_BASE_MAX_EDGE_DP
      ),
    };
  }
  return {
    width: clamp(
      MEDIA_LAYER_BASE_MAX_EDGE_DP * aspect,
      MEDIA_LAYER_BASE_MIN_EDGE_DP,
      MEDIA_LAYER_BASE_MAX_EDGE_DP
    ),
    height: MEDIA_LAYER_BASE_MAX_EDGE_DP,
  };
}

function centerFromFabricItem(item) {
  const width = Math.max(numberOr(item.width, 1), 1);
  const height = Math.max(numberOr(item.height, 1), 1);
  const rawScaleX = numberOr(item.scaleX, 1);
  const rawScaleY = numberOr(item.scaleY, 1);
  const rotationDegrees = numberOr(item.angle, numberOr(item.rotation, 0));
  const rotationRadians = (rotationDegrees * Math.PI) / 180;
  const cosR = Math.cos(rotationRadians);
  const sinR = Math.sin(rotationRadians);

  const originX = String(item.originX || "left").toLowerCase();
  const originY = String(item.originY || "top").toLowerCase();
  const originLocalX = originX === "center" ? width / 2 : originX === "right" ? width : 0;
  const originLocalY = originY === "center" ? height / 2 : originY === "bottom" ? height : 0;
  const deltaLocalX = (width / 2) - originLocalX;
  const deltaLocalY = (height / 2) - originLocalY;
  const deltaScaledX = deltaLocalX * rawScaleX;
  const deltaScaledY = deltaLocalY * rawScaleY;
  const deltaRotatedX = (deltaScaledX * cosR) - (deltaScaledY * sinR);
  const deltaRotatedY = (deltaScaledX * sinR) + (deltaScaledY * cosR);

  const left = numberOr(item.left, numberOr(item.x, 0));
  const top = numberOr(item.top, numberOr(item.y, 0));
  const centerX = left + deltaRotatedX;
  const centerY = top + deltaRotatedY;

  return {
    centerX,
    centerY,
    rawScaleX,
    rawScaleY,
  };
}

function buildTransform({
  item,
  canvasSize,
  centerX,
  centerY,
  rawScaleX,
  rawScaleY,
  baseWidth,
  baseHeight,
  scaleBounds = { min: 0.1, max: 16 },
}) {
  const signX = rawScaleX < 0 ? -1 : 1;
  const signY = rawScaleY < 0 ? -1 : 1;
  const displayWidth = Math.max(Math.abs(rawScaleX) * Math.max(numberOr(item.width, 1), 1), 1);
  const displayHeight = Math.max(Math.abs(rawScaleY) * Math.max(numberOr(item.height, 1), 1), 1);

  const effectiveScaleX = clamp(displayWidth / Math.max(baseWidth, 1), scaleBounds.min, scaleBounds.max);
  const effectiveScaleY = clamp(displayHeight / Math.max(baseHeight, 1), scaleBounds.min, scaleBounds.max);
  const scaleMagnitude = clamp(
    Math.sqrt(Math.max(effectiveScaleX * effectiveScaleY, 0.0001)),
    scaleBounds.min,
    scaleBounds.max
  );

  return {
    x: clamp(centerX, -canvasSize.width * 4, canvasSize.width * 4),
    y: clamp(centerY, -canvasSize.height * 4, canvasSize.height * 4),
    scale: scaleMagnitude,
    scaleX: signX * clamp(effectiveScaleX / Math.max(scaleMagnitude, 0.0001), 0.1, 16),
    scaleY: signY * clamp(effectiveScaleY / Math.max(scaleMagnitude, 0.0001), 0.1, 16),
    rotation: numberOr(item.angle, numberOr(item.rotation, 0)),
    // Flip is authoritative on the SIGN of scaleX/scaleY (a negative scale means
    // mirrored). flipX/flipY restate that same sign as booleans for clients that
    // prefer a flag. Consumers must apply ONE representation, not both, or the
    // image double-flips. Invariant: flipX === (scaleX < 0).
    flipX: signX < 0,
    flipY: signY < 0,
  };
}

function baseLayer(item, index, canvasSize) {
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  const baseWidth = Math.max(numberOr(item.width, 1), 1);
  const baseHeight = Math.max(numberOr(item.height, 1), 1);
  const timelineWindow = mapLayerTimelineWindow(item);
  const slots = resolveElementAnimations(item || {});
  const animations = mapLayerAnimations(slots);

  return {
    ...(animations ? { animations } : {}),
    id: String(item.id || item.layerId || `layer-${index + 1}`),
    transform: buildTransform({
      item,
      canvasSize,
      centerX,
      centerY,
      rawScaleX,
      rawScaleY,
      baseWidth,
      baseHeight,
    }),
    opacity: clamp(numberOr(item.opacity, 1), 0, 1),
    locked: parseBoolean(item.layerLocked, false),
    hidden: parseBoolean(item.layerHidden, false),
    zIndex: index,
    timelineStartMs: timelineWindow.startMs,
    timelineEndMs: timelineWindow.endMs,
    animation: mapLayerAnimation(item, slots),
  };
}

// The editor's text box width, in project px — the width the editor word-wraps at.
// Emitted as the layer's `wrapWidth` so mobile reproduces the same line breaks.
// Null when the element has no usable width: mobile then keeps its legacy behavior of
// estimating a never-wrap box from the glyphs, which is the best guess available.
function textWrapWidthFromFabric(item) {
  const rawWidth = numberOr(item.width, 0);
  if (!(rawWidth > 0)) return null;
  const width = Math.abs(numberOr(item.scaleX, 1)) * rawWidth;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(clamp(width, 1, TEXT_WRAP_WIDTH_MAX_DP) * 100) / 100;
}

function textTransformFromFabric(item, canvasSize) {
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  const signX = rawScaleX < 0 ? -1 : 1;
  const signY = rawScaleY < 0 ? -1 : 1;

  return {
    x: clamp(centerX, -canvasSize.width * 4, canvasSize.width * 4),
    y: clamp(centerY, -canvasSize.height * 4, canvasSize.height * 4),
    // Text geometry is carried by `size` (glyph size) + `wrapWidth` (column width), both in
    // project px. scale/scaleX/scaleY therefore stay at unit magnitude and only carry the flip
    // sign — a text layer is never graphically stretched. This replaces an older encoding that
    // smuggled the box size in as scaleX = width / 250, scaleY = height / 110; that ratio was a
    // stretch factor no renderer could wrap at, so mobile fell back to its never-wrap estimate.
    scale: 1,
    scaleX: signX,
    scaleY: signY,
    rotation: numberOr(item.angle, numberOr(item.rotation, 0)),
    // See buildTransform: flipX/flipY mirror the sign of scaleX/scaleY. Apply one,
    // not both. Invariant: flipX === (scaleX < 0).
    flipX: signX < 0,
    flipY: signY < 0,
  };
}

function normalizeFontLookupKey(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/[_\s-]+/g, "")
    .toLowerCase();
}

function buildTextLayerFontPayload(fontName, fontLookup) {
  if (!(fontLookup instanceof Map)) return null;
  const matched = fontLookup.get(normalizeFontLookupKey(fontName));
  if (!matched) return null;

  return {
    id: matched?.id || null,
    fontName: fontName || null,
    displayName: matched?.displayName || fontName || null,
    downloadUrl: matched?.downloadUrl || null,
    mobileDownloadUrl: matched?.mobileDownloadUrl || null,
    mobileCompatible:
      typeof matched?.mobileCompatible === "boolean"
        ? matched.mobileCompatible
        : null,
  };
}

function mapTextLayer(item, index, canvasSize, options = {}) {
  const base = baseLayer(item, index, canvasSize);
  const strokeColor = rgbaToHexWithOpacity(item.stroke, "#000000");
  const shadow = readShadow(item);
  const shadowColor = rgbaToHexWithOpacity(shadow.color, "#000000");
  const textFormat = resolveTextFormat(item);
  const bgColor = normalizeHex(item.textBackgroundBaseColor || item.textBackgroundColor, "#000000");
  const bgOpacity = clamp(numberOr(item.textBackgroundOpacity, item.textBackgroundColor ? 1 : 0), 0, 1);
  const fontName = resolveEditorTextFontName(item);
  const font = buildTextLayerFontPayload(fontName, options?.fontLookup);
  const wrapWidth = textWrapWidthFromFabric(item);

  return {
    ...base,
    transform: textTransformFromFabric(item, canvasSize),
    type: "TEXT",
    text: String(item.text || ""),
    ...(typeof item.isRtl === "boolean" ? { isRtl: item.isRtl } : {}),
    fontName,
    size: numberOr(item.fontSize, 42),
    ...(wrapWidth !== null ? { wrapWidth } : {}),
    bold: textFormat.bold,
    italic: textFormat.italic,
    underline: textFormat.underline,
    strikethrough: textFormat.strikethrough,
    textCase: textFormat.textCase,
    colorHex: normalizeHex(item.color || item.fill, "#FFFFFF"),
    shadow: {
      // Enabled means ACTUALLY VISIBLE, not merely "has a colour": every element defaults to
      // shadowColor "#000000", so keying off the colour marked every text layer as shadowed.
      // A shadow shows only when it is offset or blurred, and not fully transparent.
      enabled: isShadowVisible(shadow, shadowColor.opacity),
      colorHex: shadowColor.hex,
      opacity: shadowColor.opacity,
      blurRadius: numberOr(shadow.blur, 0),
      offsetX: numberOr(shadow.offsetX, 0),
      offsetY: numberOr(shadow.offsetY, 0),
    },
    stroke: {
      enabled: numberOr(item.strokeWidth, 0) > 0,
      colorHex: strokeColor.hex,
      opacity: strokeColor.opacity,
      width: numberOr(item.strokeWidth, 0),
    },
    letterSpacing: numberOr(readLetterSpacing(item), 0),
    lineHeight: numberOr(item.lineHeight, 1.2),
    alignment: mapTextAlignment(readTextAlignment(item)),
    curveConfig: {
      enabled: false,
      arcDegrees: 0,
      radius: 200,
    },
    backgroundVisible: bgOpacity > 0,
    backgroundColorHex: bgColor,
    backgroundAngleSize: clamp(numberOr(item.textBackgroundAngleSize, 0), 0, 1),
    backgroundOpacity: bgOpacity,
    ...(font ? { font } : {}),
  };
}

function toPoints(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => ({
      x: clamp(numberOr(point?.x, 0), 0, 1),
      y: clamp(numberOr(point?.y, 0), 0, 1),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function mediaFilters(item, options = {}) {
  const stroke = rgbaToHexWithOpacity(item.stroke, "#FFFFFF");
  const shadow = readShadow(item);
  const shadowColor = rgbaToHexWithOpacity(shadow.color, "#000000");
  const includeStroke = options.includeStroke !== false;
  const includeShapeMask = options.includeShapeMask !== false;

  return {
    filterPresetId: item.mediaFilterPresetId ? String(item.mediaFilterPresetId) : null,
    brightness: clamp(1 + numberOr(item.mediaBrightness, 0), 0, 2),
    contrast: clamp(1 + numberOr(item.mediaContrast, 0), 0, 2),
    saturation: clamp(1 + numberOr(item.mediaSaturation, 0), 0, 2),
    blurRadius: clamp(numberOr(item.mediaBlur, 0), 0, 40),
    tintColorHex: normalizeHex(item.mediaTintColor, "#FFFFFF"),
    tintStrength: clamp(numberOr(item.mediaTintStrength, 0), 0, 1),
    blendMode: mapBlendMode(readBlendMode(item)),
    shape: includeShapeMask ? mapMediaShape(item.mediaShape) : "RECTANGLE",
    cornerRadius: includeShapeMask ? clamp(readCornerRadiusRatio(item), 0, 0.5) : 0,
    // Per-corner enable mask for `cornerRadius`. Omitted = round ALL corners (the default).
    // Disabled corners stay sharp; the single radius applies to the enabled ones.
    ...(includeShapeMask &&
    item.cornerRadiusCorners &&
    typeof item.cornerRadiusCorners === "object"
      ? {
          cornerRadiusCorners: {
            topLeft: item.cornerRadiusCorners.topLeft !== false,
            topRight: item.cornerRadiusCorners.topRight !== false,
            bottomRight: item.cornerRadiusCorners.bottomRight !== false,
            bottomLeft: item.cornerRadiusCorners.bottomLeft !== false,
          },
        }
      : {}),
    strokeColorHex: includeStroke ? stroke.hex : "#FFFFFF",
    strokeOpacity: includeStroke ? stroke.opacity : 0,
    strokeWidth: includeStroke ? clamp(numberOr(item.strokeWidth, 0), 0, 24) : 0,
    shadowColorHex: shadowColor.hex,
    shadowOpacity: shadowColor.opacity,
    shadowBlurRadius: clamp(numberOr(shadow.blur, 0), 0, 40),
    shadowOffsetX: clamp(numberOr(shadow.offsetX, 0), -80, 80),
    shadowOffsetY: clamp(numberOr(shadow.offsetY, 0), -80, 80),
    animationType: mapAnimationType(item.mediaAnimationType),
    animationMode: mapAnimationMode(item.mediaAnimationMode),
    animationStrength: clamp(numberOr(item.mediaAnimationStrength, 0), 0, 1),
    animationSpeed: clamp(numberOr(item.mediaAnimationSpeed, 1), 0.2, 3),
    eraserRadius: clamp(numberOr(item.mediaEraserRadius, 18), 2, 80),
    eraserSoftness: clamp(numberOr(item.mediaEraserSoftness, 0.5), 0, 1),
    eraserPoints: toPoints(item.mediaEraserPoints),
    healingRadius: clamp(numberOr(item.mediaHealingRadius, 22), 2, 80),
    healingStrength: clamp(numberOr(item.mediaHealingStrength, 0.55), 0, 1),
    healingPoints: toPoints(item.mediaHealingPoints),
  };
}

function mapCropRect(item, sourceWidth, sourceHeight) {
  const rawRect = item?.cropRect;
  if (rawRect && typeof rawRect === "object") {
    const left = clamp(numberOr(rawRect.left, 0), 0, 1 - MIN_MEDIA_CROP_SIZE);
    const top = clamp(numberOr(rawRect.top, 0), 0, 1 - MIN_MEDIA_CROP_SIZE);
    const right = clamp(numberOr(rawRect.right, 1), MIN_MEDIA_CROP_SIZE, 1);
    const bottom = clamp(numberOr(rawRect.bottom, 1), MIN_MEDIA_CROP_SIZE, 1);
    return {
      left: clamp(Math.min(left, right - MIN_MEDIA_CROP_SIZE), 0, 1 - MIN_MEDIA_CROP_SIZE),
      top: clamp(Math.min(top, bottom - MIN_MEDIA_CROP_SIZE), 0, 1 - MIN_MEDIA_CROP_SIZE),
      right: clamp(Math.max(right, left + MIN_MEDIA_CROP_SIZE), MIN_MEDIA_CROP_SIZE, 1),
      bottom: clamp(Math.max(bottom, top + MIN_MEDIA_CROP_SIZE), MIN_MEDIA_CROP_SIZE, 1),
    };
  }

  const hasExplicitCrop =
    typeof item?.cropX !== "undefined" ||
    typeof item?.cropY !== "undefined" ||
    typeof item?.cropWidth !== "undefined" ||
    typeof item?.cropHeight !== "undefined";

  // If no explicit crop metadata exists, keep the full media frame.
  if (!hasExplicitCrop) {
    return {
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    };
  }

  const cropX = clamp(numberOr(item.cropX, 0), 0, sourceWidth);
  const cropY = clamp(numberOr(item.cropY, 0), 0, sourceHeight);
  const width = clamp(numberOr(item.cropWidth, numberOr(item.width, sourceWidth)), 1, sourceWidth);
  const height = clamp(numberOr(item.cropHeight, numberOr(item.height, sourceHeight)), 1, sourceHeight);
  const left = clamp(cropX / sourceWidth, 0, 1 - MIN_MEDIA_CROP_SIZE);
  const top = clamp(cropY / sourceHeight, 0, 1 - MIN_MEDIA_CROP_SIZE);
  const right = clamp((cropX + width) / sourceWidth, MIN_MEDIA_CROP_SIZE, 1);
  const bottom = clamp((cropY + height) / sourceHeight, MIN_MEDIA_CROP_SIZE, 1);

  const safeLeft = Math.min(left, right - MIN_MEDIA_CROP_SIZE);
  const safeTop = Math.min(top, bottom - MIN_MEDIA_CROP_SIZE);
  const safeRight = Math.max(right, safeLeft + MIN_MEDIA_CROP_SIZE);
  const safeBottom = Math.max(bottom, safeTop + MIN_MEDIA_CROP_SIZE);

  return {
    left: clamp(safeLeft, 0, 1 - MIN_MEDIA_CROP_SIZE),
    top: clamp(safeTop, 0, 1 - MIN_MEDIA_CROP_SIZE),
    right: clamp(safeRight, MIN_MEDIA_CROP_SIZE, 1),
    bottom: clamp(safeBottom, MIN_MEDIA_CROP_SIZE, 1),
  };
}

function mapImageLayer(item, index, canvasSize, options) {
  const base = baseLayer(item, index, canvasSize);
  const sourceWidth = Math.max(Math.round(numberOr(item.sourceWidth, item.width || 1)), 1);
  const sourceHeight = Math.max(Math.round(numberOr(item.sourceHeight, item.height || 1)), 1);
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  const layerBaseWidth = Math.max(numberOr(item.width, sourceWidth), 1);
  const layerBaseHeight = Math.max(numberOr(item.height, sourceHeight), 1);
  const rasterSourceRaw = String(item.rasterOriginalSrc || item.src || item.imageUri || "").trim();
  const rasterPalette = Array.isArray(item.rasterPalette)
    ? item.rasterPalette.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const rasterColorMap =
    item?.rasterColorMap && typeof item.rasterColorMap === "object" && !Array.isArray(item.rasterColorMap)
      ? Object.fromEntries(
          Object.entries(item.rasterColorMap)
            .map(([key, value]) => [String(key || "").trim(), String(value || "").trim()])
            .filter(([key, value]) => key && value)
        )
      : {};
  const vectorSourceRaw = String(item.vectorSrc || "").trim();
  // A built-in shape keeps its original SVG in vectorSrc. Always ship it as a vector so it stays
  // crisp at any scale on mobile — INCLUDING recolored shapes: the recolor is applied to the SVG's
  // fills (inline below when there's no asset resolver, otherwise by the ?field=vector asset route
  // which bakes it server-side) so a recolored shape looks the same as the raster but stays sharp.
  const hasActiveRasterRecolor = Object.entries(rasterColorMap).some(
    ([key, value]) => key.toLowerCase() !== value.toLowerCase()
  );
  const isVectorLayer = vectorSourceRaw.startsWith("data:image/svg");
  const normalizedCrop = mapCropRect(item, sourceWidth, sourceHeight);
  // The served vector (?field=vector) is already cropped to the shape's content, so it must NOT
  // also carry the raster's crop — that double-crops it (clipping the shape, e.g. the pointed top).
  // Serve it full-frame at the content's own dimensions instead.
  const contentWidth = Math.max(1, Math.round((normalizedCrop.right - normalizedCrop.left) * sourceWidth));
  const contentHeight = Math.max(1, Math.round((normalizedCrop.bottom - normalizedCrop.top) * sourceHeight));
  const rasterUri = resolveMediaUri(rasterSourceRaw || item.src || item.imageUri || "", {
    assetResolver: options?.assetResolver,
    mediaUrlResolver: options?.mediaUrlResolver,
    scope: "layer",
    elementId: item.id || item.layerId || "",
    index,
    field: item.rasterOriginalSrc ? "rasterOriginalSrc" : "src",
  });
  let imageUri = resolveMediaUri(isVectorLayer ? vectorSourceRaw : item.src || item.imageUri || "", {
    assetResolver: options?.assetResolver,
    mediaUrlResolver: options?.mediaUrlResolver,
    scope: "layer",
    elementId: item.id || item.layerId || "",
    index,
    field: isVectorLayer ? "vector" : "src",
  });
  if (isVectorLayer && imageUri && hasActiveRasterRecolor) {
    imageUri = isDataUri(imageUri)
      ? // Inline SVG (no asset resolver): recolor its fills here so the shipped vector is correct.
        recolorSvgSource(imageUri, rasterPalette, rasterColorMap)
      : // ?field=vector URL: the asset route bakes the recolor; bust the cache when it changes.
        appendQueryParam(imageUri, "rcm", colorMapFingerprint(rasterColorMap));
  }
  return {
    ...base,
    transform: buildTransform({
      item,
      canvasSize,
      centerX,
      centerY,
      rawScaleX,
      rawScaleY,
      baseWidth: layerBaseWidth,
      baseHeight: layerBaseHeight,
      scaleBounds: { min: MIN_MEDIA_VISUAL_SCALE, max: MAX_MEDIA_VISUAL_SCALE },
    }),
    type: "IMAGE",
    imageUri,
    frameWidth: layerBaseWidth,
    frameHeight: layerBaseHeight,
    sourceWidth: isVectorLayer ? contentWidth : sourceWidth,
    sourceHeight: isVectorLayer ? contentHeight : sourceHeight,
    sourceHasAlpha: Boolean(item.sourceHasAlpha),
    cropRect: isVectorLayer ? { left: 0, top: 0, right: 1, bottom: 1 } : normalizedCrop,
    filters: mediaFilters(item),
    assetKind: isVectorLayer ? "vector" : "raster",
    colorEditMode: isVectorLayer ? "none" : rasterPalette.length > 0 ? "raster" : "none",
    rasterOriginalUri: rasterUri || null,
    rasterPalette,
    rasterColorMap,
  };
}

function mapVideoLayer(item, index, canvasSize, options) {
  const base = baseLayer(item, index, canvasSize);
  const sourceWidth = Math.max(Math.round(numberOr(item.sourceWidth, item.width || 1)), 1);
  const sourceHeight = Math.max(Math.round(numberOr(item.sourceHeight, item.height || 1)), 1);
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  const layerBaseWidth = Math.max(numberOr(item.width, sourceWidth), 1);
  const layerBaseHeight = Math.max(numberOr(item.height, sourceHeight), 1);
  const durationMs = readVideoDurationMs(item);
  const trimStartMs = readVideoTrimStartMs(item);
  const trimEndMs = readVideoTrimEndMs(item, durationMs, trimStartMs);
  return {
    ...base,
    transform: buildTransform({
      item,
      canvasSize,
      centerX,
      centerY,
      rawScaleX,
      rawScaleY,
      baseWidth: layerBaseWidth,
      baseHeight: layerBaseHeight,
      scaleBounds: { min: MIN_MEDIA_VISUAL_SCALE, max: MAX_MEDIA_VISUAL_SCALE },
    }),
    type: "VIDEO_CLIP",
    videoUri: resolveMediaUri(item.videoUri || item.src || "", {
      assetResolver: options?.assetResolver,
      mediaUrlResolver: options?.mediaUrlResolver,
      scope: "layer",
      elementId: item.id || item.layerId || "",
      index,
      field: item.videoUri ? "videoUri" : "src",
    }),
    frameWidth: layerBaseWidth,
    frameHeight: layerBaseHeight,
    thumbnailUri: resolveMediaUri(item.thumbnailUri || item.src || "", {
      assetResolver: options?.assetResolver,
      mediaUrlResolver: options?.mediaUrlResolver,
      scope: "layer",
      elementId: item.id || item.layerId || "",
      index,
      field: item.thumbnailUri ? "thumbnailUri" : "src",
    }),
    sourceWidth,
    sourceHeight,
    cropRect: mapCropRect(item, sourceWidth, sourceHeight),
    filters: mediaFilters(item),
    trimStartMs: Math.round(trimStartMs),
    trimEndMs: Math.round(trimEndMs),
  };
}

function normalizeFrameContentTransform(value) {
  const transform = asObject(value) || {};
  const fit = ["contain", "manual"].includes(String(transform.fit || "").toLowerCase())
    ? String(transform.fit).toLowerCase()
    : "cover";
  return {
    fit,
    scale: clamp(numberOr(transform.scale, 1), 0.1, 8),
    offsetX: clamp(numberOr(transform.offsetX, 0), -10000, 10000),
    offsetY: clamp(numberOr(transform.offsetY, 0), -10000, 10000),
  };
}

function mapFrameShapePayload(item) {
  const frameShape = asObject(item?.frameShape) || {};
  const presetId = String(
    frameShape.presetId || item?.framePresetId || item?.presetId || item?.frameShapePresetId || ""
  ).trim();
  const kind = String(frameShape.kind || item?.frameShapeKind || item?.shapeKind || "rect")
    .trim()
    .toLowerCase();
  const points = Array.isArray(frameShape.points)
    ? frameShape.points.length > 0 &&
      typeof frameShape.points[0] === "object" &&
      frameShape.points[0] !== null
      ? frameShape.points
          .map((point) => ({
            x: numberOr(point?.x, Number.NaN),
            y: numberOr(point?.y, Number.NaN),
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : (() => {
          const pairs = [];
          for (let index = 0; index < frameShape.points.length - 1; index += 2) {
            const x = numberOr(frameShape.points[index], Number.NaN);
            const y = numberOr(frameShape.points[index + 1], Number.NaN);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              pairs.push({ x, y });
            }
          }
          return pairs;
        })()
    : [];
  const cornerRadius = numberOr(frameShape.cornerRadius, numberOr(item?.cornerRadius, 0));

  return {
    presetId: presetId || null,
    name: resolveFrameShapeName(item),
    kind: kind || "rect",
    points,
    cornerRadius: Math.max(0, cornerRadius),
  };
}

function resolveFramePreviewContentUri(item, index, options) {
  if (typeof options?.assetResolver !== "function") return "";
  return String(
    options.assetResolver({
      scope: "layer",
      elementId: item.id || item.layerId || "",
      index,
      field: "frameContent.preview",
    }) || ""
  ).trim();
}

function mapFrameContentPayload(item, index, options, frameWidth, frameHeight) {
  const content = asObject(item?.frameContent);
  if (!content?.src) return null;

  const kind = String(content.kind || "").trim().toLowerCase() === "video" ? "VIDEO" : "IMAGE";
  const previewWidth = Math.max(Math.round(numberOr(frameWidth, item.width || 1)), 1);
  const previewHeight = Math.max(Math.round(numberOr(frameHeight, item.height || 1)), 1);
  const sourceWidth = Math.max(Math.round(numberOr(content.sourceWidth, item.width || 1)), 1);
  const sourceHeight = Math.max(Math.round(numberOr(content.sourceHeight, item.height || 1)), 1);
  const contentUri = resolveMediaUri(content.src || "", {
    assetResolver: options?.assetResolver,
    mediaUrlResolver: options?.mediaUrlResolver,
    scope: "layer",
    elementId: item.id || item.layerId || "",
    index,
    field: "frameContent.src",
  });

  if (kind === "IMAGE" || content.posterSrc) {
    return {
      type: "IMAGE",
      imageUri: resolveFramePreviewContentUri(item, index, options),
      sourceWidth: previewWidth,
      sourceHeight: previewHeight,
      previewOnly: true,
    };
  }

  if (kind === "VIDEO") {
    const durationMs = readVideoDurationMs(content);
    const trimStartMs = readVideoTrimStartMs(content);
    const trimEndMs = readVideoTrimEndMs(content, durationMs, trimStartMs);
    return {
      type: "VIDEO",
      videoUri: contentUri,
      thumbnailUri: resolveMediaUri(content.posterSrc || content.src || "", {
        assetResolver: options?.assetResolver,
        mediaUrlResolver: options?.mediaUrlResolver,
        scope: "layer",
        elementId: item.id || item.layerId || "",
        index,
        field: content.posterSrc ? "frameContent.posterSrc" : "frameContent.src",
      }),
      sourceWidth,
      sourceHeight,
      trimStartMs: Math.round(trimStartMs),
      trimEndMs: Math.round(trimEndMs),
      durationMs: Math.round(durationMs),
    };
  }

  return {
    type: "IMAGE",
    imageUri: contentUri,
    sourceWidth,
    sourceHeight,
  };
}

function mapFrameLayer(item, index, canvasSize, options) {
  const base = baseLayer(item, index, canvasSize);
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  const frameWidth = Math.max(numberOr(item.width, 1), 1);
  const frameHeight = Math.max(numberOr(item.height, 1), 1);
  const content = mapFrameContentPayload(item, index, options, frameWidth, frameHeight);
  const contentTransform = content?.previewOnly
    ? {
        fit: "manual",
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      }
    : normalizeFrameContentTransform(item.frameContentTransform);

  return {
    ...base,
    transform: buildTransform({
      item,
      canvasSize,
      centerX,
      centerY,
      rawScaleX,
      rawScaleY,
      baseWidth: frameWidth,
      baseHeight: frameHeight,
      scaleBounds: { min: MIN_MEDIA_VISUAL_SCALE, max: MAX_MEDIA_VISUAL_SCALE },
    }),
    type: "FRAME",
    frameWidth,
    frameHeight,
    shape: mapFrameShapePayload(item),
    content,
    contentTransform,
    filters: mediaFilters(item, {
      includeShapeMask: false,
    }),
  };
}

function mapShapeLayerAsImage(item, index, canvasSize, options) {
  const frame = getShapeRasterFrame(item);
  const rasterItem = {
    ...item,
    width: frame.width,
    height: frame.height,
  };
  const base = baseLayer(rasterItem, index, canvasSize);
  const imageUri =
    typeof options?.assetResolver === "function"
      ? String(
          options.assetResolver({
            scope: "layer",
            elementId: item.id || item.layerId || "",
            index,
            field: "shape-raster",
          }) || ""
        ).trim()
      : renderShapeLayerToDataUrl(item);

  return {
    ...base,
    type: "IMAGE",
    imageUri,
    frameWidth: frame.width,
    frameHeight: frame.height,
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    sourceHasAlpha: true,
    cropRect: {
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    },
    filters: mediaFilters(item, {
      includeStroke: false,
      includeShapeMask: false,
    }),
  };
}

function mapShapeLayer(item, index, canvasSize) {
  const base = baseLayer(item, index, canvasSize);
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  const shapeType = String(item.type || item.layerShapeType || "").toLowerCase();
  const mappedShapeType =
    shapeType.includes("circle") ? "CIRCLE" : shapeType.includes("round") ? "ROUNDED" : "RECTANGLE";
  return {
    ...base,
    transform: buildTransform({
      item,
      canvasSize,
      centerX,
      centerY,
      rawScaleX,
      rawScaleY,
      baseWidth: 200,
      baseHeight: 120,
    }),
    type: "SHAPE",
    shapeType: mappedShapeType,
    fillColorHex: normalizeHex(item.fill, "#00AEEF"),
    strokeColorHex: normalizeHex(item.stroke, "#FFFFFF"),
  };
}

function mapStickerLayer(item, index, canvasSize) {
  const base = baseLayer(item, index, canvasSize);
  const { centerX, centerY, rawScaleX, rawScaleY } = centerFromFabricItem(item);
  return {
    ...base,
    transform: buildTransform({
      item,
      canvasSize,
      centerX,
      centerY,
      rawScaleX,
      rawScaleY,
      baseWidth: 120,
      baseHeight: 120,
    }),
    type: "STICKER",
    assetId: String(item.assetId || item.layerId || `sticker-${index + 1}`),
    tintColorHex: normalizeHex(item.tintColorHex || item.fill, "#FFFFFF"),
  };
}

// Whether an element carries real image pixels (a fetched/embedded asset) vs. being a solid
// vector shape. A shape (rect/circle/…) with a paintable `fill` and no image src is NOT an image.
function hasUsableImageSource(item) {
  const src = String(item?.src || item?.imageUri || item?.rasterOriginalSrc || "").trim();
  return (
    /^https?:\/\//i.test(src) ||
    /^data:image\//i.test(src) ||
    /^file:\/\//i.test(src) ||
    /^blob:/i.test(src)
  );
}

function mapFabricObjectToMobileLayer(item, index, canvasSize, options) {
  const layerType = String(item.layerType || item.type || "").toLowerCase();
  if (layerType === "frame" || item?.frameShape || item?.frameContent) {
    return mapFrameLayer(item, index, canvasSize, options);
  }
  if (layerType === "sticker") {
    return mapStickerLayer(item, index, canvasSize);
  }
  if (layerType === "text" || String(item.type || "").toLowerCase().includes("text")) {
    return mapTextLayer(item, index, canvasSize, options);
  }
  if (layerType === "video") {
    return mapVideoLayer(item, index, canvasSize, options);
  }
  // A concrete vector shape (rect/circle/line/arrow/star) carrying NO real image source is a SOLID
  // shape and must be rasterized as one. Checked BEFORE the image branch because a shape captured
  // from Canva — which renders shapes as protected rasters — keeps importKind="image", and
  // extractFabricData's `layerType || importKind || type` fallback then labels the rect "image".
  // That routed it to mapImageLayer, which emitted an EMPTY imageUri and rendered as a grey block on
  // mobile (observed: an imported banner-bar rect). The element's real `type` (rect) is authoritative.
  if (isRasterizableShapeLayer(item) && !hasUsableImageSource(item)) {
    return mapShapeLayerAsImage(item, index, canvasSize, options);
  }
  if (layerType === "image" || String(item.type || "").toLowerCase().includes("image")) {
    return mapImageLayer(item, index, canvasSize, options);
  }
  if (isRasterizableShapeLayer(item)) {
    return mapShapeLayerAsImage(item, index, canvasSize, options);
  }
  return mapShapeLayer(item, index, canvasSize);
}

// A transparent page background — the editor's "transparent" swatch (color === "transparent").
function isTransparentBackgroundColor(color) {
  const c = String(color || "").trim().toLowerCase();
  return c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "rgba(0,0,0,0)";
}

function mapBackground(value, options) {
  if (isDataUri(value)) {
    const imageUri = resolveMediaUri(value, {
      assetResolver: options?.assetResolver,
      mediaUrlResolver: options?.mediaUrlResolver,
      scope: "background",
      field: "background",
    });
    if (imageUri) {
      return { type: "image", imageUri };
    }
  }
  if (value && typeof value === "string") {
    // A blank/transparent string means no fill; a real color is solid.
    if (!value.trim() || isTransparentBackgroundColor(value)) {
      return { type: "transparent" };
    }
    return { type: "solid", colorHex: normalizeHex(value, "#FFFFFF") };
  }
  if (value && typeof value === "object") {
    // Transparent page background — emitted as its own wire type so the app can render real
    // transparency. Builds without a Background.Transparent variant fall back to solid white
    // (their mapper's default branch), so this is forward-compatible.
    if (value.type === "color" && isTransparentBackgroundColor(value.color)) {
      return { type: "transparent" };
    }
    if (value.type === "image" && value.imageUri) {
      return {
        type: "image",
        imageUri: resolveMediaUri(value.imageUri, {
          assetResolver: options?.assetResolver,
          mediaUrlResolver: options?.mediaUrlResolver,
          scope: "background",
          field: "imageUri",
        }),
      };
    }
    if (
      value.type === "gradient" &&
      (value.startColorHex || value.gradientFrom) &&
      (value.endColorHex || value.gradientTo)
    ) {
      return {
        type: "gradient",
        startColorHex: normalizeHex(value.startColorHex || value.gradientFrom, "#000000"),
        endColorHex: normalizeHex(value.endColorHex || value.gradientTo, "#FFFFFF"),
        angle: numberOr(value.angle, 0),
      };
    }
    if (value.type === "color" && value.color) {
      return { type: "solid", colorHex: normalizeHex(value.color, "#FFFFFF") };
    }
    if (value.type === "solid" && value.colorHex) {
      return { type: "solid", colorHex: normalizeHex(value.colorHex, "#FFFFFF") };
    }
  }
  return { type: "solid", colorHex: "#FFFFFF" };
}

function resolveCanvasSize(template) {
  return {
    width: Math.max(numberOr(template?.canvasSize?.width, 1080), 1),
    height: Math.max(numberOr(template?.canvasSize?.height, 1080), 1),
  };
}

/**
 * Page list for a template: `options.pagesData` (precomputed by the route) or derived
 * from the stored payload. Always ordered first-page-first; single-page templates
 * yield one entry.
 */
function resolvePagesData(template, options = {}) {
  if (Array.isArray(options?.pagesData) && options.pagesData.length > 0) {
    return options.pagesData;
  }
  return extractEditorPagesData(template?.data || {}) || null;
}

/**
 * Wraps the asset resolver so every asset URL generated while mapping page
 * `pageIndex` carries the page dimension. Page 0 returns options untouched, which
 * keeps single-page asset URLs byte-identical to the pre-pages format.
 */
function wrapOptionsForPage(options, pageIndex) {
  if (!options || pageIndex <= 0 || typeof options.assetResolver !== "function") {
    return options || {};
  }
  const baseResolver = options.assetResolver;
  return {
    ...options,
    assetResolver: (args = {}) => baseResolver({ ...args, page: pageIndex }),
  };
}

function resolvePageSize(page, canvasSize) {
  return {
    width: Math.max(numberOr(page?.width, canvasSize.width), 1),
    height: Math.max(numberOr(page?.height, canvasSize.height), 1),
  };
}

function normalizePageDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : DEFAULT_PAGE_DURATION_MS;
}

/**
 * Per-page preview URL for the app's page strip.
 *
 * Page 0 falls back to the template's cover thumbnail — every template has one, and it IS the
 * first page — so a multi-page template always ships at least one ready-made page image. Later
 * pages resolve from `Template.pageThumbnails` and are simply absent when never captured (the
 * app then renders that tile locally).
 */
function resolvePageThumbnailUrl(template, page, pageIndex, pageTotal, options) {
  const stored = template?.pageThumbnails;
  const map = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : null;
  let raw = String(map?.[String(page?.id || "")] || "").trim();

  // Positional fallback for the id-rename transition: opening an IMPORTED template in the
  // editor re-keys its pages (canva-page-N → template-page-<id>-N), which would orphan the
  // previews captured at import time. Only applied when the stored set still lines up 1:1
  // with the pages, so a genuine add/delete falls through to no preview instead of a wrong one.
  if (!raw && map) {
    const orderedValues = Object.values(map);
    if (orderedValues.length === pageTotal && pageIndex < orderedValues.length) {
      raw = String(orderedValues[pageIndex] || "").trim();
    }
  }

  if (raw) {
    const updatedAt = toTimestampMs(template?.updatedAt);
    const versionToken = Number.isFinite(updatedAt) ? String(updatedAt) : "";
    return resolveClientMediaUri(appendVersionParam(raw, versionToken), options);
  }
  return pageIndex === 0 ? resolveTemplateThumbnailUrl(template, options) : "";
}

const FRAME_PRESET_NAMES = new Map([
  ["frame-circle", "Circle"],
  ["frame-rounded-square", "Rounded square"],
  ["frame-square", "Square"],
  ["frame-diamond", "Diamond"],
  ["frame-inverted-triangle", "Inverted triangle"],
  ["frame-trapezoid", "Trapezoid"],
  ["frame-pentagon", "Pentagon"],
  ["frame-hexagon", "Hexagon"],
  ["frame-star", "Star"],
  ["frame-kite", "Kite"],
  ["frame-octagon", "Octagon"],
  ["frame-burst", "Burst"],
  ["frame-scallop-circle", "Scallop circle"],
  ["frame-scallop-badge", "Scallop badge"],
  ["frame-tag-left", "Left tag"],
  ["frame-tag-right", "Right tag"],
]);

function humanizeFrameShape(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^frame[-_\s]*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "Custom";
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function resolveFrameShapeName(item) {
  const frameShape = asObject(item?.frameShape);
  const presetId = String(
    frameShape?.presetId || item?.framePresetId || item?.presetId || item?.frameShapePresetId || ""
  ).trim();
  if (FRAME_PRESET_NAMES.has(presetId)) {
    return FRAME_PRESET_NAMES.get(presetId);
  }
  if (presetId) return humanizeFrameShape(presetId);

  const shapeKind = String(frameShape?.kind || item?.frameShapeKind || item?.shapeKind || "").trim();
  if (shapeKind) return humanizeFrameShape(shapeKind);

  return "Custom";
}

function buildFrameInfoFromObjects(objects) {
  const frames = (Array.isArray(objects) ? objects : [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const layerType = String(item.layerType || item.type || item.importKind || "").trim().toLowerCase();
      const frameShape = asObject(item.frameShape);
      const frameContent = asObject(item.frameContent);
      const isFrame = layerType === "frame" || Boolean(frameShape) || Boolean(frameContent);
      if (!isFrame) return null;

      const presetId = String(
        frameShape?.presetId || item.framePresetId || item.presetId || item.frameShapePresetId || ""
      ).trim();
      const shapeKind = String(frameShape?.kind || item.frameShapeKind || item.shapeKind || "").trim();
      const contentKind = String(frameContent?.kind || item.frameContentKind || "").trim().toLowerCase();

      return {
        id: String(item.id || item.layerId || `frame-${index + 1}`),
        name: String(item.name || item.layerName || `Frame ${index + 1}`),
        shape: resolveFrameShapeName(item),
        presetId: presetId || null,
        shapeKind: shapeKind || null,
        hasContent: Boolean(frameContent?.src || item.frameContentSrc),
        contentKind: contentKind || null,
      };
    })
    .filter(Boolean);

  const shapes = Array.from(new Set(frames.map((frame) => frame.shape).filter(Boolean)));
  const shapeSummary = shapes.length > 0 ? shapes.join(", ") : "";
  const count = frames.length;

  return {
    hasFrames: count > 0,
    count,
    shapes,
    frames,
    message:
      count > 0
        ? `This template contains ${count} frame${count === 1 ? "" : "s"}${shapeSummary ? `: ${shapeSummary}` : ""}.`
        : "",
  };
}

function getMobileTemplateFrameInfo(template) {
  if (!Object.prototype.hasOwnProperty.call(template || {}, "data")) return null;
  const rawData = template?.data || {};
  const pages = extractEditorPagesData(rawData);
  if (Array.isArray(pages) && pages.length > 0) {
    return buildFrameInfoFromObjects(pages.flatMap((page) => page.objects || []));
  }
  const data = extractFabricData(rawData) || rawData || {};
  return buildFrameInfoFromObjects(Array.isArray(data?.objects) ? data.objects : []);
}

function buildMobileCompatibilityWarnings(frameInfo) {
  const warnings = [];
  if (frameInfo?.hasFrames) {
    warnings.push(frameInfo.message);
  }
  return warnings;
}

function toTimestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (!value) return NaN;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function isPreviewReadyStatus(value) {
  return String(value || "").trim().toLowerCase() === "ready";
}

function isTemplatePreviewStale(template, previewUpdatedAtMs) {
  if (!Number.isFinite(previewUpdatedAtMs)) return false;
  const templateUpdatedAtMs = toTimestampMs(template?.updatedAt);
  if (!Number.isFinite(templateUpdatedAtMs)) return false;

  // Prisma's @updatedAt can be a few milliseconds after previewUpdatedAt in the
  // same save. Only suppress previews when the template clearly changed later.
  return templateUpdatedAtMs - previewUpdatedAtMs > 1000;
}

function mapTemplatePreview(template, options = {}) {
  const status = String(template?.previewStatus || "").trim();
  const rawUrl = resolveClientMediaUri(template?.previewVideoUrl || "", options);
  const rawPosterUrl = resolveClientMediaUri(template?.previewPosterUrl || "", options);
  const durationMs = numberOr(template?.previewDurationMs, NaN);
  const updatedAt = toTimestampMs(template?.previewUpdatedAt);
  const version = numberOr(template?.previewVersion, NaN);
  const error = String(template?.previewError || "").trim();
  const previewIsStale = isPreviewReadyStatus(status) && isTemplatePreviewStale(template, updatedAt);
  const versionToken = Number.isFinite(updatedAt)
    ? String(updatedAt)
    : Number.isFinite(version)
      ? String(version)
      : "";
  const url = previewIsStale ? "" : appendVersionParam(rawUrl, versionToken);
  const posterUrl = previewIsStale ? "" : appendVersionParam(rawPosterUrl, versionToken);
  const effectiveStatus = previewIsStale ? "not_requested" : status;

  if (!status && !url && !posterUrl && !Number.isFinite(durationMs) && !Number.isFinite(updatedAt) && !Number.isFinite(version) && !error) {
    return null;
  }

  return {
    status: effectiveStatus || "not_requested",
    url: url || null,
    posterUrl: posterUrl || null,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    version: Number.isFinite(version) ? Math.max(0, Math.round(version)) : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    error: error || null,
  };
}

function mapTemplatePreviewSlim(template, options = {}) {
  const status = String(template?.previewStatus || "").trim();
  const rawUrl = resolveClientMediaUri(template?.previewVideoUrl || "", options);
  const rawPosterUrl = resolveClientMediaUri(template?.previewPosterUrl || "", options);
  const durationMs = numberOr(template?.previewDurationMs, NaN);
  const updatedAt = toTimestampMs(template?.previewUpdatedAt);
  const version = numberOr(template?.previewVersion, NaN);
  const previewIsStale = isPreviewReadyStatus(status) && isTemplatePreviewStale(template, updatedAt);
  const versionToken = Number.isFinite(updatedAt)
    ? String(updatedAt)
    : Number.isFinite(version)
      ? String(version)
      : "";
  const url = previewIsStale ? "" : appendVersionParam(rawUrl, versionToken);
  const posterUrl = previewIsStale ? "" : appendVersionParam(rawPosterUrl, versionToken);
  const effectiveStatus = previewIsStale ? "not_requested" : status;

  if (!status && !url && !posterUrl && !Number.isFinite(durationMs)) {
    return null;
  }

  return {
    status: effectiveStatus || "not_requested",
    ...(url ? { url } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(Number.isFinite(durationMs) ? { durationMs: Math.max(0, Math.round(durationMs)) } : {}),
  };
}

function resolveTemplateThumbnailUrl(template, options = {}) {
  const rawThumbnail = String(
    template?.thumbnailDataUrl || template?.thumbnailUrl || template?.thumbnail || ""
  );
  const updatedAt =
    template?.updatedAt instanceof Date
      ? template.updatedAt.getTime()
      : template?.updatedAt
        ? new Date(template.updatedAt).getTime()
        : NaN;
  const versionToken = Number.isFinite(updatedAt)
    ? String(updatedAt)
    : String(template?.version || "").trim();
  const versionedThumbnail = appendVersionParam(rawThumbnail, versionToken);
  return isDataUri(rawThumbnail)
    ? resolveMediaUri(versionedThumbnail, {
        assetResolver: options?.assetResolver,
        mediaUrlResolver: options?.mediaUrlResolver,
        scope: "thumbnail",
        field: "thumbnailDataUrl",
      })
    : resolveClientMediaUri(versionedThumbnail, options);
}

function slimLayerFont(font) {
  if (!font || typeof font !== "object") return undefined;

  const id = String(font.id || "").trim();
  const fontName = String(font.fontName || "").trim();
  const displayName = String(font.displayName || "").trim();
  const downloadUrl = String(font.downloadUrl || "").trim();
  const mobileDownloadUrl = String(font.mobileDownloadUrl || "").trim();
  const mobileCompatible =
    typeof font.mobileCompatible === "boolean" ? font.mobileCompatible : null;

  if (!id && !fontName && !displayName && !downloadUrl && !mobileDownloadUrl && mobileCompatible === null) {
    return undefined;
  }

  return {
    ...(id ? { id } : {}),
    ...(fontName ? { fontName } : {}),
    ...(displayName ? { displayName } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(mobileDownloadUrl ? { mobileDownloadUrl } : {}),
    ...(mobileCompatible !== null ? { mobileCompatible } : {}),
  };
}

function slimFrameShape(shape) {
  if (!shape || typeof shape !== "object") return undefined;

  return {
    kind: String(shape.kind || "rect").trim().toLowerCase() || "rect",
    points: Array.isArray(shape.points) ? shape.points : [],
    cornerRadius: Math.max(0, Number(shape.cornerRadius) || 0),
  };
}

function slimFrameContent(content) {
  if (!content || typeof content !== "object") return null;

  return {
    type: String(content.type || "").trim().toUpperCase() || "IMAGE",
    ...(content.imageUri ? { imageUri: content.imageUri } : {}),
    ...(content.videoUri ? { videoUri: content.videoUri } : {}),
    ...(content.thumbnailUri ? { thumbnailUri: content.thumbnailUri } : {}),
    ...(Number.isFinite(Number(content.sourceWidth))
      ? { sourceWidth: Math.max(1, Math.round(Number(content.sourceWidth))) }
      : {}),
    ...(Number.isFinite(Number(content.sourceHeight))
      ? { sourceHeight: Math.max(1, Math.round(Number(content.sourceHeight))) }
      : {}),
    ...(typeof content.sourceHasAlpha === "boolean" ? { sourceHasAlpha: content.sourceHasAlpha } : {}),
    ...(typeof content.previewOnly === "boolean" ? { previewOnly: content.previewOnly } : {}),
    ...(Number.isFinite(Number(content.trimStartMs))
      ? { trimStartMs: Math.max(0, Math.round(Number(content.trimStartMs))) }
      : {}),
    ...(Number.isFinite(Number(content.trimEndMs))
      ? { trimEndMs: Math.max(0, Math.round(Number(content.trimEndMs))) }
      : {}),
    ...(Number.isFinite(Number(content.durationMs))
      ? { durationMs: Math.max(0, Math.round(Number(content.durationMs))) }
      : {}),
  };
}

function slimMobileLayer(layer) {
  if (!layer || typeof layer !== "object") return layer;

  const common = {
    id: layer.id,
    type: layer.type,
    transform: layer.transform,
    opacity: layer.opacity,
    locked: layer.locked,
    hidden: layer.hidden,
    zIndex: layer.zIndex,
    timelineStartMs: layer.timelineStartMs,
    timelineEndMs: layer.timelineEndMs,
    animation: layer.animation,
  };

  switch (String(layer.type || "").toUpperCase()) {
    case "IMAGE":
      return {
        ...common,
        imageUri: layer.imageUri,
        frameWidth: layer.frameWidth,
        frameHeight: layer.frameHeight,
        sourceWidth: layer.sourceWidth,
        sourceHeight: layer.sourceHeight,
        sourceHasAlpha: layer.sourceHasAlpha,
        cropRect: layer.cropRect,
        filters: layer.filters,
        ...(layer.assetKind ? { assetKind: layer.assetKind } : {}),
        ...(layer.colorEditMode ? { colorEditMode: layer.colorEditMode } : {}),
        ...(layer.rasterOriginalUri ? { rasterOriginalUri: layer.rasterOriginalUri } : {}),
        ...(Array.isArray(layer.rasterPalette) ? { rasterPalette: layer.rasterPalette } : {}),
        ...(layer.rasterColorMap && typeof layer.rasterColorMap === "object"
          ? { rasterColorMap: layer.rasterColorMap }
          : {}),
      };
    case "VIDEO_CLIP":
      return {
        ...common,
        videoUri: layer.videoUri,
        frameWidth: layer.frameWidth,
        frameHeight: layer.frameHeight,
        ...(layer.thumbnailUri ? { thumbnailUri: layer.thumbnailUri } : {}),
        sourceWidth: layer.sourceWidth,
        sourceHeight: layer.sourceHeight,
        ...(typeof layer.sourceHasAlpha === "boolean" ? { sourceHasAlpha: layer.sourceHasAlpha } : {}),
        cropRect: layer.cropRect,
        filters: layer.filters,
        ...(Number.isFinite(Number(layer.trimStartMs)) ? { trimStartMs: layer.trimStartMs } : {}),
        ...(Number.isFinite(Number(layer.trimEndMs)) ? { trimEndMs: layer.trimEndMs } : {}),
      };
    case "TEXT": {
      const font = slimLayerFont(layer.font);
      return {
        ...common,
        text: layer.text,
        ...(typeof layer.isRtl === "boolean" ? { isRtl: layer.isRtl } : {}),
        fontName: layer.fontName,
        size: layer.size,
        ...(typeof layer.wrapWidth === "number" ? { wrapWidth: layer.wrapWidth } : {}),
        colorHex: layer.colorHex,
        shadow: layer.shadow,
        stroke: layer.stroke,
        letterSpacing: layer.letterSpacing,
        lineHeight: layer.lineHeight,
        alignment: layer.alignment,
        bold: layer.bold,
        italic: layer.italic,
        underline: layer.underline,
        strikethrough: layer.strikethrough,
        textCase: layer.textCase,
        curveConfig: layer.curveConfig,
        backgroundVisible: layer.backgroundVisible,
        backgroundColorHex: layer.backgroundColorHex,
        backgroundAngleSize: layer.backgroundAngleSize,
        backgroundOpacity: layer.backgroundOpacity,
        ...(font ? { font } : {}),
      };
    }
    case "FRAME": {
      const shape = slimFrameShape(layer.shape);
      const content = slimFrameContent(layer.content);
      return {
        ...common,
        frameWidth: layer.frameWidth,
        frameHeight: layer.frameHeight,
        ...(shape ? { shape } : {}),
        ...(layer.content ? { content } : {}),
        ...(layer.contentTransform ? { contentTransform: layer.contentTransform } : {}),
        filters: layer.filters,
      };
    }
    default:
      return layer;
  }
}

export function toMobileProject(template, options = {}) {
  const canvasSize = resolveCanvasSize(template);

  const rawData = template?.data || {};
  const pagesData = options?.fabricData ? null : resolvePagesData(template, options);
  const primaryPage = Array.isArray(pagesData) && pagesData.length > 0 ? pagesData[0] : null;
  const data =
    options?.fabricData ||
    (primaryPage
      ? { background: primaryPage.background, objects: primaryPage.objects }
      : extractFabricData(rawData) || rawData || {});
  const primarySize = primaryPage ? resolvePageSize(primaryPage, canvasSize) : canvasSize;
  const objects = Array.isArray(data?.objects) ? data.objects : [];
  const layers = objects.map((item, index) =>
    mapFabricObjectToMobileLayer(item || {}, index, primarySize, options)
  );
  const frameInfo = getMobileTemplateFrameInfo(template) || buildFrameInfoFromObjects(objects);
  const compatibilityWarnings = buildMobileCompatibilityWarnings(frameInfo);
  const pageCount = Array.isArray(pagesData) && pagesData.length > 0 ? pagesData.length : 1;

  return {
    id: String(template?.id || ""),
    name: String(template?.name || "Untitled"),
    createdAt: new Date(template?.createdAt || Date.now()).getTime(),
    updatedAt: new Date(template?.updatedAt || Date.now()).getTime(),
    canvasWidth: primarySize.width,
    canvasHeight: primarySize.height,
    background: mapBackground(data.background, options),
    layers,
    pageCount,
    ...(pageCount > 1
      ? {
          pages: pagesData.map((page, pageIndex) => {
            const pageOptions = wrapOptionsForPage(options, pageIndex);
            const pageSize = resolvePageSize(page, canvasSize);
            const pageThumbnailUrl = resolvePageThumbnailUrl(template, page, pageIndex, pagesData.length, options);
            return {
              id: String(page.id || `page-${pageIndex + 1}`),
              name: String(page.name || `Page ${pageIndex + 1}`),
              width: pageSize.width,
              height: pageSize.height,
              durationMs: normalizePageDurationMs(page.durationMs),
              ...(pageThumbnailUrl ? { thumbnailUrl: pageThumbnailUrl } : {}),
              background:
                pageIndex === 0
                  ? mapBackground(data.background, options)
                  : mapBackground(page.background, pageOptions),
              layers:
                pageIndex === 0
                  ? layers
                  : (page.objects || []).map((item, index) =>
                      mapFabricObjectToMobileLayer(item || {}, index, pageSize, pageOptions)
                    ),
            };
          }),
        }
      : {}),
    meta: {
      source: "web-dashboard-fabric",
      templateId: String(template?.id || ""),
      version: template?.version || 1,
      category: String(template?.category || "general"),
      subCategory: String(template?.subCategory || "general"),
      frameInfo,
      compatibilityWarnings,
    },
  };
}

export function toMobileTemplate(template, options = {}) {
  const includeProject = options.includeProject !== false;
  const canvasSize = resolveCanvasSize(template);
  const preview = mapTemplatePreview(template, options);
  const resolvedThumbnail = resolveTemplateThumbnailUrl(template, options);
  const frameInfo = getMobileTemplateFrameInfo(template);
  const compatibilityWarnings = buildMobileCompatibilityWarnings(frameInfo);
  // List selects omit `data`, so summaries rely on the persisted pageCount column.
  const summaryPageCount = Math.max(1, Math.round(numberOr(template?.pageCount, 1)));
  return {
    id: String(template?.id || ""),
    title: String(template?.name || "Untitled"),
    version: numberOr(template?.version, 1),
    updatedAt: new Date(template?.updatedAt || Date.now()).getTime(),
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    pageCount: summaryPageCount,
    category: mapTemplateCategory(template?.category),
    subCategory: String(template?.subCategory || "general"),
    // Pro-only template: listed for everyone, the app badges it and walls at
    // the point of use (mirrors AiTool.isPremium).
    isPremium: Boolean(template?.isPremium),
    thumbnailUrl: resolvedThumbnail,
    thumbnailDataUrl: resolvedThumbnail,
    preview,
    previewVideoUrl: preview?.url || null,
    previewPosterUrl: preview?.posterUrl || null,
    ...(frameInfo ? { frameInfo, compatibilityWarnings } : {}),
    ...(includeProject ? { project: toMobileProject(template, options) } : {}),
  };
}

export function toMobileProjectSlim(template, options = {}) {
  const telemetry =
    options && typeof options === "object" && options.telemetry && typeof options.telemetry === "object"
      ? options.telemetry
      : null;
  const canvasSize = resolveCanvasSize(template);
  const rawData = template?.data || {};
  const pagesData = options?.fabricData ? null : resolvePagesData(template, options);
  const primaryPage = Array.isArray(pagesData) && pagesData.length > 0 ? pagesData[0] : null;
  // Top-level background/layers always mirror the FIRST page (the design cover) so
  // app builds that predate `pages` keep rendering something sensible.
  const data =
    options?.fabricData ||
    (primaryPage
      ? { background: primaryPage.background, objects: primaryPage.objects }
      : extractFabricData(rawData) || rawData || {});
  const primarySize = primaryPage ? resolvePageSize(primaryPage, canvasSize) : canvasSize;
  const objects = Array.isArray(data?.objects) ? data.objects : [];
  if (telemetry) {
    telemetry.objectCount = objects.length;
  }

  const backgroundStartedAt = performance.now();
  const background = mapBackground(data.background, options);
  addTiming(telemetry, "mapBackgroundMs", performance.now() - backgroundStartedAt);

  const mapSlimLayers = (pageObjects, pageSize, pageOptions) =>
    (Array.isArray(pageObjects) ? pageObjects : []).map((item, index) => {
      const layerStartedAt = performance.now();
      const mappedLayer = slimMobileLayer(
        mapFabricObjectToMobileLayer(item || {}, index, pageSize, pageOptions)
      );
      const layerDurationMs = performance.now() - layerStartedAt;
      const layerPrefix = resolveLayerTelemetryPrefix(mappedLayer);
      incrementCount(telemetry, `${layerPrefix}LayerCount`);
      addTiming(telemetry, `${layerPrefix}LayerMapMs`, layerDurationMs);
      return mappedLayer;
    });

  const layers = mapSlimLayers(objects, primarySize, options);

  if (telemetry) {
    telemetry.layerCount = layers.length;
  }

  const pageCount = Array.isArray(pagesData) && pagesData.length > 0 ? pagesData.length : 1;
  if (telemetry) {
    telemetry.pageCount = pageCount;
  }

  let pagesPayload = null;
  if (pageCount > 1) {
    const pagesStartedAt = performance.now();
    pagesPayload = pagesData.map((page, pageIndex) => {
      const pageOptions = wrapOptionsForPage(options, pageIndex);
      const pageSize = resolvePageSize(page, canvasSize);
      const pageThumbnailUrl = resolvePageThumbnailUrl(template, page, pageIndex, pagesData.length, options);
      return {
        id: String(page.id || `page-${pageIndex + 1}`),
        name: String(page.name || `Page ${pageIndex + 1}`),
        width: pageSize.width,
        height: pageSize.height,
        durationMs: normalizePageDurationMs(page.durationMs),
        ...(pageThumbnailUrl ? { thumbnailUrl: pageThumbnailUrl } : {}),
        background:
          pageIndex === 0 ? background : mapBackground(page.background, pageOptions),
        layers: pageIndex === 0 ? layers : mapSlimLayers(page.objects, pageSize, pageOptions),
      };
    });
    addTiming(telemetry, "mapPagesMs", performance.now() - pagesStartedAt);
  }

  return {
    canvasWidth: primarySize.width,
    canvasHeight: primarySize.height,
    background,
    layers,
    pageCount,
    ...(pagesPayload ? { pages: pagesPayload } : {}),
  };
}

export function toMobileTemplateDetailSlim(template, options = {}) {
  const telemetry =
    options && typeof options === "object" && options.telemetry && typeof options.telemetry === "object"
      ? options.telemetry
      : null;
  const previewStartedAt = performance.now();
  const preview = mapTemplatePreviewSlim(template, options);
  addTiming(telemetry, "mapPreviewMs", performance.now() - previewStartedAt);
  const thumbnailStartedAt = performance.now();
  const thumbnailUrl = resolveTemplateThumbnailUrl(template, options);
  addTiming(telemetry, "resolveThumbnailMs", performance.now() - thumbnailStartedAt);
  const projectStartedAt = performance.now();
  const project = toMobileProjectSlim(template, options);
  addTiming(telemetry, "mapProjectMs", performance.now() - projectStartedAt);

  return {
    id: String(template?.id || ""),
    title: String(template?.name || "Untitled"),
    category: String(options?.categoryLabel || template?.category || ""),
    categoryValue: String(options?.categoryValue || template?.category || ""),
    subCategory: String(options?.subCategoryLabel || template?.subCategory || ""),
    subCategoryValue: String(options?.subCategoryValue || template?.subCategory || ""),
    isPremium: Boolean(template?.isPremium),
    thumbnailUrl,
    ...(preview ? { preview } : {}),
    pageCount: Math.max(1, Math.round(numberOr(project?.pageCount, 1))),
    project,
  };
}
