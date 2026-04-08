"use client";

import { create } from "zustand";
import {
  DEFAULT_EDITOR_FONT_FAMILIES,
  mergeFontFamilies,
  normalizeFontFamilyName,
} from "@/lib/editor/fonts";
import {
  DEFAULT_ANIMATION_DURATION_MS,
  DEFAULT_PAGE_DURATION_MS,
  DEFAULT_TIMELINE_FPS,
  clampTimelinePlayheadMs,
  clampTimelineWindow,
  getPageDurationMs,
  getTotalTimelineDurationMs,
  hasAnimatedTemplateContent,
  normalizeAnimationDelayMs,
  normalizeAnimationDirection,
  normalizeAnimationEasing,
  normalizeAnimationDurationMs,
  normalizeAnimationInfinite,
  normalizeAnimationIntensity,
  normalizeAnimationMode,
  normalizeAnimationType,
  type EditorAnimationDirection,
  type EditorAnimationEasing,
  type EditorAnimationMode,
  type EditorAnimationType,
} from "@/lib/editor/animationTimeline";
import {
  DEFAULT_FRAME_CONTENT_TRANSFORM,
  createFrameShapeFromPreset,
  normalizeFrameContentTransform,
  resolveFramePreset,
  type FrameContent,
  type FrameContentTransform,
  type FrameShape,
} from "@/lib/editor/frames";

export type ToolMode = "select" | "pan" | "draw" | "crop";
export type SidebarTab =
  | "templates"
  | "text"
  | "videos"
  | "shapes"
  | "elements"
  | "frames"
  | "category"
  | "draw"
  | "upload"
  | "backgrounds"
  | "layers"
  | "resize"
  | "animation";
export type ShapeType = "rect" | "circle" | "line" | "arrow" | "star";
export type ElementType = "text" | "image" | "video" | "frame" | ShapeType;
export type AlignType = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DrawTool = "selection" | "brush" | "highlighter";
export type TemplateLifecycleStatus = "draft" | "published";
export type TimelinePreviewStatus = "not_requested" | "queued" | "processing" | "ready" | "failed";

export interface EditorElement {
  id: string;
  pageId: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  blendMode: GlobalCompositeOperation | "source-over";
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  groupId: string | null;
  flipX: boolean;
  flipY: boolean;
  cornerRadius: number;
  points: number[];
  src: string;
  rasterOriginalSrc?: string;
  rasterPalette?: string[];
  rasterPaletteVersion?: number;
  rasterColorMap?: Record<string, string>;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  textDecoration: "" | "underline" | "line-through" | "underline line-through";
  align: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacing: number;
  color: string;
  timelineStartMs?: number;
  timelineEndMs?: number;
  mediaAnimationType?: EditorAnimationType;
  mediaAnimationMode?: EditorAnimationMode;
  mediaAnimationInfinite?: boolean;
  mediaAnimationDurationMs?: number;
  mediaAnimationDelayMs?: number;
  mediaAnimationDirection?: EditorAnimationDirection;
  mediaAnimationEasing?: EditorAnimationEasing;
  mediaAnimationIntensity?: number;
  sourceAnimationName?: string;
  sourceAnimationLabel?: string;
  videoStart?: number;
  videoEnd?: number;
  videoDuration?: number;
  frameShape?: FrameShape;
  frameContent?: FrameContent | null;
  frameContentTransform?: FrameContentTransform;
  sourceWidth?: number;
  sourceHeight?: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  isBackgroundLayer?: boolean;
  importNodeId?: string;
  importParentId?: string | null;
  importKind?: string;
  importZIndex?: number;
  sourceAssetId?: string;
  titleEn?: string;
  titleAr?: string;
  tagsEn?: string[];
  tagsAr?: string[];
  labelsEn?: string[];
  labelsAr?: string[];
  fallback?: boolean;
  fallbackReason?: string;
  syntheticTextBackground?: boolean;
}

export interface PageBackground {
  type: "color" | "gradient" | "image";
  color: string;
  gradientFrom: string;
  gradientTo: string;
  imageUri?: string;
  imageThumbnailUri?: string;
  sourceAssetId?: string;
  categoryValue?: string;
}

export interface EditorPage {
  id: string;
  name: string;
  width: number;
  height: number;
  durationMs?: number;
  background: PageBackground;
  elements: EditorElement[];
}

export interface EditorTimelinePreview {
  status: TimelinePreviewStatus;
  url?: string | null;
  posterUrl?: string | null;
  generatedAt?: string | null;
  error?: string | null;
}

export interface EditorTimelineSourceMeta {
  origin: "manual" | "canva";
  animatedImport: boolean;
}

export interface EditorTimeline {
  enabled: boolean;
  fps: number;
  totalDurationMs: number;
  preview: EditorTimelinePreview;
  source?: EditorTimelineSourceMeta;
}

export interface EditorDesign {
  version: number;
  activePageId: string;
  timeline?: EditorTimeline;
  pages: EditorPage[];
}

export interface EditorTemplatePreset {
  id: string;
  name: string;
  thumbnail: string;
  page: EditorPage;
}

interface StageApi {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToScreen: () => void;
  exportPng: () => void;
  captureThumbnailDataUrl: () => string;
  mergeSelectedLayers: () => Promise<{ merged: boolean; message?: string }>;
}

interface UpdateOptions {
  recordHistory?: boolean;
}

interface MergeSelectionPayload {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}

interface EditorClipboard {
  elements: EditorElement[];
  pasteCount: number;
}

interface TemplateMetaPatch {
  id?: string;
  name?: string;
  status?: TemplateLifecycleStatus;
  category?: string;
  subCategory?: string;
  tags?: string[];
}

interface EditorStore {
  pages: EditorPage[];
  activePageId: string;
  designTimeline: EditorTimeline;
  timelinePlayheadMs: number;
  timelineIsPlaying: boolean;
  selectedIds: string[];
  publishCandidateIds: string[];
  importedElementsRefreshKey: number;
  clipboard: EditorClipboard | null;
  availableFontFamilies: string[];
  activeTemplateId: string;
  activeTemplateName: string;
  activeTemplateStatus: TemplateLifecycleStatus;
  activeTemplateCategory: string;
  activeTemplateSubCategory: string;
  activeTemplateTags: string[];
  sidebarTab: SidebarTab;
  toolMode: ToolMode;
  zoomPercent: number;
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  drawTool: DrawTool;
  drawStrokeWidth: number;
  drawColor: string;
  drawOpacity: number;
  resizeUseMagic: boolean;
  history: string[];
  historyIndex: number;
  stageApi: StageApi | null;

  setStageApi: (api: StageApi | null) => void;
  setZoomPercent: (zoomPercent: number) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setToolMode: (mode: ToolMode) => void;
  setShowLeftSidebar: (show: boolean) => void;
  setShowRightSidebar: (show: boolean) => void;
  setDrawTool: (tool: DrawTool) => void;
  setDrawStrokeWidth: (value: number) => void;
  setDrawColor: (value: string) => void;
  setDrawOpacity: (value: number) => void;
  setResizeUseMagic: (value: boolean) => void;
  updateTimeline: (patch: Partial<EditorTimeline>, options?: UpdateOptions) => void;
  setTimelinePlayheadMs: (value: number) => void;
  setTimelinePlaying: (value: boolean) => void;
  toggleTimelinePlaying: () => void;

  setSelectedIds: (ids: string[]) => void;
  setPublishCandidateIds: (ids: string[]) => void;
  togglePublishCandidate: (id: string) => void;
  clearPublishCandidates: () => void;
  bumpImportedElementsRefreshKey: () => void;
  clearSelection: () => void;
  registerFontFamilies: (fontFamilies: string[]) => void;
  setTemplateMeta: (meta: TemplateMetaPatch) => void;
  clearTemplateMeta: () => void;

  addTextElement: (text: string, partial?: Partial<EditorElement>) => string;
  addShapeElement: (shape: ShapeType, partial?: Partial<EditorElement>) => string;
  addImageElement: (src: string, partial?: Partial<EditorElement>) => string;
  addVideoElement: (src: string, partial?: Partial<EditorElement>) => string;
  addFrameElement: (presetId: string, partial?: Partial<EditorElement>) => string;
  addFreehandLine: (points: number[], partial?: Partial<EditorElement>) => string;

  updateElement: (id: string, patch: Partial<EditorElement>, options?: UpdateOptions) => void;
  setFrameContent: (id: string, content: FrameContent, options?: UpdateOptions) => void;
  updateFrameContentTransform: (id: string, patch: Partial<FrameContentTransform>, options?: UpdateOptions) => void;
  clearFrameContent: (id: string, options?: UpdateOptions) => void;
  updateSelectedElements: (patch: Partial<EditorElement>, options?: UpdateOptions) => void;
  deleteElement: (id: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelectedToClipboard: () => boolean;
  pasteFromClipboard: () => string[];
  replaceSelectedWithImageLayer: (payload: MergeSelectionPayload) => string;
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  reorderLayer: (sourceId: string, targetId: string, position: "before" | "after") => void;
  moveLayer: (id: string, direction: "up" | "down" | "front" | "back") => void;
  alignSelected: (align: AlignType) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  flipSelected: (axis: "x" | "y") => void;

  setBackground: (background: Partial<PageBackground>) => void;
  resizeActivePage: (width: number, height: number, options?: { useMagic?: boolean }) => void;

  addPage: () => void;
  duplicatePage: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  reorderPages: (sourceId: string, targetId: string, position: "before" | "after") => void;
  setActivePageId: (pageId: string) => void;
  setActivePageIdSilently: (pageId: string) => void;
  setPageDuration: (pageId: string, durationMs: number, options?: UpdateOptions) => void;

  applyTemplate: (template: EditorTemplatePreset) => void;
  exportDesign: () => string;
  loadDesign: (payload: EditorDesign) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  recordHistory: () => void;
  resetHistory: () => void;
}

const HISTORY_LIMIT = 80;

const FONT_FAMILY_DEFAULT = DEFAULT_EDITOR_FONT_FAMILIES[0] || "Inter";
const DEFAULT_TEMPLATE_CATEGORY = "general";
const DEFAULT_TEMPLATE_SUBCATEGORY = "general";

function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function createDefaultBackground(): PageBackground {
  return {
    type: "color",
    color: "#ffffff",
    gradientFrom: "#ffffff",
    gradientTo: "#f3f4f6",
    imageUri: "",
    imageThumbnailUri: "",
    sourceAssetId: "",
    categoryValue: "",
  };
}

function createDefaultTimelinePreview(): EditorTimelinePreview {
  return {
    status: "not_requested",
    url: null,
    posterUrl: null,
    generatedAt: null,
    error: null,
  };
}

function createDefaultDesignTimeline(
  pages: Array<Pick<EditorPage, "durationMs" | "elements">>,
  partial: Partial<EditorTimeline> = {}
): EditorTimeline {
  return {
    enabled: partial.enabled ?? hasAnimatedTemplateContent(pages, partial),
    fps: Number.isFinite(Number(partial.fps)) && Number(partial.fps) > 0 ? Math.round(Number(partial.fps)) : DEFAULT_TIMELINE_FPS,
    totalDurationMs: getTotalTimelineDurationMs(pages),
    preview: {
      ...createDefaultTimelinePreview(),
      ...(partial.preview || {}),
    },
    ...(partial.source ? { source: { ...partial.source } } : {}),
  };
}

function createBaseElement(pageId: string, partial: Partial<EditorElement> = {}): EditorElement {
  const normalizedFontFamily = normalizeFontFamilyName(partial.fontFamily);
  return {
    id: uid("el"),
    pageId,
    type: partial.type || "rect",
    name: partial.name || "Layer",
    x: partial.x ?? 160,
    y: partial.y ?? 160,
    width: partial.width ?? 280,
    height: partial.height ?? 180,
    rotation: partial.rotation ?? 0,
    scaleX: partial.scaleX ?? 1,
    scaleY: partial.scaleY ?? 1,
    opacity: partial.opacity ?? 1,
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    fill: partial.fill ?? "#3b82f6",
    stroke: partial.stroke ?? "#0f172a",
    strokeWidth: partial.strokeWidth ?? 0,
    blendMode: partial.blendMode ?? "source-over",
    shadowColor: partial.shadowColor ?? "#000000",
    shadowBlur: partial.shadowBlur ?? 0,
    shadowOffsetX: partial.shadowOffsetX ?? 0,
    shadowOffsetY: partial.shadowOffsetY ?? 0,
    groupId: partial.groupId ?? null,
    flipX: partial.flipX ?? false,
    flipY: partial.flipY ?? false,
    cornerRadius: partial.cornerRadius ?? 0,
    points: partial.points ? [...partial.points] : [],
    src: partial.src ?? "",
    text: partial.text ?? "",
    fontFamily: normalizedFontFamily || FONT_FAMILY_DEFAULT,
    fontSize: partial.fontSize ?? 64,
    fontWeight: partial.fontWeight ?? "700",
    fontStyle: partial.fontStyle ?? "normal",
    textDecoration: partial.textDecoration ?? "",
    align: partial.align ?? "left",
    lineHeight: partial.lineHeight ?? 1.1,
    letterSpacing: partial.letterSpacing ?? 0,
    color: partial.color ?? "#111827",
    timelineStartMs: partial.timelineStartMs ?? 0,
    timelineEndMs: partial.timelineEndMs ?? DEFAULT_PAGE_DURATION_MS,
    mediaAnimationType: normalizeAnimationType(partial.mediaAnimationType),
    mediaAnimationMode: normalizeAnimationMode(partial.mediaAnimationMode),
    mediaAnimationInfinite: normalizeAnimationInfinite(
      partial.mediaAnimationInfinite,
      partial.mediaAnimationMode
    ),
    mediaAnimationDurationMs: normalizeAnimationDurationMs(
      partial.mediaAnimationDurationMs ?? DEFAULT_ANIMATION_DURATION_MS
    ),
    mediaAnimationDelayMs: normalizeAnimationDelayMs(partial.mediaAnimationDelayMs),
    mediaAnimationDirection: normalizeAnimationDirection(
      partial.mediaAnimationDirection,
      partial.mediaAnimationType
    ),
    mediaAnimationEasing: normalizeAnimationEasing(
      partial.mediaAnimationEasing,
      partial.mediaAnimationType
    ),
    mediaAnimationIntensity: normalizeAnimationIntensity(partial.mediaAnimationIntensity),
    sourceAnimationName: partial.sourceAnimationName ?? "",
    sourceAnimationLabel: partial.sourceAnimationLabel ?? "",
    videoStart: partial.videoStart ?? 0,
    videoEnd: partial.videoEnd ?? 0,
    videoDuration: partial.videoDuration ?? 0,
    frameShape: partial.frameShape,
    frameContent: partial.frameContent ?? null,
    frameContentTransform: normalizeFrameContentTransform(
      partial.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM
    ),
  };
}

function normalizePageDuration(durationMs: unknown) {
  void durationMs;
  return DEFAULT_PAGE_DURATION_MS;
}

function normalizeTimelinePreview(preview: Partial<EditorTimelinePreview> | null | undefined): EditorTimelinePreview {
  return {
    ...createDefaultTimelinePreview(),
    ...(preview || {}),
  };
}

function normalizeElementForEditor(
  element: EditorElement,
  pageDurationMs: number
): EditorElement {
  const timelineWindow = clampTimelineWindow(element.timelineStartMs, element.timelineEndMs, pageDurationMs);
  return {
    ...element,
    ...(element.type === "text"
      ? { fontFamily: normalizeFontFamilyName(element.fontFamily) || FONT_FAMILY_DEFAULT }
      : {}),
    timelineStartMs: timelineWindow.startMs,
    timelineEndMs: timelineWindow.endMs,
    mediaAnimationType: normalizeAnimationType(element.mediaAnimationType),
    mediaAnimationMode: normalizeAnimationMode(element.mediaAnimationMode),
    mediaAnimationInfinite: normalizeAnimationInfinite(
      element.mediaAnimationInfinite,
      element.mediaAnimationMode
    ),
    mediaAnimationDurationMs: normalizeAnimationDurationMs(element.mediaAnimationDurationMs),
    mediaAnimationDelayMs: normalizeAnimationDelayMs(element.mediaAnimationDelayMs),
    mediaAnimationDirection: normalizeAnimationDirection(
      element.mediaAnimationDirection,
      element.mediaAnimationType
    ),
    mediaAnimationEasing: normalizeAnimationEasing(
      element.mediaAnimationEasing,
      element.mediaAnimationType
    ),
    mediaAnimationIntensity: normalizeAnimationIntensity(element.mediaAnimationIntensity),
    sourceAnimationName: String(element.sourceAnimationName || ""),
    sourceAnimationLabel: String(element.sourceAnimationLabel || ""),
    ...(element.type === "frame"
      ? {
        frameShape:
          element.frameShape ||
          createFrameShapeFromPreset("frame-circle"),
          frameContent: element.frameContent || null,
          frameContentTransform: normalizeFrameContentTransform(
            element.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM
          ),
        }
      : {}),
  };
}

function normalizePageForEditor(page: EditorPage): EditorPage {
  const durationMs = normalizePageDuration(page.durationMs);
  return {
    ...page,
    durationMs,
    elements: Array.isArray(page.elements)
      ? page.elements.map((element) => normalizeElementForEditor(element, durationMs))
      : [],
  };
}

function collectFontFamiliesFromPages(pages: EditorPage[]) {
  if (!Array.isArray(pages)) return [];
  const values: string[] = [];
  pages.forEach((page) => {
    if (!page || !Array.isArray(page.elements)) return;
    page.elements.forEach((element) => {
      if (element?.type !== "text") return;
      values.push(String(element.fontFamily || ""));
    });
  });
  return mergeFontFamilies([], values);
}

function normalizeTemplateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const normalized = tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => tag.toLowerCase());
  return Array.from(new Set(normalized));
}

function normalizeElementTypeName(type: ElementType) {
  if (type === "text") return "Text";
  if (type === "image") return "Image";
  if (type === "video") return "Video";
  if (type === "frame") return "Frame";
  if (type === "rect") return "Rectangle";
  if (type === "circle") return "Circle";
  if (type === "line") return "Line";
  if (type === "arrow") return "Arrow";
  return "Star";
}

function createBlankPage(name = "Page 1"): EditorPage {
  const pageId = uid("page");
  return {
    id: pageId,
    name,
    width: 1080,
    height: 1350,
    durationMs: DEFAULT_PAGE_DURATION_MS,
    background: createDefaultBackground(),
    elements: [
      {
        ...createBaseElement(pageId, {
          type: "text",
          name: "Heading",
          x: 120,
          y: 120,
          width: 760,
          height: 180,
          text: "Design anything",
          fontSize: 108,
          fontWeight: "800",
          color: "#111827",
          fill: "#111827",
          timelineEndMs: DEFAULT_PAGE_DURATION_MS,
        }),
      },
    ],
  };
}

function serializeHistorySnapshot(pages: EditorPage[], activePageId: string, designTimeline: EditorTimeline) {
  return JSON.stringify({
    activePageId,
    timeline: {
      ...designTimeline,
      totalDurationMs: getTotalTimelineDurationMs(pages),
    },
    pages,
  });
}

function deserializeHistorySnapshot(
  snapshot: string
): Pick<EditorStore, "pages" | "activePageId" | "designTimeline"> | null {
  try {
    const parsed = JSON.parse(snapshot) as {
      activePageId?: string;
      pages?: EditorPage[];
      timeline?: Partial<EditorTimeline>;
    };
    if (!Array.isArray(parsed.pages) || typeof parsed.activePageId !== "string") return null;
    const normalizedPages = parsed.pages.map((page) => normalizePageForEditor(page));
    return {
      pages: normalizedPages,
      activePageId: parsed.activePageId,
      designTimeline: createDefaultDesignTimeline(normalizedPages, {
        ...(parsed.timeline || {}),
        preview: normalizeTimelinePreview(parsed.timeline?.preview),
      }),
    };
  } catch {
    return null;
  }
}

function mutateActivePage(state: EditorStore, updater: (page: EditorPage) => EditorPage): EditorPage[] {
  return state.pages.map((page) => {
    if (page.id !== state.activePageId) return page;
    return updater(page);
  });
}

function findActivePage(state: EditorStore): EditorPage | null {
  return state.pages.find((page) => page.id === state.activePageId) || null;
}

function elementIndexById(page: EditorPage, elementId: string) {
  return page.elements.findIndex((item) => item.id === elementId);
}

export function isBackgroundLayerElement(
  element: Partial<EditorElement> | null | undefined,
  page: Pick<EditorPage, "width" | "height"> | null | undefined
) {
  if (!element || !page) return false;
  if (element.isBackgroundLayer === true) return true;

  const name = String(element.name || "").trim().toLowerCase();
  if (name === "background" || name.startsWith("background ")) return true;
  return false;
}

function scalePoints(points: number[], scaleX: number, scaleY: number) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const next: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    next.push((points[index] || 0) * scaleX);
    next.push((points[index + 1] || 0) * scaleY);
  }
  return next;
}

function scaleElementForResize(element: EditorElement, scaleX: number, scaleY: number): EditorElement {
  return {
    ...element,
    x: element.x * scaleX,
    y: element.y * scaleY,
    width: Math.max(1, element.width * scaleX),
    height: Math.max(1, element.height * scaleY),
    points:
      element.type === "line" || element.type === "arrow"
        ? scalePoints(element.points, scaleX, scaleY)
        : element.points,
  };
}

const initialPage = createBlankPage();
const initialTimeline = createDefaultDesignTimeline([initialPage]);
const initialSnapshot = serializeHistorySnapshot([initialPage], initialPage.id, initialTimeline);

export const useEditorStore = create<EditorStore>((set, get) => ({
  pages: [initialPage],
  activePageId: initialPage.id,
  designTimeline: initialTimeline,
  timelinePlayheadMs: 0,
  timelineIsPlaying: false,
  selectedIds: [],
  publishCandidateIds: [],
  importedElementsRefreshKey: 0,
  clipboard: null,
  availableFontFamilies: [...DEFAULT_EDITOR_FONT_FAMILIES],
  activeTemplateId: "",
  activeTemplateName: "",
  activeTemplateStatus: "draft",
  activeTemplateCategory: DEFAULT_TEMPLATE_CATEGORY,
  activeTemplateSubCategory: DEFAULT_TEMPLATE_SUBCATEGORY,
  activeTemplateTags: [],
  sidebarTab: "templates",
  toolMode: "select",
  zoomPercent: 100,
  showLeftSidebar: true,
  showRightSidebar: false,
  drawTool: "selection",
  drawStrokeWidth: 5,
  drawColor: "#111827",
  drawOpacity: 1,
  resizeUseMagic: true,
  history: [initialSnapshot],
  historyIndex: 0,
  stageApi: null,

  setStageApi: (stageApi) => set({ stageApi }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent: clamp(Math.round(zoomPercent), 10, 400) }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setToolMode: (toolMode) => set({ toolMode }),
  setShowLeftSidebar: (showLeftSidebar) => set({ showLeftSidebar }),
  setShowRightSidebar: (showRightSidebar) => set({ showRightSidebar }),
  setDrawTool: (drawTool) => set({ drawTool }),
  setDrawStrokeWidth: (drawStrokeWidth) => set({ drawStrokeWidth: clamp(drawStrokeWidth, 1, 120) }),
  setDrawColor: (drawColor) => set({ drawColor }),
  setDrawOpacity: (drawOpacity) => set({ drawOpacity: clamp(drawOpacity, 0.05, 1) }),
  setResizeUseMagic: (resizeUseMagic) => set({ resizeUseMagic }),
  updateTimeline: (patch, options = {}) => {
    set((state) => {
      const nextTimeline = createDefaultDesignTimeline(state.pages, {
        ...state.designTimeline,
        ...patch,
        preview: normalizeTimelinePreview({
          ...state.designTimeline.preview,
          ...(patch.preview || {}),
        }),
      });
      return {
        designTimeline: nextTimeline,
      };
    });
    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },
  setTimelinePlayheadMs: (timelinePlayheadMs) =>
    set((state) => ({
      timelinePlayheadMs: clampTimelinePlayheadMs(Math.round(Number(timelinePlayheadMs) || 0), state.pages),
    })),
  setTimelinePlaying: (timelineIsPlaying) => set({ timelineIsPlaying: Boolean(timelineIsPlaying) }),
  toggleTimelinePlaying: () =>
    set((state) => {
      const totalDurationMs = getTotalTimelineDurationMs(state.pages);
      if (totalDurationMs <= 0) return { timelineIsPlaying: false, timelinePlayheadMs: 0 };
      const nextPlayheadMs =
        state.timelinePlayheadMs >= totalDurationMs ? 0 : clampTimelinePlayheadMs(state.timelinePlayheadMs, state.pages);
      return {
        timelineIsPlaying: !state.timelineIsPlaying,
        timelinePlayheadMs: nextPlayheadMs,
      };
    }),

  setSelectedIds: (selectedIds) => set({ selectedIds }),
  setPublishCandidateIds: (publishCandidateIds) =>
    set({
      publishCandidateIds: Array.from(
        new Set(
          (Array.isArray(publishCandidateIds) ? publishCandidateIds : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )
      ),
    }),
  togglePublishCandidate: (id) =>
    set((state) => {
      const targetId = String(id || "").trim();
      if (!targetId) return state;
      const next = new Set(state.publishCandidateIds);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      return { publishCandidateIds: Array.from(next) };
    }),
  clearPublishCandidates: () => set({ publishCandidateIds: [] }),
  bumpImportedElementsRefreshKey: () =>
    set((state) => ({ importedElementsRefreshKey: state.importedElementsRefreshKey + 1 })),
  clearSelection: () => set({ selectedIds: [] }),
  registerFontFamilies: (fontFamilies) =>
    set((state) => ({
      availableFontFamilies: mergeFontFamilies(state.availableFontFamilies, fontFamilies),
    })),
  setTemplateMeta: (meta) =>
    set((state) => ({
      activeTemplateId:
        typeof meta.id === "string" ? meta.id.trim() : state.activeTemplateId,
      activeTemplateName:
        typeof meta.name === "string" ? meta.name.trim() : state.activeTemplateName,
      activeTemplateStatus:
        meta.status === "published" || meta.status === "draft"
          ? meta.status
          : state.activeTemplateStatus,
      activeTemplateCategory:
        typeof meta.category === "string" && meta.category.trim()
          ? meta.category.trim().toLowerCase()
          : state.activeTemplateCategory,
      activeTemplateSubCategory:
        typeof meta.subCategory === "string" && meta.subCategory.trim()
          ? meta.subCategory.trim().toLowerCase()
          : state.activeTemplateSubCategory,
      activeTemplateTags:
        typeof meta.tags !== "undefined"
          ? normalizeTemplateTags(meta.tags)
          : state.activeTemplateTags,
    })),
  clearTemplateMeta: () =>
    set({
      activeTemplateId: "",
      activeTemplateName: "",
      activeTemplateStatus: "draft",
      activeTemplateCategory: DEFAULT_TEMPLATE_CATEGORY,
      activeTemplateSubCategory: DEFAULT_TEMPLATE_SUBCATEGORY,
      activeTemplateTags: [],
    }),

  addTextElement: (text, partial = {}) => {
    const state = get();
    const page = findActivePage(state);
    if (!page) return "";

    const element = {
      ...createBaseElement(page.id, {
        type: "text",
        name: partial.name || "Text",
        x: partial.x ?? page.width * 0.18,
        y: partial.y ?? page.height * 0.25,
        width: partial.width ?? page.width * 0.66,
        height: partial.height ?? 180,
        fill: partial.fill || "#111827",
        color: partial.color || "#111827",
        text,
        fontSize: partial.fontSize ?? 96,
        fontWeight: partial.fontWeight || "700",
        fontFamily: normalizeFontFamilyName(partial.fontFamily) || FONT_FAMILY_DEFAULT,
        align: partial.align || "left",
        timelineEndMs: partial.timelineEndMs ?? getPageDurationMs(page),
      }),
      ...partial,
    } as EditorElement;

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, element],
      })),
      selectedIds: [element.id],
      availableFontFamilies: mergeFontFamilies(prev.availableFontFamilies, [element.fontFamily]),
    }));

    get().recordHistory();
    return element.id;
  },

  addShapeElement: (shape, partial = {}) => {
    const state = get();
    const page = findActivePage(state);
    if (!page) return "";

    const base: Partial<EditorElement> = {
      type: shape,
      name: partial.name || normalizeElementTypeName(shape),
      x: partial.x ?? page.width * 0.28,
      y: partial.y ?? page.height * 0.3,
      width: partial.width ?? 260,
      height: partial.height ?? 180,
      fill: partial.fill || (shape === "line" || shape === "arrow" ? "#111827" : "#3b82f6"),
      stroke: partial.stroke || "#1e293b",
      strokeWidth: partial.strokeWidth ?? (shape === "line" || shape === "arrow" ? 6 : 0),
      timelineEndMs: partial.timelineEndMs ?? getPageDurationMs(page),
      points:
        partial.points ||
        (shape === "line" || shape === "arrow"
          ? [0, 0, partial.width ?? 220, partial.height ?? 0]
          : []),
    };

    const element = {
      ...createBaseElement(page.id, base),
      ...partial,
    } as EditorElement;

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, element],
      })),
      selectedIds: [element.id],
    }));

    get().recordHistory();
    return element.id;
  },

  addImageElement: (src, partial = {}) => {
    const state = get();
    const page = findActivePage(state);
    if (!page || !src) return "";

    const element = {
      ...createBaseElement(page.id, {
        type: "image",
        name: partial.name || "Image",
        x: partial.x ?? page.width * 0.18,
        y: partial.y ?? page.height * 0.2,
        width: partial.width ?? page.width * 0.64,
        height: partial.height ?? page.height * 0.46,
        fill: "#e5e7eb",
        src,
        timelineEndMs: partial.timelineEndMs ?? getPageDurationMs(page),
      }),
      ...partial,
      src,
      type: "image",
    } as EditorElement;

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, element],
      })),
      selectedIds: [element.id],
    }));

    get().recordHistory();
    return element.id;
  },

  addVideoElement: (src, partial = {}) => {
    const state = get();
    const page = findActivePage(state);
    if (!page || !src) return "";

    const element = {
      ...createBaseElement(page.id, {
        type: "video",
        name: partial.name || "Video",
        x: partial.x ?? page.width * 0.18,
        y: partial.y ?? page.height * 0.2,
        width: partial.width ?? page.width * 0.64,
        height: partial.height ?? page.height * 0.46,
        fill: "#0f172a",
        src,
        videoStart: partial.videoStart ?? 0,
        videoEnd: partial.videoEnd ?? 0,
        videoDuration: partial.videoDuration ?? 0,
        timelineEndMs: partial.timelineEndMs ?? getPageDurationMs(page),
      }),
      ...partial,
      src,
      type: "video",
    } as EditorElement;

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, element],
      })),
      selectedIds: [element.id],
    }));

    get().recordHistory();
    return element.id;
  },

  addFrameElement: (presetId, partial = {}) => {
    const state = get();
    const page = findActivePage(state);
    if (!page) return "";

    const preset = resolveFramePreset(presetId);
    const targetWidth = Math.min(page.width * 0.46, Math.max(160, preset.width * 1.35));
    const targetHeight = targetWidth * (preset.height / Math.max(1, preset.width));
    const element = {
      ...createBaseElement(page.id, {
        type: "frame",
        name: partial.name || preset.name,
        x: partial.x ?? (page.width - targetWidth) / 2,
        y: partial.y ?? (page.height - targetHeight) / 2,
        width: partial.width ?? targetWidth,
        height: partial.height ?? targetHeight,
        fill: partial.fill || "#edf7ff",
        stroke: partial.stroke || "#94a3b8",
        strokeWidth: partial.strokeWidth ?? 2,
        frameShape: partial.frameShape || createFrameShapeFromPreset(preset.id),
        frameContent: partial.frameContent ?? null,
        frameContentTransform: normalizeFrameContentTransform(
          partial.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM
        ),
        timelineEndMs: partial.timelineEndMs ?? getPageDurationMs(page),
      }),
      ...partial,
      type: "frame",
      frameShape: partial.frameShape || createFrameShapeFromPreset(preset.id),
      frameContent: partial.frameContent ?? null,
      frameContentTransform: normalizeFrameContentTransform(
        partial.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM
      ),
    } as EditorElement;

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, element],
      })),
      selectedIds: [element.id],
    }));

    get().recordHistory();
    return element.id;
  },

  addFreehandLine: (points, partial = {}) => {
    if (!Array.isArray(points) || points.length < 4) return "";
    const page = findActivePage(get());
    if (!page) return "";

    const element = {
      ...createBaseElement(page.id, {
        type: "line",
        name: partial.name || "Draw",
        x: partial.x ?? 0,
        y: partial.y ?? 0,
        width: partial.width ?? 0,
        height: partial.height ?? 0,
        points,
        fill: partial.fill || "#111827",
        stroke: partial.stroke || "#111827",
        strokeWidth: partial.strokeWidth ?? 4,
        timelineEndMs: partial.timelineEndMs ?? getPageDurationMs(page),
      }),
      ...partial,
      points,
    } as EditorElement;

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, element],
      })),
      selectedIds: [element.id],
    }));

    get().recordHistory();
    return element.id;
  },

  updateElement: (id, patch, options = {}) => {
    if (!id) return;
    set((state) => {
      const activePage = findActivePage(state);
      const pageDurationMs = getPageDurationMs(activePage);
      const normalizedPatch = {
        ...patch,
        ...(typeof patch.fontFamily !== "undefined"
          ? { fontFamily: normalizeFontFamilyName(patch.fontFamily) || FONT_FAMILY_DEFAULT }
          : {}),
        ...(typeof patch.mediaAnimationType !== "undefined"
          ? { mediaAnimationType: normalizeAnimationType(patch.mediaAnimationType) }
          : {}),
        ...(typeof patch.mediaAnimationMode !== "undefined"
          ? { mediaAnimationMode: normalizeAnimationMode(patch.mediaAnimationMode) }
          : {}),
        ...(typeof patch.mediaAnimationInfinite !== "undefined"
          ? {
              mediaAnimationInfinite: normalizeAnimationInfinite(
                patch.mediaAnimationInfinite,
                patch.mediaAnimationMode
              ),
            }
          : {}),
        ...(typeof patch.mediaAnimationDurationMs !== "undefined"
          ? { mediaAnimationDurationMs: normalizeAnimationDurationMs(patch.mediaAnimationDurationMs) }
          : {}),
        ...(typeof patch.mediaAnimationDelayMs !== "undefined"
          ? { mediaAnimationDelayMs: normalizeAnimationDelayMs(patch.mediaAnimationDelayMs) }
          : {}),
        ...(typeof patch.mediaAnimationDirection !== "undefined"
          ? {
              mediaAnimationDirection: normalizeAnimationDirection(
                patch.mediaAnimationDirection,
                patch.mediaAnimationType
              ),
            }
          : {}),
        ...(typeof patch.mediaAnimationEasing !== "undefined"
          ? {
              mediaAnimationEasing: normalizeAnimationEasing(
                patch.mediaAnimationEasing,
                patch.mediaAnimationType
              ),
            }
          : {}),
        ...(typeof patch.mediaAnimationIntensity !== "undefined"
          ? { mediaAnimationIntensity: normalizeAnimationIntensity(patch.mediaAnimationIntensity) }
          : {}),
      };

      return {
        pages: mutateActivePage(state, (page) => ({
          ...page,
          elements: page.elements.map((element) => {
            if (element.id !== id) return element;
            const merged = { ...element, ...normalizedPatch };
            const timelineWindow = clampTimelineWindow(
              merged.timelineStartMs,
              merged.timelineEndMs,
              pageDurationMs
            );
            return {
              ...merged,
              timelineStartMs: timelineWindow.startMs,
              timelineEndMs: timelineWindow.endMs,
            };
          }),
        })),
        availableFontFamilies:
          typeof normalizedPatch.fontFamily === "string"
            ? mergeFontFamilies(state.availableFontFamilies, [normalizedPatch.fontFamily])
            : state.availableFontFamilies,
      };
    });

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  setFrameContent: (id, content, options = {}) => {
    const targetId = String(id || "").trim();
    const src = String(content?.src || "").trim();
    if (!targetId || !src) return;

    set((state) => ({
      pages: mutateActivePage(state, (page) => ({
        ...page,
        elements: page.elements.map((element) => {
          if (element.id !== targetId || element.type !== "frame") return element;
          return {
            ...element,
            frameContent: {
              ...content,
              kind: content.kind === "video" ? "video" : "image",
              src,
            },
            frameContentTransform: normalizeFrameContentTransform(
              element.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM
            ),
          };
        }),
      })),
    }));

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  updateFrameContentTransform: (id, patch, options = {}) => {
    const targetId = String(id || "").trim();
    if (!targetId) return;

    set((state) => ({
      pages: mutateActivePage(state, (page) => ({
        ...page,
        elements: page.elements.map((element) => {
          if (element.id !== targetId || element.type !== "frame") return element;
          return {
            ...element,
            frameContentTransform: normalizeFrameContentTransform({
              ...(element.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM),
              ...patch,
            }),
          };
        }),
      })),
    }));

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  clearFrameContent: (id, options = {}) => {
    const targetId = String(id || "").trim();
    if (!targetId) return;

    set((state) => ({
      pages: mutateActivePage(state, (page) => ({
        ...page,
        elements: page.elements.map((element) =>
          element.id === targetId && element.type === "frame"
            ? {
                ...element,
                frameContent: null,
                frameContentTransform: normalizeFrameContentTransform(DEFAULT_FRAME_CONTENT_TRANSFORM),
              }
            : element
        ),
      })),
    }));

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  updateSelectedElements: (patch, options = {}) => {
    const selected = get().selectedIds;
    if (selected.length === 0) return;
    const selectedSet = new Set(selected);
    set((state) => {
      const activePage = findActivePage(state);
      const pageDurationMs = getPageDurationMs(activePage);
      const normalizedPatch = {
        ...patch,
        ...(typeof patch.fontFamily !== "undefined"
          ? { fontFamily: normalizeFontFamilyName(patch.fontFamily) || FONT_FAMILY_DEFAULT }
          : {}),
        ...(typeof patch.mediaAnimationType !== "undefined"
          ? { mediaAnimationType: normalizeAnimationType(patch.mediaAnimationType) }
          : {}),
        ...(typeof patch.mediaAnimationMode !== "undefined"
          ? { mediaAnimationMode: normalizeAnimationMode(patch.mediaAnimationMode) }
          : {}),
        ...(typeof patch.mediaAnimationInfinite !== "undefined"
          ? {
              mediaAnimationInfinite: normalizeAnimationInfinite(
                patch.mediaAnimationInfinite,
                patch.mediaAnimationMode
              ),
            }
          : {}),
        ...(typeof patch.mediaAnimationDurationMs !== "undefined"
          ? { mediaAnimationDurationMs: normalizeAnimationDurationMs(patch.mediaAnimationDurationMs) }
          : {}),
        ...(typeof patch.mediaAnimationDelayMs !== "undefined"
          ? { mediaAnimationDelayMs: normalizeAnimationDelayMs(patch.mediaAnimationDelayMs) }
          : {}),
        ...(typeof patch.mediaAnimationDirection !== "undefined"
          ? {
              mediaAnimationDirection: normalizeAnimationDirection(
                patch.mediaAnimationDirection,
                patch.mediaAnimationType
              ),
            }
          : {}),
        ...(typeof patch.mediaAnimationEasing !== "undefined"
          ? {
              mediaAnimationEasing: normalizeAnimationEasing(
                patch.mediaAnimationEasing,
                patch.mediaAnimationType
              ),
            }
          : {}),
        ...(typeof patch.mediaAnimationIntensity !== "undefined"
          ? { mediaAnimationIntensity: normalizeAnimationIntensity(patch.mediaAnimationIntensity) }
          : {}),
      };

      return {
        pages: mutateActivePage(state, (page) => ({
          ...page,
          elements: page.elements.map((element) => {
            if (!selectedSet.has(element.id)) return element;
            const merged = { ...element, ...normalizedPatch };
            const timelineWindow = clampTimelineWindow(
              merged.timelineStartMs,
              merged.timelineEndMs,
              pageDurationMs
            );
            return {
              ...merged,
              timelineStartMs: timelineWindow.startMs,
              timelineEndMs: timelineWindow.endMs,
            };
          }),
        })),
        availableFontFamilies:
          typeof normalizedPatch.fontFamily === "string"
            ? mergeFontFamilies(state.availableFontFamilies, [normalizedPatch.fontFamily])
            : state.availableFontFamilies,
      };
    });

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  deleteElement: (id) => {
    if (!id) return;
    const state = get();
    const page = findActivePage(state);
    if (!page) return;
    const selectedSet = new Set(state.selectedIds.filter((item) => item !== id));

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.filter((element) => element.id !== id),
      })),
      selectedIds: Array.from(selectedSet),
      publishCandidateIds: state.publishCandidateIds.filter((item) => item !== id),
    });

    get().recordHistory();
  },

  deleteSelected: () => {
    const selected = get().selectedIds;
    if (selected.length === 0) return;

    const selectedSet = new Set(selected);
    set((state) => ({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.filter((element) => !selectedSet.has(element.id)),
      })),
      selectedIds: [],
      publishCandidateIds: state.publishCandidateIds.filter((item) => !selectedSet.has(item)),
    }));

    get().recordHistory();
  },

  duplicateSelected: () => {
    const state = get();
    const page = findActivePage(state);
    if (!page || state.selectedIds.length === 0) return;

    const selectedSet = new Set(state.selectedIds);
    const selectedElements = page.elements.filter((element) => selectedSet.has(element.id));
    if (selectedElements.length === 0) return;

    const duplicated = selectedElements.map((element, index) => ({
      ...deepClone(element),
      id: uid("el"),
      name: `${element.name} copy`,
      x: element.x + 24 + index * 4,
      y: element.y + 24 + index * 4,
      groupId: null,
    }));

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, ...duplicated],
      })),
      selectedIds: duplicated.map((item) => item.id),
    }));

    get().recordHistory();
  },

  copySelectedToClipboard: () => {
    const state = get();
    const page = findActivePage(state);
    if (!page || state.selectedIds.length === 0) return false;

    const selectedSet = new Set(state.selectedIds);
    const selectedElements = page.elements.filter((element) => selectedSet.has(element.id));
    if (selectedElements.length === 0) return false;

    set({
      clipboard: {
        elements: selectedElements.map((element) => deepClone(element)),
        pasteCount: 0,
      },
    });

    return true;
  },

  pasteFromClipboard: () => {
    const state = get();
    const page = findActivePage(state);
    if (!page || !state.clipboard || state.clipboard.elements.length === 0) return [];

    const pasteCount = Math.max(0, Number(state.clipboard.pasteCount || 0));
    const offset = 24 * (pasteCount + 1);
    const groupMap = new Map<string, string>();

    const duplicated = state.clipboard.elements.map((element, index) => {
      const sourceGroupId = typeof element.groupId === "string" ? element.groupId.trim() : "";
      let nextGroupId: string | null = null;
      if (sourceGroupId) {
        const mapped = groupMap.get(sourceGroupId);
        if (mapped) {
          nextGroupId = mapped;
        } else {
          const created = uid("group");
          groupMap.set(sourceGroupId, created);
          nextGroupId = created;
        }
      }

      return {
        ...deepClone(element),
        id: uid("el"),
        pageId: page.id,
        x: element.x + offset + index * 2,
        y: element.y + offset + index * 2,
        groupId: nextGroupId,
      };
    });

    const pastedFontFamilies = duplicated
      .filter((element) => element.type === "text")
      .map((element) => element.fontFamily);

    set((prev) => ({
      pages: mutateActivePage(prev, (activePage) => ({
        ...activePage,
        elements: [...activePage.elements, ...duplicated],
      })),
      selectedIds: duplicated.map((element) => element.id),
      clipboard: prev.clipboard
        ? {
            ...prev.clipboard,
            pasteCount: Math.max(0, Number(prev.clipboard.pasteCount || 0)) + 1,
          }
        : prev.clipboard,
      availableFontFamilies: mergeFontFamilies(prev.availableFontFamilies, pastedFontFamilies),
    }));

    get().recordHistory();
    return duplicated.map((element) => element.id);
  },

  replaceSelectedWithImageLayer: (payload) => {
    const state = get();
    const page = findActivePage(state);
    const src = String(payload?.src || "").trim();
    if (!page || !src || state.selectedIds.length < 2) return "";

    const selectedSet = new Set(state.selectedIds);
    const selectedIndexes: number[] = [];
    page.elements.forEach((element, index) => {
      if (selectedSet.has(element.id)) {
        selectedIndexes.push(index);
      }
    });
    if (selectedIndexes.length < 2) return "";

    const insertionAnchor = Math.max(...selectedIndexes);
    const removedBeforeAnchor = selectedIndexes.filter((index) => index < insertionAnchor).length;
    const nextInsertionIndex = Math.max(0, insertionAnchor - removedBeforeAnchor);
    const nextElements = page.elements.filter((element) => !selectedSet.has(element.id));

    const mergedElement = {
      ...createBaseElement(page.id, {
        type: "image",
        name: payload.name || "Image",
      x: payload.x,
      y: payload.y,
      width: Math.max(2, payload.width),
      height: Math.max(2, payload.height),
      fill: "#e5e7eb",
      src,
      groupId: null,
      timelineEndMs: getPageDurationMs(page),
    }),
      type: "image",
      src,
      x: payload.x,
      y: payload.y,
      width: Math.max(2, payload.width),
      height: Math.max(2, payload.height),
      name: payload.name || "Image",
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      blendMode: "source-over",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      groupId: null,
      importNodeId: "",
      importParentId: null,
      importKind: "image",
      importZIndex: undefined,
      fallback: false,
      fallbackReason: "",
      syntheticTextBackground: false,
      isBackgroundLayer: false,
    } as EditorElement;

    nextElements.splice(Math.min(nextInsertionIndex, nextElements.length), 0, mergedElement);

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: nextElements,
      })),
      selectedIds: [mergedElement.id],
    });

    get().recordHistory();
    return mergedElement.id;
  },

  toggleVisibility: (id) => {
    if (!id) return;
    const state = get();

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) =>
          element.id === id ? { ...element, visible: !element.visible } : element
        ),
      })),
    });

    get().recordHistory();
  },

  toggleLock: (id) => {
    if (!id) return;
    const state = get();

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) =>
          element.id === id ? { ...element, locked: !element.locked } : element
        ),
      })),
    });

    get().recordHistory();
  },

  reorderLayer: (sourceId, targetId, position) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const state = get();
    const page = findActivePage(state);
    if (!page) return;

    const fromIndex = elementIndexById(page, sourceId);
    const toIndex = elementIndexById(page, targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextElements = [...page.elements];
    const [moving] = nextElements.splice(fromIndex, 1);

    let insertIndex = toIndex + (position === "after" ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    nextElements.splice(insertIndex, 0, moving);

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: nextElements,
      })),
    });

    get().recordHistory();
  },

  moveLayer: (id, direction) => {
    if (!id) return;
    const state = get();
    const page = findActivePage(state);
    if (!page) return;

    const index = elementIndexById(page, id);
    if (index < 0) return;

    const nextElements = [...page.elements];

    if (direction === "front") {
      const [moving] = nextElements.splice(index, 1);
      nextElements.push(moving);
    } else if (direction === "back") {
      const [moving] = nextElements.splice(index, 1);
      nextElements.unshift(moving);
    } else if (direction === "up" && index < nextElements.length - 1) {
      [nextElements[index], nextElements[index + 1]] = [nextElements[index + 1], nextElements[index]];
    } else if (direction === "down" && index > 0) {
      [nextElements[index], nextElements[index - 1]] = [nextElements[index - 1], nextElements[index]];
    } else {
      return;
    }

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: nextElements,
      })),
    });

    get().recordHistory();
  },

  alignSelected: (align) => {
    const state = get();
    const page = findActivePage(state);
    if (!page || state.selectedIds.length === 0) return;

    const selectedSet = new Set(state.selectedIds);

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) => {
          if (!selectedSet.has(element.id)) return element;

          const scaledWidth = Math.max(1, element.width * Math.abs(element.scaleX));
          const scaledHeight = Math.max(1, element.height * Math.abs(element.scaleY));

          if (align === "left") return { ...element, x: 0 };
          if (align === "center") return { ...element, x: (activePage.width - scaledWidth) / 2 };
          if (align === "right") return { ...element, x: activePage.width - scaledWidth };
          if (align === "top") return { ...element, y: 0 };
          if (align === "middle") return { ...element, y: (activePage.height - scaledHeight) / 2 };
          return { ...element, y: activePage.height - scaledHeight };
        }),
      })),
    });

    get().recordHistory();
  },

  groupSelected: () => {
    const selected = get().selectedIds;
    if (selected.length < 2) return;

    const selectedSet = new Set(selected);
    const nextGroup = uid("group");

    set((state) => ({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) =>
          selectedSet.has(element.id) ? { ...element, groupId: nextGroup } : element
        ),
      })),
    }));

    get().recordHistory();
  },

  ungroupSelected: () => {
    const selected = get().selectedIds;
    if (selected.length === 0) return;

    const selectedSet = new Set(selected);
    set((state) => ({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) =>
          selectedSet.has(element.id) ? { ...element, groupId: null } : element
        ),
      })),
    }));

    get().recordHistory();
  },

  flipSelected: (axis) => {
    const selected = get().selectedIds;
    if (selected.length === 0) return;

    const selectedSet = new Set(selected);

    set((state) => ({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) => {
          if (!selectedSet.has(element.id)) return element;
          if (axis === "x") return { ...element, flipX: !element.flipX, scaleX: element.scaleX * -1 };
          return { ...element, flipY: !element.flipY, scaleY: element.scaleY * -1 };
        }),
      })),
    }));

    get().recordHistory();
  },

  setBackground: (background) => {
    const state = get();
    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        background: {
          ...activePage.background,
          ...background,
        },
      })),
    });

    get().recordHistory();
  },

  resizeActivePage: (width, height, options = {}) => {
    const state = get();
    const page = findActivePage(state);
    if (!page) return;

    const nextWidth = Math.max(16, Math.round(width || page.width));
    const nextHeight = Math.max(16, Math.round(height || page.height));
    if (nextWidth === page.width && nextHeight === page.height) return;

    const useMagic = options.useMagic ?? state.resizeUseMagic;
    const scaleX = nextWidth / Math.max(1, page.width);
    const scaleY = nextHeight / Math.max(1, page.height);

    set({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        width: nextWidth,
        height: nextHeight,
        elements: useMagic
          ? activePage.elements.map((element) => scaleElementForResize(element, scaleX, scaleY))
          : activePage.elements,
      })),
    });

    get().recordHistory();
  },

  addPage: () => {
    const state = get();
    const nextPage = createBlankPage(`Page ${state.pages.length + 1}`);
    const nextPages = [...state.pages, nextPage];

    set({
      pages: nextPages,
      activePageId: nextPage.id,
      designTimeline: createDefaultDesignTimeline(nextPages, state.designTimeline),
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, nextPages),
      selectedIds: [],
      publishCandidateIds: [],
    });

    get().recordHistory();
  },

  duplicatePage: (pageId) => {
    const state = get();
    const source = state.pages.find((page) => page.id === pageId);
    if (!source) return;

    const nextPageId = uid("page");
    const cloned = deepClone(source);
    cloned.id = nextPageId;
    cloned.name = `${source.name} copy`;
    cloned.elements = cloned.elements.map((element) => ({
      ...element,
      id: uid("el"),
      pageId: nextPageId,
    }));

    const sourceIndex = state.pages.findIndex((page) => page.id === pageId);
    const pages = [...state.pages];
    pages.splice(sourceIndex + 1, 0, cloned);

    set({
      pages,
      activePageId: cloned.id,
      designTimeline: createDefaultDesignTimeline(pages, state.designTimeline),
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, pages),
      selectedIds: [],
      publishCandidateIds: [],
    });

    get().recordHistory();
  },

  deletePage: (pageId) => {
    const state = get();
    if (state.pages.length <= 1) return;

    const nextPages = state.pages.filter((page) => page.id !== pageId);
    if (nextPages.length === state.pages.length) return;

    const nextActive = state.activePageId === pageId ? nextPages[0].id : state.activePageId;

    set({
      pages: nextPages,
      activePageId: nextActive,
      designTimeline: createDefaultDesignTimeline(nextPages, state.designTimeline),
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, nextPages),
      timelineIsPlaying: state.timelineIsPlaying && nextPages.length > 0,
      selectedIds: [],
      publishCandidateIds: [],
    });

    get().recordHistory();
  },

  reorderPages: (sourceId, targetId, position) => {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const state = get();
    const fromIndex = state.pages.findIndex((page) => page.id === sourceId);
    const toIndex = state.pages.findIndex((page) => page.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextPages = [...state.pages];
    const [moving] = nextPages.splice(fromIndex, 1);
    let insertIndex = toIndex + (position === "after" ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    nextPages.splice(insertIndex, 0, moving);

    set({
      pages: nextPages,
      designTimeline: createDefaultDesignTimeline(nextPages, state.designTimeline),
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, nextPages),
    });
    get().recordHistory();
  },

  setActivePageId: (activePageId) => {
    set({ activePageId, selectedIds: [], publishCandidateIds: [] });
    get().recordHistory();
  },

  setActivePageIdSilently: (activePageId) => {
    set({ activePageId });
  },

  setPageDuration: (pageId, durationMs, options = {}) => {
    const state = get();
    const nextDurationMs = normalizePageDuration(durationMs);
    const nextPages = state.pages.map((page) => {
      if (page.id !== pageId) return page;
      return {
        ...page,
        durationMs: nextDurationMs,
        elements: page.elements.map((element) => {
          const window = clampTimelineWindow(element.timelineStartMs, element.timelineEndMs, nextDurationMs);
          return {
            ...element,
            timelineStartMs: window.startMs,
            timelineEndMs: window.endMs,
          };
        }),
      };
    });

    set({
      pages: nextPages,
      designTimeline: createDefaultDesignTimeline(nextPages, state.designTimeline),
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, nextPages),
    });

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  applyTemplate: (template) => {
    const state = get();
    const page = normalizePageForEditor(deepClone(template.page));
    page.id = state.activePageId;
    page.name = template.name;
    page.elements = page.elements.map((element) => ({
      ...element,
      id: uid("el"),
      pageId: state.activePageId,
      groupId: null,
    }));

    set({
      pages: mutateActivePage(state, () => page),
      designTimeline: createDefaultDesignTimeline(
        mutateActivePage(state, () => page),
        state.designTimeline
      ),
      timelinePlayheadMs: 0,
      timelineIsPlaying: false,
      selectedIds: [],
      publishCandidateIds: [],
    });

    get().recordHistory();
  },

  exportDesign: () => {
    const state = get();
    const normalizedPages = state.pages.map((page) => normalizePageForEditor(page));
    const payload: EditorDesign = {
      version: 2,
      activePageId: state.activePageId,
      timeline: {
        ...state.designTimeline,
        enabled: hasAnimatedTemplateContent(normalizedPages, state.designTimeline),
        totalDurationMs: getTotalTimelineDurationMs(normalizedPages),
        preview: normalizeTimelinePreview(state.designTimeline.preview),
      },
      pages: normalizedPages,
    };
    return JSON.stringify(payload, null, 2);
  },

  loadDesign: (payload) => {
    if (!payload || !Array.isArray(payload.pages) || payload.pages.length === 0) return;
    const normalizedPages = deepClone(payload.pages).map((page) => normalizePageForEditor(page));
    const activePageId = payload.activePageId || normalizedPages[0].id;
    const designFonts = collectFontFamiliesFromPages(normalizedPages);
    const designTimeline = createDefaultDesignTimeline(normalizedPages, {
      ...(payload.timeline || {}),
      preview: normalizeTimelinePreview(payload.timeline?.preview),
    });

    set((state) => ({
      pages: normalizedPages,
      activePageId,
      designTimeline,
      timelinePlayheadMs: 0,
      timelineIsPlaying: false,
      selectedIds: [],
      publishCandidateIds: [],
      availableFontFamilies: mergeFontFamilies(state.availableFontFamilies, designFonts),
    }));

    get().resetHistory();
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;

    const nextIndex = state.historyIndex - 1;
    const snapshot = deserializeHistorySnapshot(state.history[nextIndex]);
    if (!snapshot) return;

    set({
      pages: snapshot.pages,
      activePageId: snapshot.activePageId,
      designTimeline: snapshot.designTimeline,
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, snapshot.pages),
      timelineIsPlaying: false,
      selectedIds: [],
      publishCandidateIds: [],
      historyIndex: nextIndex,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;

    const nextIndex = state.historyIndex + 1;
    const snapshot = deserializeHistorySnapshot(state.history[nextIndex]);
    if (!snapshot) return;

    set({
      pages: snapshot.pages,
      activePageId: snapshot.activePageId,
      designTimeline: snapshot.designTimeline,
      timelinePlayheadMs: clampTimelinePlayheadMs(state.timelinePlayheadMs, snapshot.pages),
      timelineIsPlaying: false,
      selectedIds: [],
      publishCandidateIds: [],
      historyIndex: nextIndex,
    });
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  recordHistory: () => {
    set((state) => {
      const snapshot = serializeHistorySnapshot(state.pages, state.activePageId, state.designTimeline);
      if (state.history[state.historyIndex] === snapshot) {
        return state;
      }

      const head = state.history.slice(0, state.historyIndex + 1);
      head.push(snapshot);
      if (head.length > HISTORY_LIMIT) {
        head.shift();
      }

      return {
        history: head,
        historyIndex: head.length - 1,
      };
    });
  },

  resetHistory: () => {
    set((state) => {
      const snapshot = serializeHistorySnapshot(state.pages, state.activePageId, state.designTimeline);
      return {
        history: [snapshot],
        historyIndex: 0,
      };
    });
  },
}));

export function createElementFromAsset(pageId: string, asset: Partial<EditorElement>): EditorElement {
  const nextType = (asset.type || "rect") as ElementType;
  const normalizedFontFamily =
    nextType === "text" ? normalizeFontFamilyName(asset.fontFamily) || FONT_FAMILY_DEFAULT : "";
  return {
    ...createBaseElement(pageId, { ...asset, type: nextType }),
    ...asset,
    ...(nextType === "text" ? { fontFamily: normalizedFontFamily } : {}),
    id: uid("el"),
    pageId,
    type: nextType,
  } as EditorElement;
}
