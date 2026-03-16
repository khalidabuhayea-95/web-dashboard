"use client";

import { create } from "zustand";
import {
  DEFAULT_EDITOR_FONT_FAMILIES,
  mergeFontFamilies,
  normalizeFontFamilyName,
} from "@/lib/editor/fonts";

export type ToolMode = "select" | "pan" | "draw" | "crop";
export type SidebarTab =
  | "templates"
  | "text"
  | "videos"
  | "elements"
  | "category"
  | "draw"
  | "upload"
  | "backgrounds"
  | "layers"
  | "resize";
export type ShapeType = "rect" | "circle" | "line" | "arrow" | "star";
export type ElementType = "text" | "image" | "video" | ShapeType;
export type AlignType = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DrawTool = "selection" | "brush" | "highlighter";
export type TemplateLifecycleStatus = "draft" | "published";

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
  svgOriginalSrc?: string;
  svgPalette?: string[];
  svgColorMap?: Record<string, string>;
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
  videoStart?: number;
  videoEnd?: number;
  videoDuration?: number;
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
  fallback?: boolean;
  fallbackReason?: string;
  syntheticTextBackground?: boolean;
}

export interface PageBackground {
  type: "color" | "gradient";
  color: string;
  gradientFrom: string;
  gradientTo: string;
}

export interface EditorPage {
  id: string;
  name: string;
  width: number;
  height: number;
  background: PageBackground;
  elements: EditorElement[];
}

export interface EditorDesign {
  version: number;
  activePageId: string;
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
  selectedIds: string[];
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

  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  registerFontFamilies: (fontFamilies: string[]) => void;
  setTemplateMeta: (meta: TemplateMetaPatch) => void;
  clearTemplateMeta: () => void;

  addTextElement: (text: string, partial?: Partial<EditorElement>) => string;
  addShapeElement: (shape: ShapeType, partial?: Partial<EditorElement>) => string;
  addImageElement: (src: string, partial?: Partial<EditorElement>) => string;
  addVideoElement: (src: string, partial?: Partial<EditorElement>) => string;
  addFreehandLine: (points: number[], partial?: Partial<EditorElement>) => string;

  updateElement: (id: string, patch: Partial<EditorElement>, options?: UpdateOptions) => void;
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
    videoStart: partial.videoStart ?? 0,
    videoEnd: partial.videoEnd ?? 0,
    videoDuration: partial.videoDuration ?? 0,
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
        }),
      },
    ],
  };
}

function serializeHistorySnapshot(pages: EditorPage[], activePageId: string) {
  return JSON.stringify({
    activePageId,
    pages,
  });
}

function deserializeHistorySnapshot(snapshot: string): Pick<EditorStore, "pages" | "activePageId"> | null {
  try {
    const parsed = JSON.parse(snapshot) as { activePageId?: string; pages?: EditorPage[] };
    if (!Array.isArray(parsed.pages) || typeof parsed.activePageId !== "string") return null;
    return {
      pages: parsed.pages,
      activePageId: parsed.activePageId,
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
const initialSnapshot = serializeHistorySnapshot([initialPage], initialPage.id);

export const useEditorStore = create<EditorStore>((set, get) => ({
  pages: [initialPage],
  activePageId: initialPage.id,
  selectedIds: [],
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

  setSelectedIds: (selectedIds) => set({ selectedIds }),
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
    const normalizedPatch = {
      ...patch,
      ...(typeof patch.fontFamily !== "undefined"
        ? { fontFamily: normalizeFontFamilyName(patch.fontFamily) || FONT_FAMILY_DEFAULT }
        : {}),
    };

    set((state) => ({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) =>
          element.id === id ? { ...element, ...normalizedPatch } : element
        ),
      })),
      availableFontFamilies:
        typeof normalizedPatch.fontFamily === "string"
          ? mergeFontFamilies(state.availableFontFamilies, [normalizedPatch.fontFamily])
          : state.availableFontFamilies,
    }));

    if (options.recordHistory !== false) {
      get().recordHistory();
    }
  },

  updateSelectedElements: (patch, options = {}) => {
    const selected = get().selectedIds;
    if (selected.length === 0) return;
    const normalizedPatch = {
      ...patch,
      ...(typeof patch.fontFamily !== "undefined"
        ? { fontFamily: normalizeFontFamilyName(patch.fontFamily) || FONT_FAMILY_DEFAULT }
        : {}),
    };

    const selectedSet = new Set(selected);
    set((state) => ({
      pages: mutateActivePage(state, (activePage) => ({
        ...activePage,
        elements: activePage.elements.map((element) =>
          selectedSet.has(element.id) ? { ...element, ...normalizedPatch } : element
        ),
      })),
      availableFontFamilies:
        typeof normalizedPatch.fontFamily === "string"
          ? mergeFontFamilies(state.availableFontFamilies, [normalizedPatch.fontFamily])
          : state.availableFontFamilies,
    }));

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

    set({
      pages: [...state.pages, nextPage],
      activePageId: nextPage.id,
      selectedIds: [],
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
      selectedIds: [],
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
      selectedIds: [],
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

    set({ pages: nextPages });
    get().recordHistory();
  },

  setActivePageId: (activePageId) => {
    set({ activePageId, selectedIds: [] });
    get().recordHistory();
  },

  applyTemplate: (template) => {
    const state = get();
    const page = deepClone(template.page);
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
      selectedIds: [],
    });

    get().recordHistory();
  },

  exportDesign: () => {
    const state = get();
    const payload: EditorDesign = {
      version: 1,
      activePageId: state.activePageId,
      pages: state.pages,
    };
    return JSON.stringify(payload, null, 2);
  },

  loadDesign: (payload) => {
    if (!payload || !Array.isArray(payload.pages) || payload.pages.length === 0) return;
    const activePageId = payload.activePageId || payload.pages[0].id;
    const normalizedPages = deepClone(payload.pages).map((page) => ({
      ...page,
      elements: Array.isArray(page.elements)
        ? page.elements.map((element) =>
            element.type === "text"
              ? {
                  ...element,
                  fontFamily: normalizeFontFamilyName(element.fontFamily) || FONT_FAMILY_DEFAULT,
                }
              : element
          )
        : [],
    }));
    const designFonts = collectFontFamiliesFromPages(normalizedPages);

    set((state) => ({
      pages: normalizedPages,
      activePageId,
      selectedIds: [],
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
      selectedIds: [],
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
      selectedIds: [],
      historyIndex: nextIndex,
    });
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  recordHistory: () => {
    set((state) => {
      const snapshot = serializeHistorySnapshot(state.pages, state.activePageId);
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
      const snapshot = serializeHistorySnapshot(state.pages, state.activePageId);
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
