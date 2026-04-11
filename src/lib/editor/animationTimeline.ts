export type EditorAnimationType =
  | "NONE"
  | "RISE"
  | "PAN"
  | "FADE"
  | "POP"
  | "WIPE"
  | "BLUR"
  | "SUCCESSION"
  | "BREATHE"
  | "BASELINE"
  | "DRIFT"
  | "TECTONIC"
  | "TUMBLE"
  | "NEON"
  | "SCRAPBOOK"
  | "STOMP"
  | "ROTATE"
  | "FLICKER"
  | "PULSE"
  | "WIGGLE"
  | "STATIC"
  | "DISSOLVE"
  | "WIPE_GRADIENT"
  | "SLIDE"
  | "ZOOM"
  | "ZOOM_FADE"
  | "CIRCULAR"
  | "CIRCULAR_FADE"
  | "RADIAL"
  | "RADIAL_GRADIENT"
  | "SHAKE"
  | "ROTATION"
  | "BOUNCE"
  | "PULSE_ZOOM"
  | "HEART_BEAT"
  | "RANDOM"
  | "FLOAT"
  | "SPIN";

export type EditorAnimationMode = "IN" | "OUT" | "LOOP";
export type EditorAnimationCategory = "instant" | "transition" | "loop";
export type EditorAnimationDirection =
  | "LEFT"
  | "RIGHT"
  | "UP"
  | "DOWN"
  | "CENTER"
  | "CLOCKWISE"
  | "COUNTERCLOCKWISE";
export type EditorAnimationEasing =
  | "LINEAR"
  | "EASE_OUT"
  | "EASE_IN_OUT"
  | "SOFT_OUT"
  | "SOFT_IN_OUT";

export interface EditorAnimationOption {
  value: EditorAnimationType;
  label: string;
}

export interface EditorAnimationPreset extends EditorAnimationOption {
  category: EditorAnimationCategory;
  defaultDurationMs: number;
  defaultDelayMs: number;
  defaultDirection: EditorAnimationDirection;
  defaultEasing: EditorAnimationEasing;
  defaultIntensity: number;
  supportsInfinite: boolean;
}

export const DEFAULT_PAGE_DURATION_MS = 15000;
export const MIN_LAYER_DURATION_MS = 100;
export const DEFAULT_TIMELINE_FPS = 30;
export const DEFAULT_ANIMATION_DURATION_MS = 1200;
export const MIN_ANIMATION_DURATION_MS = 200;
export const MAX_ANIMATION_DURATION_MS = DEFAULT_PAGE_DURATION_MS;
export const DEFAULT_ANIMATION_DELAY_MS = 0;
export const DEFAULT_ANIMATION_INTENSITY = 1;

export const EDITOR_ANIMATION_PRESETS: EditorAnimationPreset[] = [
  {
    value: "NONE",
    label: "None",
    category: "instant",
    defaultDurationMs: 0,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "LINEAR",
    defaultIntensity: 1,
    supportsInfinite: false,
  },
  {
    value: "RISE",
    label: "Rise",
    category: "transition",
    defaultDurationMs: 900,
    defaultDelayMs: 0,
    defaultDirection: "UP",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "PAN",
    label: "Pan",
    category: "transition",
    defaultDurationMs: 900,
    defaultDelayMs: 0,
    defaultDirection: "RIGHT",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "FADE",
    label: "Fade",
    category: "transition",
    defaultDurationMs: 700,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "EASE_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "POP",
    label: "Pop",
    category: "transition",
    defaultDurationMs: 850,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "EASE_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "WIPE",
    label: "Wipe",
    category: "transition",
    defaultDurationMs: 850,
    defaultDelayMs: 0,
    defaultDirection: "RIGHT",
    defaultEasing: "EASE_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "BLUR",
    label: "Blur",
    category: "transition",
    defaultDurationMs: 900,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "SUCCESSION",
    label: "Succession",
    category: "transition",
    defaultDurationMs: 950,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "BREATHE",
    label: "Breathe",
    category: "loop",
    defaultDurationMs: 1500,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "BASELINE",
    label: "Baseline",
    category: "loop",
    defaultDurationMs: 1300,
    defaultDelayMs: 0,
    defaultDirection: "UP",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "DRIFT",
    label: "Drift",
    category: "transition",
    defaultDurationMs: 900,
    defaultDelayMs: 0,
    defaultDirection: "RIGHT",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "TECTONIC",
    label: "Tectonic",
    category: "transition",
    defaultDurationMs: 950,
    defaultDelayMs: 0,
    defaultDirection: "RIGHT",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "TUMBLE",
    label: "Tumble",
    category: "transition",
    defaultDurationMs: 950,
    defaultDelayMs: 0,
    defaultDirection: "CLOCKWISE",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "NEON",
    label: "Neon",
    category: "loop",
    defaultDurationMs: 1200,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "SCRAPBOOK",
    label: "Scrapbook",
    category: "loop",
    defaultDurationMs: 1400,
    defaultDelayMs: 0,
    defaultDirection: "LEFT",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "STOMP",
    label: "Stomp",
    category: "transition",
    defaultDurationMs: 900,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "SOFT_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "ROTATE",
    label: "Rotate",
    category: "loop",
    defaultDurationMs: 1800,
    defaultDelayMs: 0,
    defaultDirection: "CLOCKWISE",
    defaultEasing: "LINEAR",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "FLICKER",
    label: "Flicker",
    category: "loop",
    defaultDurationMs: 700,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "LINEAR",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "PULSE",
    label: "Pulse",
    category: "loop",
    defaultDurationMs: 1400,
    defaultDelayMs: 0,
    defaultDirection: "CENTER",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
  {
    value: "WIGGLE",
    label: "Wiggle",
    category: "loop",
    defaultDurationMs: 1400,
    defaultDelayMs: 0,
    defaultDirection: "LEFT",
    defaultEasing: "SOFT_IN_OUT",
    defaultIntensity: 1,
    supportsInfinite: true,
  },
];

export const EDITOR_ANIMATION_OPTIONS = EDITOR_ANIMATION_PRESETS.map(({ value, label }) => ({
  value,
  label,
}));

export const EDITOR_ANIMATION_MODE_OPTIONS: Array<{ value: EditorAnimationMode; label: string }> = [
  { value: "IN", label: "In" },
  { value: "OUT", label: "Out" },
  { value: "LOOP", label: "Loop" },
];

const ANIMATION_TYPE_ALIASES: Record<string, EditorAnimationType> = {
  STATIC: "NONE",
  DISSOLVE: "FADE",
  WIPE_GRADIENT: "TECTONIC",
  SLIDE: "PAN",
  ZOOM: "POP",
  ZOOM_FADE: "SUCCESSION",
  CIRCULAR: "STOMP",
  CIRCULAR_FADE: "STOMP",
  RADIAL: "STOMP",
  RADIAL_GRADIENT: "STOMP",
  SHAKE: "WIGGLE",
  ROTATION: "ROTATE",
  BOUNCE: "BASELINE",
  PULSE_ZOOM: "PULSE",
  HEART_BEAT: "PULSE",
  FLOAT: "BASELINE",
  SPIN: "ROTATE",
  "PULSE ZOOM": "PULSE",
  "RADIAL GRADIENT": "STOMP",
  "ZOOM FADE": "SUCCESSION",
  "WIPE GRADIENT": "TECTONIC",
  "CIRCULAR FADE": "STOMP",
  RISE: "RISE",
  PAN: "PAN",
  FADE: "FADE",
  POP: "POP",
  WIPE: "WIPE",
  BLUR: "BLUR",
  SUCCESSION: "SUCCESSION",
  BREATHE: "BREATHE",
  BASELINE: "BASELINE",
  DRIFT: "DRIFT",
  TECTONIC: "TECTONIC",
  TUMBLE: "TUMBLE",
  NEON: "NEON",
  SCRAPBOOK: "SCRAPBOOK",
  STOMP: "STOMP",
  ROTATE: "ROTATE",
  FLICKER: "FLICKER",
  PULSE: "PULSE",
  WIGGLE: "WIGGLE",
  AERIAL: "STOMP",
  "SLOW REVEAL": "BREATHE",
  "SQUASH AND STRETCH": "PULSE",
  TURN: "ROTATE",
  "DIRECTIONAL SHAKE": "WIGGLE",
  "تلاشي": "FADE",
  "ارتفاع": "RISE",
  "تأرجح": "PAN",
  "ترنح": "PAN",
  "تمويه": "BLUR",
  "المسح": "WIPE",
  "انبثاق": "POP",
  "ظهور بطيء": "BREATHE",
  "التتابع": "SUCCESSION",
  "خط الأساس": "BASELINE",
  "حركة تكتونية": "TECTONIC",
  "انجراف": "DRIFT",
  "دوران": "TUMBLE",
  "سجل قصاصات": "SCRAPBOOK",
  "نيون": "NEON",
  "سقوط هوائي": "STOMP",
  "ومض": "FLICKER",
  "تدوير": "ROTATE",
  "اهتزاز سريع بالاتجاه": "WIGGLE",
  "اهتزاز سريع بالاتجاه...": "WIGGLE",
  "تقلص العنصر وتمدد": "PULSE",
  "تقلص العنصر وتمدد...": "PULSE",
};

const SUPPORTED_ANIMATION_TYPES = new Set<EditorAnimationType>([
  ...EDITOR_ANIMATION_OPTIONS.map((option) => option.value),
  "RANDOM",
  "FLOAT",
  "PULSE",
  "SPIN",
]);

const SUPPORTED_ANIMATION_MODES = new Set<EditorAnimationMode>(["IN", "OUT", "LOOP"]);

export function normalizeAnimationType(value: unknown): EditorAnimationType {
  const raw = String(value || "").trim();
  if (!raw) return "NONE";
  const normalized = raw.toUpperCase().replace(/-/g, "_");
  if (ANIMATION_TYPE_ALIASES[normalized]) {
    return ANIMATION_TYPE_ALIASES[normalized];
  }
  return SUPPORTED_ANIMATION_TYPES.has(normalized as EditorAnimationType)
    ? (normalized as EditorAnimationType)
    : "NONE";
}

export function normalizeAnimationMode(value: unknown): EditorAnimationMode {
  const normalized = String(value || "").trim().toUpperCase();
  return SUPPORTED_ANIMATION_MODES.has(normalized as EditorAnimationMode)
    ? (normalized as EditorAnimationMode)
    : "IN";
}

export function normalizeAnimationInfinite(value: unknown, fallbackMode?: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return normalizeAnimationMode(fallbackMode) === "LOOP";
}

export function normalizeAnimationDurationMs(value: unknown) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_ANIMATION_DURATION_MS;
  return Math.max(
    MIN_ANIMATION_DURATION_MS,
    Math.min(MAX_ANIMATION_DURATION_MS, Math.round(raw))
  );
}

const SUPPORTED_ANIMATION_DIRECTIONS = new Set<EditorAnimationDirection>([
  "LEFT",
  "RIGHT",
  "UP",
  "DOWN",
  "CENTER",
  "CLOCKWISE",
  "COUNTERCLOCKWISE",
]);

const SUPPORTED_ANIMATION_EASINGS = new Set<EditorAnimationEasing>([
  "LINEAR",
  "EASE_OUT",
  "EASE_IN_OUT",
  "SOFT_OUT",
  "SOFT_IN_OUT",
]);

export function getAnimationPreset(value: unknown) {
  const normalized = normalizeAnimationType(value);
  return (
    EDITOR_ANIMATION_PRESETS.find((preset) => preset.value === normalized) ||
    EDITOR_ANIMATION_PRESETS[0]
  );
}

export function normalizeAnimationDelayMs(value: unknown) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_ANIMATION_DELAY_MS;
  return Math.max(0, Math.min(MAX_ANIMATION_DURATION_MS, Math.round(raw)));
}

export function normalizeAnimationDirection(
  value: unknown,
  fallbackType?: unknown
): EditorAnimationDirection {
  const normalized = String(value || "").trim().toUpperCase().replace(/-/g, "_");
  if (SUPPORTED_ANIMATION_DIRECTIONS.has(normalized as EditorAnimationDirection)) {
    return normalized as EditorAnimationDirection;
  }
  return getAnimationPreset(fallbackType).defaultDirection;
}

export function normalizeAnimationEasing(
  value: unknown,
  fallbackType?: unknown
): EditorAnimationEasing {
  const normalized = String(value || "").trim().toUpperCase().replace(/-/g, "_");
  if (SUPPORTED_ANIMATION_EASINGS.has(normalized as EditorAnimationEasing)) {
    return normalized as EditorAnimationEasing;
  }
  return getAnimationPreset(fallbackType).defaultEasing;
}

export function normalizeAnimationIntensity(value: unknown) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_ANIMATION_INTENSITY;
  return Math.max(0.4, Math.min(2.4, Math.round(raw * 100) / 100));
}

export function labelForAnimationType(value: unknown) {
  const normalized = normalizeAnimationType(value);
  return EDITOR_ANIMATION_OPTIONS.find((option) => option.value === normalized)?.label || "None";
}

function hasPreviewTimelineContent(
  timeline:
    | {
        enabled?: boolean | null;
        preview?: {
          url?: string | null;
          status?: string | null;
        } | null;
        source?: {
          animatedImport?: boolean | null;
        } | null;
      }
    | null
    | undefined
) {
  const previewUrl = String(timeline?.preview?.url || "").trim();
  if (previewUrl) return true;
  const previewStatus = String(timeline?.preview?.status || "").trim().toLowerCase();
  if (previewStatus === "queued" || previewStatus === "processing" || previewStatus === "ready") {
    return true;
  }
  return timeline?.source?.animatedImport === true;
}

export function getPageDurationMs(page: { durationMs?: number | null } | null | undefined) {
  const raw = Number(page?.durationMs);
  const elements = Array.isArray((page as { elements?: unknown[] } | null | undefined)?.elements)
    ? ((page as { elements?: unknown[] }).elements as Array<{
        type?: unknown;
        videoDuration?: unknown;
        videoEnd?: unknown;
        frameContent?: { kind?: unknown; videoDuration?: unknown; videoEnd?: unknown } | null;
      }>)
    : [];
  const longestVideoDurationMs = elements.reduce((maxDurationMs, element) => {
    const type = String(element?.type || "").trim().toLowerCase();
    const frameKind = String(element?.frameContent?.kind || "").trim().toLowerCase();
    const rawSeconds =
      type === "video"
        ? Number.isFinite(Number(element?.videoEnd)) && Number(element?.videoEnd) > 0
          ? Number(element?.videoEnd)
          : Number(element?.videoDuration || 0)
        : frameKind === "video"
          ? Number.isFinite(Number(element?.frameContent?.videoEnd)) && Number(element?.frameContent?.videoEnd) > 0
            ? Number(element?.frameContent?.videoEnd)
            : Number(element?.frameContent?.videoDuration || 0)
          : 0;
    const nextDurationMs =
      Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.round(rawSeconds * 1000) : 0;
    return Math.max(maxDurationMs, nextDurationMs);
  }, 0);
  if (longestVideoDurationMs > 0) {
    return Math.max(MIN_LAYER_DURATION_MS, longestVideoDurationMs);
  }
  return Math.max(
    MIN_LAYER_DURATION_MS,
    Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_PAGE_DURATION_MS
  );
}

export function clampTimelineWindow(
  startMs: unknown,
  endMs: unknown,
  pageDurationMs: number
) {
  const duration = Math.max(MIN_LAYER_DURATION_MS, Math.round(pageDurationMs || DEFAULT_PAGE_DURATION_MS));
  const safeStart = Number.isFinite(Number(startMs)) ? Math.max(0, Math.round(Number(startMs))) : 0;
  const safeEnd = Number.isFinite(Number(endMs)) ? Math.round(Number(endMs)) : duration;
  const nextStart = Math.min(safeStart, Math.max(0, duration - MIN_LAYER_DURATION_MS));
  const nextEnd = Math.max(nextStart + MIN_LAYER_DURATION_MS, Math.min(duration, safeEnd));
  return {
    startMs: nextStart,
    endMs: nextEnd,
  };
}

export function resolveTimelineWindow(
  element: { timelineStartMs?: number | null; timelineEndMs?: number | null } | null | undefined,
  pageDurationMs: number
) {
  return clampTimelineWindow(element?.timelineStartMs, element?.timelineEndMs, pageDurationMs);
}

export function hasAnimatedElementContent(
  element:
    | {
        type?: unknown;
        mediaAnimationType?: unknown;
        timelineStartMs?: number | null;
        timelineEndMs?: number | null;
        videoDuration?: unknown;
        videoEnd?: unknown;
        frameContent?: { kind?: unknown; videoDuration?: unknown; videoEnd?: unknown } | null;
      }
    | null
    | undefined,
  pageDurationMs: number
) {
  if (!element) return false;
  const elementType = String(element.type || "").trim().toLowerCase();
  const frameContentKind = String(element.frameContent?.kind || "").trim().toLowerCase();
  if (elementType === "video" || frameContentKind === "video") return true;
  if (normalizeAnimationType(element.mediaAnimationType) !== "NONE") return true;
  const window = resolveTimelineWindow(element, pageDurationMs);
  return window.startMs > 0 || window.endMs < pageDurationMs;
}

export function hasAnimatedPageContent<
  TPage extends {
    durationMs?: number | null;
    elements?: Array<{
      mediaAnimationType?: unknown;
      timelineStartMs?: number | null;
      timelineEndMs?: number | null;
      type?: unknown;
      videoDuration?: unknown;
      videoEnd?: unknown;
      frameContent?: { kind?: unknown; videoDuration?: unknown; videoEnd?: unknown } | null;
    }> | null;
  },
>(page: TPage | null | undefined) {
  if (!page) return false;
  const pageDurationMs = getPageDurationMs(page);
  if (pageDurationMs !== DEFAULT_PAGE_DURATION_MS) return true;
  const elements = Array.isArray(page.elements) ? page.elements : [];
  return elements.some((element) => hasAnimatedElementContent(element, pageDurationMs));
}

export function hasAnimatedTemplateContent<
  TPage extends {
    durationMs?: number | null;
    elements?: Array<{
      mediaAnimationType?: unknown;
      timelineStartMs?: number | null;
      timelineEndMs?: number | null;
    }> | null;
  },
>(
  pages: TPage[],
  timeline?:
    | {
        enabled?: boolean | null;
        preview?: {
          url?: string | null;
          status?: string | null;
        } | null;
        source?: {
          animatedImport?: boolean | null;
        } | null;
      }
    | null
) {
  if (hasPreviewTimelineContent(timeline)) return true;
  return (Array.isArray(pages) ? pages : []).some((page) => hasAnimatedPageContent(page));
}

export function isElementVisibleAtPlayhead(
  element: { visible?: boolean; timelineStartMs?: number | null; timelineEndMs?: number | null } | null | undefined,
  playheadMs: number,
  pageDurationMs: number
) {
  if (!element || element.visible === false) return false;
  const window = resolveTimelineWindow(element, pageDurationMs);
  return playheadMs >= window.startMs && playheadMs < window.endMs;
}

export interface TimelinePageEntry<TPage> {
  page: TPage;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export function getTimelinePageEntries<TPage extends { durationMs?: number | null }>(pages: TPage[]) {
  let cursor = 0;
  return pages.map((page) => {
    const durationMs = getPageDurationMs(page);
    const entry: TimelinePageEntry<TPage> = {
      page,
      startMs: cursor,
      endMs: cursor + durationMs,
      durationMs,
    };
    cursor += durationMs;
    return entry;
  });
}

export function getTotalTimelineDurationMs<TPage extends { durationMs?: number | null }>(pages: TPage[]) {
  return getTimelinePageEntries(pages).reduce((sum, entry) => sum + entry.durationMs, 0);
}

export function findTimelinePageEntryAtPlayhead<TPage extends { durationMs?: number | null }>(
  pages: TPage[],
  playheadMs: number
) {
  const entries = getTimelinePageEntries(pages);
  if (entries.length === 0) return null;
  const safePlayhead = Math.max(0, playheadMs);
  return (
    entries.find((entry) => safePlayhead >= entry.startMs && safePlayhead < entry.endMs) ||
    entries[entries.length - 1]
  );
}

export function clampTimelinePlayheadMs<TPage extends { durationMs?: number | null }>(
  playheadMs: number,
  pages: TPage[]
) {
  const totalDurationMs = getTotalTimelineDurationMs(pages);
  if (totalDurationMs <= 0) return 0;
  return Math.max(0, Math.min(totalDurationMs, playheadMs));
}

export function formatTimelineTime(playheadMs: number, withCentiseconds = false) {
  const totalMs = Math.max(0, Math.floor(playheadMs || 0));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!withCentiseconds) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  const centiseconds = Math.floor((totalMs % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}
