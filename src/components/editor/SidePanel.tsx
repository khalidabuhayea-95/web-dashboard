"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type UIEvent as ReactUIEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Facebook,
  FileText,
  GripVertical,
  Instagram,
  Layers,
  LayoutTemplate,
  Linkedin,
  Lock,
  PaintBucket,
  Palette,
  Search,
  Shapes,
  Tag,
  Twitter,
  Type,
  Unlock,
  Upload,
  Trash2,
  Frame,
  Video as VideoIcon,
  Youtube,
} from "lucide-react";

import Button from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import {
  DEFAULT_EDITOR_FONT_FAMILIES,
  normalizeFontFamilyList,
  normalizeFontFamilyName,
} from "@/lib/editor/fonts";
import { deriveReadableFontLabel } from "@/lib/editor/customFontLabel";
import { uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { resolveCssFontFamily } from "@/lib/templates/fontCatalog";
import { TEMPLATE_CATEGORY_SETTINGS } from "@/lib/templates/templateSettings";
import {
  createElementFromAsset,
  isBackgroundLayerElement,
  useEditorStore,
  type EditorDesign,
  type EditorElement,
  type SidebarTab,
} from "@/store/editorStore";

const TOOL_TABS: Array<{ key: SidebarTab; label: string; icon: ComponentType<{ size?: number; className?: string }> }> = [
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "text", label: "Text", icon: Type },
  { key: "videos", label: "Videos", icon: VideoIcon },
  { key: "elements", label: "Elements", icon: Shapes },
  { key: "category", label: "Category", icon: Tag },
  { key: "upload", label: "Upload", icon: Upload },
  { key: "backgrounds", label: "Background", icon: PaintBucket },
  { key: "layers", label: "Layers", icon: Layers },
  { key: "resize", label: "Resize", icon: Frame },
];

const COLOR_SWATCHES = [
  "#ffffff",
  "#4361ee",
  "#f9844a",
  "#77c95b",
  "#f0cb4b",
  "#c062da",
  "#111827",
];

type ResizePresetItem = {
  label: string;
  width: number;
  height: number;
  displaySize?: string;
};

type ResizePresetGroup = {
  group: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  items: ResizePresetItem[];
};

const PRINT_DPI = 300;
const cmToPx = (value: number) => Math.round((value / 2.54) * PRINT_DPI);
const inToPx = (value: number) => Math.round(value * PRINT_DPI);

const RESIZE_PRESETS: ResizePresetGroup[] = [
  {
    group: "Instagram",
    icon: Instagram,
    items: [
      { label: "Post", width: 1080, height: 1080 },
      { label: "Story", width: 1080, height: 1920 },
      { label: "Ad", width: 1080, height: 1080 },
      { label: "Reel", width: 1080, height: 1920 },
    ],
  },
  {
    group: "Facebook",
    icon: Facebook,
    items: [
      { label: "Post (Landscape)", width: 1200, height: 630 },
      { label: "Post (Square)", width: 1080, height: 1080 },
      { label: "Cover", width: 851, height: 315 },
      { label: "Story", width: 1080, height: 1920 },
    ],
  },
  {
    group: "Youtube",
    icon: Youtube,
    items: [
      { label: "Thumbnail", width: 1280, height: 720 },
      { label: "Channel", width: 2560, height: 1440 },
      { label: "Short", width: 1080, height: 1920 },
    ],
  },
  {
    group: "LinkedIn",
    icon: Linkedin,
    items: [
      { label: "Post", width: 1200, height: 627 },
      { label: "Banner", width: 1584, height: 396 },
      { label: "Square", width: 1080, height: 1080 },
    ],
  },
  {
    group: "Twitter",
    icon: Twitter,
    items: [
      { label: "Post", width: 1600, height: 900 },
      { label: "Header", width: 1500, height: 500 },
      { label: "Square", width: 1080, height: 1080 },
    ],
  },
  {
    group: "Video",
    icon: VideoIcon,
    items: [
      { label: "Full HD", width: 1920, height: 1080 },
      { label: "4K UHD", width: 3840, height: 2160 },
      { label: "Vertical HD", width: 1080, height: 1920 },
      { label: "Square HD", width: 1080, height: 1080 },
    ],
  },
  {
    group: "Print",
    icon: FileText,
    items: [
      { label: "Invitation", width: cmToPx(14), height: cmToPx(14), displaySize: "14x14 cm" },
      { label: "A4 Portrait", width: cmToPx(21), height: cmToPx(29.7), displaySize: "21x29.7 cm" },
      { label: "A4 Landscape", width: cmToPx(29.7), height: cmToPx(21), displaySize: "29.7x21 cm" },
      { label: "A3", width: cmToPx(29.7), height: cmToPx(42), displaySize: "29.7x42 cm" },
      { label: "Letter Portrait", width: inToPx(8.5), height: inToPx(11), displaySize: "8.5x11 in" },
      { label: "Letter Landscape", width: inToPx(11), height: inToPx(8.5), displaySize: "11x8.5 in" },
      { label: "Business card", width: inToPx(3.5), height: inToPx(2), displaySize: "3.5x2 in" },
      { label: "Poster", width: inToPx(18), height: inToPx(24), displaySize: "18x24 in" },
    ],
  },
];

interface StoredTemplate {
  id: string;
  name: string;
  status?: "draft" | "published";
  category?: string;
  subCategory?: string;
  tags?: string[];
  updatedAt?: string;
  data?: unknown;
  canvasSize?: {
    width?: number;
    height?: number;
  } | null;
  thumbnailDataUrl?: string | null;
}

interface TaxonomySubCategorySetting {
  value: string;
  labelEn: string;
  labelAr: string;
  published?: boolean;
}

interface TaxonomyCategorySetting {
  value: string;
  labelEn: string;
  labelAr: string;
  published?: boolean;
  subCategories: TaxonomySubCategorySetting[];
}

interface CustomFontRecord {
  id: string;
  family: string;
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  fileUrl?: string;
  categories?: string[];
  source?: string;
  removable?: boolean;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ImportedElementRecord {
  id: string;
  source: string;
  sourceAssetId?: string;
  kind: "icon" | "vector" | "image";
  title: string;
  titleEn: string;
  titleAr: string;
  tags: string[];
  labels: string[];
  assetUrl: string;
  thumbnailUrl: string;
  animatedVideoUrl?: string;
  width?: number | null;
  height?: number | null;
  freeSvg?: boolean;
}

function buildTemplateLoadSignature(templateId: string, updatedAt = "") {
  const safeId = String(templateId || "").trim();
  const safeUpdatedAt = String(updatedAt || "").trim();
  return safeId ? `${safeId}::${safeUpdatedAt}` : "";
}

const FONT_UPLOAD_ACCEPT =
  ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2,application/font-woff,application/x-font-ttf,application/x-font-otf";

function toNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function isGifSource(value: unknown) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:image/gif")) return true;
  try {
    const parsed = new URL(source);
    return /\.gif$/i.test(parsed.pathname || "");
  } catch {
    return /\.gif(?:$|[?#])/i.test(source);
  }
}

function isVideoSource(value: unknown) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:video/")) return true;
  try {
    const parsed = new URL(source);
    return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(parsed.pathname || "");
  } catch {
    return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(source);
  }
}

function resolveImportedElementPreviewUrl(item: ImportedElementRecord) {
  if (isGifSource(item.assetUrl)) {
    return item.assetUrl;
  }
  return item.thumbnailUrl || item.assetUrl;
}

function deriveFreepikAnimatedVideoUrl(item: ImportedElementRecord) {
  const explicit = String(item.animatedVideoUrl || "").trim();
  if (isVideoSource(explicit)) {
    return explicit;
  }

  const likelyAnimated =
    isGifSource(item.assetUrl) ||
    isGifSource(item.thumbnailUrl) ||
    /cdn-icons-gif\.freepik\.com/i.test(String(item.assetUrl || "")) ||
    /cdn-icons-gif\.freepik\.com/i.test(String(item.thumbnailUrl || ""));
  if (!likelyAnimated) {
    return "";
  }

  const sourceAssetId = String(item.sourceAssetId || "").trim();
  if (/^\d+$/.test(sourceAssetId)) {
    const folder = String(Math.floor(Number(sourceAssetId) / 1000));
    return `https://cdn-icons-mp4.freepik.com/512/${folder}/${sourceAssetId}.mp4`;
  }

  const asset = String(item.assetUrl || "").trim();
  if (!asset) return "";
  try {
    const parsed = new URL(asset);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const filePart = parts[parts.length - 1] || "";
    const idPart = filePart.replace(/\.(gif|png|webp)$/i, "");
    if (!/^\d+$/.test(idPart)) return "";
    const folder = parts.length >= 2 && /^\d+$/.test(parts[parts.length - 2])
      ? parts[parts.length - 2]
      : String(Math.floor(Number(idPart) / 1000));
    return `https://cdn-icons-mp4.freepik.com/512/${folder}/${idPart}.mp4`;
  } catch {
    return "";
  }
}

function toEditorBlendMode(mode: unknown): GlobalCompositeOperation | "source-over" {
  if (typeof mode !== "string") return "source-over";
  const normalized = mode.toLowerCase();
  if (normalized === "normal") return "source-over";
  if (
    normalized === "multiply" ||
    normalized === "screen" ||
    normalized === "overlay" ||
    normalized === "darken" ||
    normalized === "lighten" ||
    normalized === "source-over"
  ) {
    return normalized as GlobalCompositeOperation | "source-over";
  }
  return "source-over";
}

function extractFabricData(payload: unknown): { objects: Array<Record<string, unknown>>; backgroundColor?: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (Array.isArray(data.objects)) {
    return data as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
  }

  if (data.fabric && typeof data.fabric === "object") {
    const fabric = data.fabric as Record<string, unknown>;
    if (Array.isArray(fabric.objects)) {
      return fabric as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
    }
  }

  if (data.data && typeof data.data === "object") {
    const nested = data.data as Record<string, unknown>;
    if (Array.isArray(nested.objects)) {
      return nested as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
    }
    if (nested.fabric && typeof nested.fabric === "object") {
      const nestedFabric = nested.fabric as Record<string, unknown>;
      if (Array.isArray(nestedFabric.objects)) {
        return nestedFabric as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
      }
    }
  }

  return null;
}

function parseColor(value: unknown, fallback = "#111827") {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function parseOptionalColor(value: unknown) {
  if (typeof value !== "string") return "";
  const color = value.trim();
  if (!color) return "";
  const lower = color.toLowerCase();
  if (lower === "transparent" || lower === "rgba(0, 0, 0, 0)") return "";
  return color;
}

function normalizeTextAlign(value: unknown): "left" | "center" | "right" | "justify" {
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function normalizeTextDecoration(
  decoration: unknown,
  underline: unknown,
  lineThrough: unknown
): "" | "underline" | "line-through" | "underline line-through" {
  const tokens = new Set<string>();
  const raw = String(decoration || "").toLowerCase();
  if (raw.includes("underline")) tokens.add("underline");
  if (raw.includes("line-through") || raw.includes("linethrough")) tokens.add("line-through");
  if (underline === true) tokens.add("underline");
  if (lineThrough === true) tokens.add("line-through");
  const hasUnderline = tokens.has("underline");
  const hasLineThrough = tokens.has("line-through");
  if (hasUnderline && hasLineThrough) return "underline line-through";
  if (hasUnderline) return "underline";
  if (hasLineThrough) return "line-through";
  return "";
}

function createSolidFillDataUrl(fill: string, width: number, height: number, radius = 0): string {
  if (typeof document === "undefined") return "";
  try {
    const resolvedWidth = Math.max(1, Math.round(width));
    const resolvedHeight = Math.max(1, Math.round(height));
    const canvas = document.createElement("canvas");
    canvas.width = resolvedWidth;
    canvas.height = resolvedHeight;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.clearRect(0, 0, resolvedWidth, resolvedHeight);
    context.fillStyle = parseColor(fill, "#111827");
    const safeRadius = Math.max(0, Math.min(Number(radius) || 0, Math.min(resolvedWidth, resolvedHeight) / 2));
    if (safeRadius <= 0) {
      context.fillRect(0, 0, resolvedWidth, resolvedHeight);
    } else {
      const right = resolvedWidth;
      const bottom = resolvedHeight;
      context.beginPath();
      context.moveTo(safeRadius, 0);
      context.lineTo(right - safeRadius, 0);
      context.quadraticCurveTo(right, 0, right, safeRadius);
      context.lineTo(right, bottom - safeRadius);
      context.quadraticCurveTo(right, bottom, right - safeRadius, bottom);
      context.lineTo(safeRadius, bottom);
      context.quadraticCurveTo(0, bottom, 0, bottom - safeRadius);
      context.lineTo(0, safeRadius);
      context.quadraticCurveTo(0, 0, safeRadius, 0);
      context.closePath();
      context.fill();
    }
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function extractImportUsedFonts(templateData: unknown): string[] {
  if (!templateData || typeof templateData !== "object") return [];
  const data = templateData as Record<string, unknown>;
  const meta = data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : null;
  const importMeta =
    (meta?.import && typeof meta.import === "object" ? (meta.import as Record<string, unknown>) : null) ||
    (data.import && typeof data.import === "object" ? (data.import as Record<string, unknown>) : null);
  const usedFonts = Array.isArray(importMeta?.usedFonts) ? importMeta.usedFonts : [];
  return normalizeFontFamilyList(usedFonts);
}

function collectDesignTextFonts(design: EditorDesign): string[] {
  if (!design || !Array.isArray(design.pages)) return [];
  const fonts: string[] = [];
  design.pages.forEach((page) => {
    if (!page || !Array.isArray(page.elements)) return;
    page.elements.forEach((element) => {
      if (element?.type !== "text") return;
      fonts.push(String(element.fontFamily || ""));
    });
  });
  return normalizeFontFamilyList(fonts);
}

function readTemplateImportMeta(templateData: unknown): Record<string, unknown> | null {
  if (!templateData || typeof templateData !== "object") return null;
  const data = templateData as Record<string, unknown>;
  const meta = data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : null;
  return (
    (meta?.import && typeof meta.import === "object" ? (meta.import as Record<string, unknown>) : null) ||
    (data.import && typeof data.import === "object" ? (data.import as Record<string, unknown>) : null)
  );
}

function isCanvaImportedTemplate(templateData: unknown) {
  const importMeta = readTemplateImportMeta(templateData);
  const source = String(importMeta?.source || "").toLowerCase();
  return source.includes("canva");
}

function findLikelyBackgroundLayerIndex(elements: EditorElement[], pageWidth: number, pageHeight: number) {
  let bestIndex = -1;
  let bestScore = -1;
  elements.forEach((element, index) => {
    if (!element || element.type !== "image") return;
    const scaleX = Math.max(0.0001, Math.abs(Number(element.scaleX) || 1));
    const scaleY = Math.max(0.0001, Math.abs(Number(element.scaleY) || 1));
    const width = Math.max(1, (Number(element.width) || 0) * scaleX);
    const height = Math.max(1, (Number(element.height) || 0) * scaleY);
    const clippedWidth = Math.min(width, pageWidth);
    const clippedHeight = Math.min(height, pageHeight);
    const coverage = (clippedWidth * clippedHeight) / Math.max(1, pageWidth * pageHeight);
    if (coverage < 0.85) return;
    const nearOrigin =
      Math.abs(Number(element.x) || 0) <= pageWidth * 0.05 &&
      Math.abs(Number(element.y) || 0) <= pageHeight * 0.05;
    const score = coverage * 10 + (nearOrigin ? 2 : 0) + (index === 0 ? 0.25 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function renderedLayerWidth(element: EditorElement) {
  return Math.max(1, Number(element.width || 0) * Math.max(0.0001, Math.abs(Number(element.scaleX) || 1)));
}

function renderedLayerHeight(element: EditorElement) {
  return Math.max(1, Number(element.height || 0) * Math.max(0.0001, Math.abs(Number(element.scaleY) || 1)));
}

function findMatchingShapeLayerIndex(
  elements: EditorElement[],
  target: EditorElement,
  pageWidth: number,
  pageHeight: number
) {
  const targetWidth = renderedLayerWidth(target);
  const targetHeight = renderedLayerHeight(target);
  const xTolerance = Math.max(6, pageWidth * 0.02);
  const yTolerance = Math.max(6, pageHeight * 0.02);
  const wTolerance = Math.max(8, pageWidth * 0.025);
  const hTolerance = Math.max(8, pageHeight * 0.025);

  for (let index = 0; index < elements.length; index += 1) {
    const candidate = elements[index];
    if (!candidate || candidate.type !== "rect") continue;
    if (candidate.syntheticTextBackground) continue;
    if (isBackgroundLayerElement(candidate, { width: pageWidth, height: pageHeight })) continue;

    const candidateWidth = renderedLayerWidth(candidate);
    const candidateHeight = renderedLayerHeight(candidate);
    const closePosition =
      Math.abs((Number(candidate.x) || 0) - (Number(target.x) || 0)) <= xTolerance &&
      Math.abs((Number(candidate.y) || 0) - (Number(target.y) || 0)) <= yTolerance;
    const closeSize =
      Math.abs(candidateWidth - targetWidth) <= wTolerance &&
      Math.abs(candidateHeight - targetHeight) <= hTolerance;

    if (closePosition && closeSize) {
      return index;
    }
  }
  return -1;
}

function dedupeSyntheticTextBackgroundLayers(
  sourceElements: EditorElement[],
  pageWidth: number,
  pageHeight: number
) {
  const elements = sourceElements.map((element) => ({ ...element }));
  const removeIds = new Set<string>();

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element?.syntheticTextBackground || element.type !== "image") continue;
    const shapeIndex = findMatchingShapeLayerIndex(elements, element, pageWidth, pageHeight);
    if (shapeIndex < 0) continue;
    const shape = elements[shapeIndex];
    if (shape && !shape.visible) {
      shape.visible = true;
    }
    removeIds.add(element.id);
  }

  if (removeIds.size === 0) return elements;
  return elements.filter((element) => !removeIds.has(element.id));
}

function toEditorDesignFromTemplate(
  template: StoredTemplate,
  fallbackWidth: number,
  fallbackHeight: number
): EditorDesign | null {
  if (!template || !template.id) return null;

  if (template.data && typeof template.data === "object") {
    const maybeDesign = template.data as Partial<EditorDesign>;
    if (Array.isArray(maybeDesign.pages) && maybeDesign.pages.length > 0) {
      return {
        version: 1,
        activePageId: maybeDesign.activePageId || maybeDesign.pages[0].id,
        pages: maybeDesign.pages as EditorDesign["pages"],
      };
    }
  }

  const width = Math.max(16, Math.round(toNumber(template.canvasSize?.width, fallbackWidth)));
  const height = Math.max(16, Math.round(toNumber(template.canvasSize?.height, fallbackHeight)));
  const pageId = `template-page-${template.id}`;
  const fabric = extractFabricData(template.data);
  const importMeta = readTemplateImportMeta(template.data);
  const isCanvaTemplate = isCanvaImportedTemplate(template.data);
  const layerTree = Array.isArray(importMeta?.layerTree) ? (importMeta.layerTree as Array<Record<string, unknown>>) : [];
  const layerZIndexByNodeId = new Map<string, number>();
  layerTree.forEach((node, index) => {
    const id = String(node?.id || "").trim();
    if (!id) return;
    const zIndex = Number.isFinite(Number(node?.zIndex)) ? Number(node?.zIndex) : index;
    layerZIndexByNodeId.set(id, zIndex);
  });

  const elements: EditorElement[] = [];

  if (fabric) {
    fabric.objects.forEach((object, index) => {
      if (!object || typeof object !== "object") return;
      const item = object as Record<string, unknown>;
      const type = String(item.type || "").toLowerCase();
      const scaleX = toNumber(item.scaleX, 1);
      const scaleY = toNumber(item.scaleY, 1);
      const scaleXAbs = Math.max(0.0001, Math.abs(scaleX));
      const scaleYAbs = Math.max(0.0001, Math.abs(scaleY));
      const signedScaleX = (item.flipX ? -1 : 1) * (scaleX < 0 ? -1 : 1);
      const signedScaleY = (item.flipY ? -1 : 1) * (scaleY < 0 ? -1 : 1);
      const rotation = toNumber(item.rotation, toNumber(item.angle, 0));
      const explicitX = Number(item.x);
      const explicitY = Number(item.y);
      const explicitWidth = Number(item.width);
      const explicitHeight = Number(item.height);
      const hasExplicitPosition = Number.isFinite(explicitX) && Number.isFinite(explicitY);
      const hasExplicitSize = Number.isFinite(explicitWidth) && Number.isFinite(explicitHeight);
      const originX = String(item.originX || "left").toLowerCase();
      const originY = String(item.originY || "top").toLowerCase();
      const hasTopLeftExplicitFrame =
        hasExplicitPosition &&
        hasExplicitSize &&
        originX === "left" &&
        originY === "top";
      const hasExplicitFrame =
        Number.isFinite(explicitX) &&
        Number.isFinite(explicitY) &&
        Number.isFinite(explicitWidth) &&
        Number.isFinite(explicitHeight);
      const widthValue =
        type === "circle"
          ? toNumber(item.radius, 100) * 2
          : toNumber(item.width, type === "line" ? Math.abs(toNumber(item.x2, 220) - toNumber(item.x1, 0)) : 240);
      const heightValue =
        type === "circle"
          ? toNumber(item.radius, 100) * 2
          : toNumber(item.height, type === "line" ? Math.abs(toNumber(item.y2, 0) - toNumber(item.y1, 0)) : 160);
      const renderedWidth = hasExplicitFrame
        ? Math.max(1, toNumber(item.width, 1))
        : Math.max(1, widthValue * scaleXAbs);
      const renderedHeight = hasExplicitFrame
        ? Math.max(1, toNumber(item.height, 1))
        : Math.max(1, heightValue * scaleYAbs);
      const anchorX = Number.isFinite(Number(item.left))
        ? Number(item.left)
        : hasExplicitPosition
          ? explicitX
          : 0;
      const anchorY = Number.isFinite(Number(item.top))
        ? Number(item.top)
        : hasExplicitPosition
          ? explicitY
          : 0;
      let resolvedX = hasTopLeftExplicitFrame ? explicitX : anchorX;
      let resolvedY = hasTopLeftExplicitFrame ? explicitY : anchorY;
      if (!hasTopLeftExplicitFrame) {
        const originOffsetX = originX === "center" ? renderedWidth / 2 : originX === "right" ? renderedWidth : 0;
        const originOffsetY = originY === "center" ? renderedHeight / 2 : originY === "bottom" ? renderedHeight : 0;
        const localX = -originOffsetX * signedScaleX;
        const localY = -originOffsetY * signedScaleY;
        const radians = (rotation * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        resolvedX = anchorX + localX * cos - localY * sin;
        resolvedY = anchorY + localX * sin + localY * cos;
      }

      const importNodeId = String(item.importNodeId || "").trim();
      const treeZIndex =
        importNodeId && layerZIndexByNodeId.has(importNodeId)
          ? Number(layerZIndexByNodeId.get(importNodeId))
          : Number.NaN;
      const importZIndex = Number.isFinite(Number(item.importZIndex))
        ? Number(item.importZIndex)
        : Number.isFinite(Number(item.zIndex))
          ? Number(item.zIndex)
          : Number.isFinite(treeZIndex)
            ? treeZIndex
            : index;
      const common: Partial<EditorElement> = {
        id: `tpl-${template.id}-${index}`,
        name: String(item.layerName || item.name || `${type || "Layer"} ${index + 1}`),
        x: resolvedX,
        y: resolvedY,
        width: renderedWidth,
        height: renderedHeight,
        rotation,
        opacity: Math.max(0, Math.min(1, toNumber(item.opacity, 1))),
        visible: item.visible !== false && item.layerHidden !== true,
        locked: item.layerLocked === true || item.selectable === false,
        fill: parseColor(item.fill, "#3b82f6"),
        stroke: parseColor(item.stroke, "#1e293b"),
        strokeWidth: Math.max(0, toNumber(item.strokeWidth, 0)),
        scaleX: signedScaleX,
        scaleY: signedScaleY,
        blendMode: toEditorBlendMode(item.blendMode),
        ...(importNodeId ? { importNodeId } : {}),
        ...(String(item.importParentId || "").trim() ? { importParentId: String(item.importParentId).trim() } : {}),
        ...(String(item.importKind || "").trim() ? { importKind: String(item.importKind).trim() } : {}),
        importZIndex,
        fallback: Boolean(item.fallback),
        fallbackReason: String(item.fallbackReason || ""),
      };

      if (type === "image" && typeof item.src === "string" && item.src) {
        const rasterOriginalSrc = String(item.rasterOriginalSrc || "").trim();
        const rasterPalette = Array.isArray(item.rasterPalette)
          ? item.rasterPalette
              .map((value) => String(value || "").trim())
              .filter(Boolean)
          : [];
        const rasterPaletteVersion = Math.max(
          0,
          Number(item.rasterPaletteVersion || 0)
        );
        const rawRasterColorMap =
          item.rasterColorMap && typeof item.rasterColorMap === "object"
            ? (item.rasterColorMap as Record<string, unknown>)
            : null;
        const rasterColorMap = rawRasterColorMap
          ? Object.fromEntries(
              Object.entries(rawRasterColorMap)
                .map(([key, value]) => [String(key || "").trim(), String(value || "").trim()] as const)
                .filter(([key, value]) => Boolean(key) && Boolean(value))
            )
          : {};

        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "image",
            src: item.src,
            ...(rasterOriginalSrc ? { rasterOriginalSrc } : {}),
            ...(rasterPalette.length > 0 ? { rasterPalette } : {}),
            ...(rasterPaletteVersion > 0 ? { rasterPaletteVersion } : {}),
            ...(Object.keys(rasterColorMap).length > 0 ? { rasterColorMap } : {}),
          })
        );
        return;
      }

      if (type === "textbox" || type === "i-text" || type === "text") {
        const fontSize = Math.max(10, toNumber(item.fontSize, 48));
        const scaledFontSize = Math.max(10, fontSize * scaleYAbs);
        const charSpacingRaw = Number(item.charSpacing);
        const hasCharSpacing = Number.isFinite(charSpacingRaw);
        const explicitLetterSpacing = Number(item.letterSpacing);
        const letterSpacing = hasCharSpacing
          ? (charSpacingRaw / 1000) * scaledFontSize
          : Number.isFinite(explicitLetterSpacing)
            ? explicitLetterSpacing * scaleXAbs
            : 0;
        const textBackgroundColor = parseOptionalColor(
          item.textBackgroundColor || item.backgroundColor || item.bgColor
        );
        const textBackgroundRadius = Math.max(
          0,
          toNumber(item.textBackgroundRadius, 0) * Math.max(scaleXAbs, scaleYAbs)
        );
        if (textBackgroundColor) {
          const backgroundDataUrl = createSolidFillDataUrl(
            textBackgroundColor,
            common.width || 1,
            common.height || 1,
            textBackgroundRadius
          );
          if (backgroundDataUrl) {
            const backgroundElement = createElementFromAsset(pageId, {
              ...common,
              type: "image",
              name: `${String(common.name || "Text")} Background`,
              src: backgroundDataUrl,
              syntheticTextBackground: true,
            });
            backgroundElement.importZIndex = importZIndex - 0.25;
            elements.push(backgroundElement);
          }
        }
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "text",
            text: String(item.text || ""),
            fontFamily:
              normalizeFontFamilyName(item.fontFamily || item.fontName || DEFAULT_EDITOR_FONT_FAMILIES[0]) ||
              DEFAULT_EDITOR_FONT_FAMILIES[0],
            fontSize: scaledFontSize,
            fontWeight: String(item.fontWeight || "400"),
            fontStyle: item.fontStyle === "italic" ? "italic" : "normal",
            textDecoration: normalizeTextDecoration(
              item.textDecoration,
              item.underline,
              item.linethrough
            ),
            align: normalizeTextAlign(item.textAlign ?? item.align),
            lineHeight: Math.max(0.1, toNumber(item.lineHeight, 1.15)),
            letterSpacing,
            color: parseColor(item.fill, "#111827"),
            fill: parseColor(item.fill, "#111827"),
          })
        );
        return;
      }

      if (type === "circle") {
        elements.push(createElementFromAsset(pageId, { ...common, type: "circle" }));
        return;
      }

      if (type === "line") {
        const x1 = toNumber(item.x1, 0);
        const y1 = toNumber(item.y1, 0);
        const x2 = toNumber(item.x2, common.width || 220);
        const y2 = toNumber(item.y2, 0);
        const points = [0, 0, (x2 - x1) * Math.max(0.0001, Math.abs(scaleX)), (y2 - y1) * Math.max(0.0001, Math.abs(scaleY))];
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "line",
            points,
            stroke: parseColor(item.stroke || item.fill, "#111827"),
            fill: parseColor(item.fill, "#111827"),
            strokeWidth: Math.max(1, toNumber(item.strokeWidth, 4)),
          })
        );
        return;
      }

      if (type === "arrow") {
        const points = Array.isArray(item.points)
          ? item.points.map((point) => toNumber(point, 0))
          : [0, 0, common.width || 220, common.height || 0];
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "arrow",
            points,
            stroke: parseColor(item.stroke || item.fill, "#111827"),
            fill: parseColor(item.fill, "#111827"),
            strokeWidth: Math.max(1, toNumber(item.strokeWidth, 4)),
          })
        );
        return;
      }

      if (type === "star") {
        elements.push(createElementFromAsset(pageId, { ...common, type: "star" }));
        return;
      }

      if (type === "rect" || type === "triangle" || type === "polygon") {
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "rect",
            cornerRadius: Math.max(toNumber(item.rx, 0), toNumber(item.ry, 0)),
          })
        );
      }
    });
  }

  if (elements.length === 0 && template.thumbnailDataUrl) {
    elements.push(
      createElementFromAsset(pageId, {
        type: "image",
        name: "Template preview",
        src: template.thumbnailDataUrl,
        x: 0,
        y: 0,
        width,
        height,
      })
    );
  }

  if (elements.length === 0) return null;

  const parityElements = isCanvaTemplate
    ? dedupeSyntheticTextBackgroundLayers(elements, width, height)
    : elements;

  const sortedElements = parityElements
    .map((element, index) => ({
      element,
      index,
      zIndex: Number((element as EditorElement & { importZIndex?: unknown }).importZIndex),
    }))
    .sort((a, b) => {
      const aFinite = Number.isFinite(a.zIndex);
      const bFinite = Number.isFinite(b.zIndex);
      if (aFinite && bFinite && a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      if (aFinite !== bFinite) return aFinite ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.element);

  if (isCanvaTemplate && sortedElements.length > 0) {
    const initialBackgroundIndex = sortedElements.findIndex((element) =>
      isBackgroundLayerElement(element, { width, height })
    );
    const backgroundIndex =
      initialBackgroundIndex >= 0
        ? initialBackgroundIndex
        : findLikelyBackgroundLayerIndex(sortedElements, width, height);
    if (backgroundIndex >= 0) {
      const [backgroundLayer] = sortedElements.splice(backgroundIndex, 1);
      if (backgroundLayer) {
        sortedElements.unshift({
          ...backgroundLayer,
          name: "Background",
          isBackgroundLayer: true,
        } as EditorElement);
      }
    }
  }

  const backgroundColor = parseColor(fabric?.backgroundColor, "#ffffff");
  return {
    version: 1,
    activePageId: pageId,
    pages: [
      {
        id: pageId,
        name: template.name || "Template",
        width,
        height,
        background: {
          type: "color",
          color: backgroundColor,
          gradientFrom: backgroundColor,
          gradientTo: backgroundColor,
        },
        elements: sortedElements,
      },
    ],
  };
}

function layerTypeLabel(element: EditorElement) {
  if (element.type === "text") return "Text";
  if (element.type === "image") return "Image";
  if (element.type === "video") return "Video";
  if (element.type === "arrow") return "Arrow";
  if (element.type === "line") return "Line";
  if (element.type === "circle") return "Circle";
  if (element.type === "star") return "Star";
  return "Shape";
}

function isGenericLayerName(name: string) {
  const normalized = String(name || "").trim();
  if (!normalized) return true;
  return /^(image|video|text|shape|rectangle|rect|circle|line|arrow|star)\s+\d+$/i.test(normalized);
}

function layerDisplayName(layer: EditorElement, page: { width: number; height: number }) {
  if (isBackgroundLayerElement(layer, page)) return "Background";
  if (layer.type === "text") {
    const content = String(layer.text || "").replace(/\s+/g, " ").trim();
    if (content) return content;
  }
  if (!isGenericLayerName(layer.name)) {
    return layer.name;
  }
  if (layer.type === "image") return "Image";
  if (layer.type === "video") return "Video";
  return layerTypeLabel(layer);
}

function assetPayload(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function sanitizeFontFamilyFromFileName(fileName: string) {
  const base = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeFontFamilyName(base);
}

function escapeCssText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function containsArabicScript(value: unknown) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function normalizeFontCategories(value: unknown, fallbackSample = "") {
  const categories = Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => item === "EXCLUSIVE" || item === "ARABIC" || item === "ENGLISH")
    : [];

  if (!categories.includes("ARABIC") && !categories.includes("ENGLISH")) {
    categories.push(containsArabicScript(fallbackSample) ? "ARABIC" : "ENGLISH");
  }

  return Array.from(new Set(categories));
}

function resolveFontLanguageGroup(font: CustomFontRecord): "arabic" | "english" {
  const categories = normalizeFontCategories(font?.categories, font?.family || "");
  return categories.includes("ARABIC") ? "arabic" : "english";
}

function guessFontFormat(mimeType: string) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("woff2")) return "woff2";
  if (value.includes("woff")) return "woff";
  if (value.includes("otf")) return "opentype";
  if (value.includes("ttf")) return "truetype";
  if (value.includes("ms-fontobject")) return "embedded-opentype";
  return "";
}

async function ensureCustomFontFaceInDocument(font: CustomFontRecord) {
  if (typeof document === "undefined") return;
  if (!font?.id || !font?.family) return;
  const sourceUrl = String(font.fileUrl || font.dataUrl || "").trim();
  const sourceType = String(font.source || "").trim().toLowerCase();
  if (!sourceUrl && sourceType !== "google") return;
  const styleId = `editor-custom-font-face-${font.id}`;

  const existingStyle = document.getElementById(styleId);
  const style =
    existingStyle instanceof HTMLStyleElement
      ? existingStyle
      : (() => {
          const nextStyle = document.createElement("style");
          nextStyle.id = styleId;
          document.head.appendChild(nextStyle);
          return nextStyle;
        })();

  if (sourceType === "google") {
    const familyParam = encodeURIComponent(String(font.family || "").trim()).replace(/%20/g, "+");
    style.textContent = `@import url("https://fonts.googleapis.com/css2?family=${familyParam}:wght@400&display=swap");`;
  } else {
    const formatHint = guessFontFormat(font.mimeType);
    const srcValue = formatHint
      ? `url("${sourceUrl}") format("${formatHint}")`
      : `url("${sourceUrl}")`;
    style.textContent = `
@font-face {
  font-family: "${escapeCssText(font.family)}";
  src: ${srcValue};
  font-display: swap;
}`;
  }

  const fontsApi = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fontsApi || typeof fontsApi.load !== "function") return;
  try {
    await Promise.race([
      fontsApi.load(`400 16px "${escapeCssText(font.family)}"`, containsArabicScript(font.family) ? "ص" : "A"),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Font loading failures should not block editor interactions.
  }
}

interface SidePanelProps {
  collapsed: boolean;
}

export default function SidePanel({ collapsed }: SidePanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useEditorStore((state) => state.sidebarTab);
  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const activeTemplateId = useEditorStore((state) => state.activeTemplateId);
  const activeTemplateName = useEditorStore((state) => state.activeTemplateName);
  const activeTemplateStatus = useEditorStore((state) => state.activeTemplateStatus);
  const activeTemplateCategory = useEditorStore((state) => state.activeTemplateCategory);
  const activeTemplateSubCategory = useEditorStore((state) => state.activeTemplateSubCategory);
  const activeTemplateTags = useEditorStore((state) => state.activeTemplateTags);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const resizeUseMagic = useEditorStore((state) => state.resizeUseMagic);

  const setSidebarTab = useEditorStore((state) => state.setSidebarTab);
  const setShowLeftSidebar = useEditorStore((state) => state.setShowLeftSidebar);
  const setResizeUseMagic = useEditorStore((state) => state.setResizeUseMagic);
  const setTemplateMeta = useEditorStore((state) => state.setTemplateMeta);

  const addTextElement = useEditorStore((state) => state.addTextElement);
  const addImageElement = useEditorStore((state) => state.addImageElement);
  const addVideoElement = useEditorStore((state) => state.addVideoElement);
  const loadDesign = useEditorStore((state) => state.loadDesign);
  const registerFontFamilies = useEditorStore((state) => state.registerFontFamilies);
  const setBackground = useEditorStore((state) => state.setBackground);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
  const toggleVisibility = useEditorStore((state) => state.toggleVisibility);
  const toggleLock = useEditorStore((state) => state.toggleLock);
  const reorderLayer = useEditorStore((state) => state.reorderLayer);
  const deleteElement = useEditorStore((state) => state.deleteElement);
  const resizeActivePage = useEditorStore((state) => state.resizeActivePage);
  const updateElement = useEditorStore((state) => state.updateElement);
  const recordHistory = useEditorStore((state) => state.recordHistory);

  const [templateSearch, setTemplateSearch] = useState("");
  const [elementSearch, setElementSearch] = useState("");
  const [importedElements, setImportedElements] = useState<ImportedElementRecord[]>([]);
  const [importedElementsLoading, setImportedElementsLoading] = useState(false);
  const [importedElementsError, setImportedElementsError] = useState("");
  const [deletingImportedElementId, setDeletingImportedElementId] = useState("");
  const [importedElementsTotal, setImportedElementsTotal] = useState(0);
  const [importedElementsPage, setImportedElementsPage] = useState(1);
  const [importedElementsHasNextPage, setImportedElementsHasNextPage] = useState(false);
  const [importedElementsKindTab, setImportedElementsKindTab] = useState<"all" | "icon">("all");
  const [sameSizeOnly, setSameSizeOnly] = useState(false);
  const [dragLayerId, setDragLayerId] = useState("");
  const [dragOver, setDragOver] = useState<{ id: string; position: "before" | "after" }>({
    id: "",
    position: "before",
  });
  const [resizeWidth, setResizeWidth] = useState("1080");
  const [resizeHeight, setResizeHeight] = useState("1080");
  const [resizeUnits, setResizeUnits] = useState("px");
  const [storedTemplates, setStoredTemplates] = useState<StoredTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [customFonts, setCustomFonts] = useState<CustomFontRecord[]>([]);
  const [customFontsLoading, setCustomFontsLoading] = useState(false);
  const [fontSearchQuery, setFontSearchQuery] = useState("");
  const [customFontFamilyInput, setCustomFontFamilyInput] = useState("");
  const [fontLanguageTab, setFontLanguageTab] = useState<"arabic" | "english">("arabic");
  const [uploadingCustomFont, setUploadingCustomFont] = useState(false);
  const [deletingCustomFontId, setDeletingCustomFontId] = useState("");
  const [taxonomySettings, setTaxonomySettings] = useState<TaxonomyCategorySetting[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const templateQueryKey = useMemo(() => searchParams.toString(), [searchParams]);
  const templateIdFromQuery = useMemo(
    () => String(new URLSearchParams(templateQueryKey).get("templateId") || "").trim(),
    [templateQueryKey]
  );
  const templateUpdatedAtFromQuery = useMemo(
    () => String(new URLSearchParams(templateQueryKey).get("updatedAt") || "").trim(),
    [templateQueryKey]
  );
  const loadedTemplateSignatureRef = useRef("");

  const updateTemplateQueryInUrl = useCallback(
    (templateId: string, updatedAt = "") => {
      const params = new URLSearchParams(templateQueryKey);
      if (templateId) {
        params.set("templateId", templateId);
      } else {
        params.delete("templateId");
      }

      const safeUpdatedAt = String(updatedAt || "").trim();
      if (safeUpdatedAt) {
        params.set("updatedAt", safeUpdatedAt);
      } else {
        params.delete("updatedAt");
      }

      const nextQuery = params.toString();
      router.replace(nextQuery ? `/editor-pro?${nextQuery}` : "/editor-pro");
    },
    [router, templateQueryKey]
  );

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoUploadInputRef = useRef<HTMLInputElement | null>(null);
  const customFontInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundColorInputRef = useRef<HTMLInputElement | null>(null);
  const importedElementsScrollLockRef = useRef(false);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );

  useEffect(() => {
    if (!activePage) return;
    setResizeWidth(String(Math.max(1, Math.round(activePage.width))));
    setResizeHeight(String(Math.max(1, Math.round(activePage.height))));
  }, [activePage]);

  useEffect(() => {
    if (activeTab !== "elements") return;
    setImportedElementsPage(1);
    setImportedElementsHasNextPage(false);
    importedElementsScrollLockRef.current = false;
  }, [activeTab, elementSearch, importedElementsKindTab]);

  const layers = useMemo(() => {
    if (!activePage) return [];
    return [...activePage.elements].reverse();
  }, [activePage]);
  const activeBackgroundColor = String(activePage?.background?.color || "#ffffff").trim();

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return storedTemplates.filter((template) => {
      const passesSearch = !query || String(template.name || "").toLowerCase().includes(query);
      const passesSize =
        !sameSizeOnly ||
        (Math.round(toNumber(template.canvasSize?.width, activePage.width)) === activePage.width &&
          Math.round(toNumber(template.canvasSize?.height, activePage.height)) === activePage.height);
      return passesSearch && passesSize;
    });
  }, [activePage.height, activePage.width, sameSizeOnly, storedTemplates, templateSearch]);

  const templateCategorySettings = useMemo<TaxonomyCategorySetting[]>(() => {
    const fromApi = taxonomySettings.filter((item) => item && item.value);
    const publishedFromApi = fromApi
      .filter((item) => item.published !== false)
      .map((item) => ({
        ...item,
        subCategories: (Array.isArray(item.subCategories) ? item.subCategories : []).filter(
          (subCategory) => subCategory.published !== false
        ),
      }))
      .filter((item) => item.subCategories.length > 0);
    if (publishedFromApi.length > 0) return publishedFromApi;
    if (fromApi.length > 0) return fromApi;
    return TEMPLATE_CATEGORY_SETTINGS as TaxonomyCategorySetting[];
  }, [taxonomySettings]);

  const activeCategoryValue = useMemo(() => {
    const fallback = templateCategorySettings[0]?.value || "general";
    const normalized = String(activeTemplateCategory || "").trim().toLowerCase();
    return (
      templateCategorySettings.find((item) => item.value === normalized)?.value || fallback
    );
  }, [activeTemplateCategory, templateCategorySettings]);

  const activeCategoryConfig = useMemo(() => {
    return (
      templateCategorySettings.find((item) => item.value === activeCategoryValue) ||
      templateCategorySettings[0] ||
      null
    );
  }, [activeCategoryValue, templateCategorySettings]);

  const activeSubCategoryOptions = useMemo(
    () => (Array.isArray(activeCategoryConfig?.subCategories) ? activeCategoryConfig.subCategories : []),
    [activeCategoryConfig]
  );

  const activeSubCategoryValue = useMemo(() => {
    const fallback = activeSubCategoryOptions[0]?.value || "general";
    const normalized = String(activeTemplateSubCategory || "").trim().toLowerCase();
    return (
      activeSubCategoryOptions.find((item) => item.value === normalized)?.value || fallback
    );
  }, [activeSubCategoryOptions, activeTemplateSubCategory]);

  const customFontFamilies = useMemo(
    () => normalizeFontFamilyList(customFonts.map((font) => font.family)),
    [customFonts]
  );

  const customFontDisplayByFamily = useMemo(() => {
    const map = new Map<string, string>();
    customFonts.forEach((font) => {
      const key = normalizeFontFamilyName(font.family).toLowerCase();
      if (!key) return;
      map.set(key, deriveReadableFontLabel(font));
    });
    return map;
  }, [customFonts]);

  const groupedCustomFonts = useMemo(() => {
    const groups: { arabic: CustomFontRecord[]; english: CustomFontRecord[] } = {
      arabic: [],
      english: [],
    };

    customFonts.forEach((font) => {
      const target = resolveFontLanguageGroup(font);
      groups[target].push(font);
    });

    const sortByLabel = (left: CustomFontRecord, right: CustomFontRecord) =>
      deriveReadableFontLabel(left).localeCompare(deriveReadableFontLabel(right), undefined, {
        sensitivity: "base",
        numeric: true,
      });

    groups.arabic.sort(sortByLabel);
    groups.english.sort(sortByLabel);
    return groups;
  }, [customFonts]);

  const filteredGroupedCustomFonts = useMemo(() => {
    const query = fontSearchQuery.trim().toLowerCase();
    if (!query) return groupedCustomFonts;

    const matchesFont = (font: CustomFontRecord) => {
      const display = deriveReadableFontLabel(font);
      const source = String(font.source || "custom");
      const categories = Array.isArray(font.categories) ? font.categories.join(" ") : "";
      const haystack = [font.family, display, source, categories].join(" ").toLowerCase();
      return haystack.includes(query);
    };

    return {
      arabic: groupedCustomFonts.arabic.filter(matchesFont),
      english: groupedCustomFonts.english.filter(matchesFont),
    };
  }, [fontSearchQuery, groupedCustomFonts]);

  const customFontLanguageByFamily = useMemo(() => {
    const map = new Map<string, "arabic" | "english">();
    customFonts.forEach((font) => {
      const key = normalizeFontFamilyName(font.family).toLowerCase();
      if (!key) return;
      map.set(key, resolveFontLanguageGroup(font));
    });
    return map;
  }, [customFonts]);

  const selectedTextFontFamily = useMemo(() => {
    if (!activePage || selectedIds.length === 0) return "";
    const selectedTextElement = activePage.elements.find(
      (element) => selectedIds.includes(element.id) && element.type === "text"
    );
    return normalizeFontFamilyName(selectedTextElement?.fontFamily || "");
  }, [activePage, selectedIds]);

  const selectedTextLayerIds = useMemo(() => {
    if (!activePage || selectedIds.length === 0) return [];
    const selectedSet = new Set(selectedIds);
    return activePage.elements
      .filter((element) => selectedSet.has(element.id) && element.type === "text")
      .map((element) => element.id);
  }, [activePage, selectedIds]);

  const selectedTextFontDisplay = useMemo(() => {
    if (!selectedTextFontFamily) return "";
    return (
      customFontDisplayByFamily.get(selectedTextFontFamily.toLowerCase()) || selectedTextFontFamily
    );
  }, [customFontDisplayByFamily, selectedTextFontFamily]);

  useEffect(() => {
    if (!selectedTextFontFamily) return;
    const familyKey = selectedTextFontFamily.toLowerCase();
    const tab = customFontLanguageByFamily.get(familyKey);
    if (!tab) return;
    setFontLanguageTab(tab);
  }, [customFontLanguageByFamily, selectedTextFontFamily]);

  useEffect(() => {
    if (
      fontLanguageTab === "arabic" &&
      filteredGroupedCustomFonts.arabic.length === 0 &&
      filteredGroupedCustomFonts.english.length > 0
    ) {
      setFontLanguageTab("english");
      return;
    }
    if (
      fontLanguageTab === "english" &&
      filteredGroupedCustomFonts.english.length === 0 &&
      filteredGroupedCustomFonts.arabic.length > 0
    ) {
      setFontLanguageTab("arabic");
    }
  }, [
    filteredGroupedCustomFonts.arabic.length,
    filteredGroupedCustomFonts.english.length,
    fontLanguageTab,
  ]);

  const onUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const uploaded = await uploadEditorMediaFile(file, "image");
        addImageElement(uploaded.url, {
          name: file.name.replace(/\.[^.]+$/, "") || "upload",
          width: Math.min(780, activePage.width * 0.65),
          height: Math.min(780, activePage.height * 0.48),
          rasterOriginalSrc: uploaded.url,
        });

        const importedResponse = await fetch("/api/editor/elements/imported", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: "upload",
            sourceAssetId: uploaded.path || uploaded.url,
            kind: "image",
            title: file.name.replace(/\.[^.]+$/, "") || "Image Upload",
            titleEn: file.name.replace(/\.[^.]+$/, "") || "Image Upload",
            titleAr: file.name.replace(/\.[^.]+$/, "") || "Image Upload",
            assetUrl: uploaded.url,
            thumbnailUrl: uploaded.url,
            freeSvg: false,
            sourcePayload: {
              mimeType: uploaded.mimeType || file.type || "image/png",
              fileName: uploaded.fileName || file.name || "",
              uploadedPath: uploaded.path || "",
            },
          }),
        }).catch(() => null);
        if (activeTab === "elements" && importedResponse?.ok) {
          const importedPayload = await importedResponse.json().catch(() => null);
          if (importedPayload?.id && importedPayload?.assetUrl) {
            const normalizedItem: ImportedElementRecord = {
              id: String(importedPayload.id || ""),
              source: String(importedPayload.source || "upload"),
              sourceAssetId: String(importedPayload.sourceAssetId || uploaded.path || uploaded.url),
              kind:
                importedPayload?.kind === "icon" ||
                importedPayload?.kind === "vector" ||
                importedPayload?.kind === "image"
                  ? importedPayload.kind
                  : "image",
              title: String(
                importedPayload.title ||
                  importedPayload.titleEn ||
                  importedPayload.titleAr ||
                  file.name.replace(/\.[^.]+$/, "") ||
                  "Image Upload"
              ),
              titleEn: String(importedPayload.titleEn || importedPayload.title || ""),
              titleAr: String(importedPayload.titleAr || importedPayload.title || ""),
              tags: Array.isArray(importedPayload.tags)
                ? importedPayload.tags.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              labels: Array.isArray(importedPayload.labels)
                ? importedPayload.labels.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              assetUrl: String(importedPayload.assetUrl || uploaded.url),
              thumbnailUrl: String(importedPayload.thumbnailUrl || importedPayload.assetUrl || uploaded.url),
              animatedVideoUrl: String(importedPayload.animatedVideoUrl || ""),
              width: Number.isFinite(Number(importedPayload.width)) ? Number(importedPayload.width) : null,
              height: Number.isFinite(Number(importedPayload.height)) ? Number(importedPayload.height) : null,
              freeSvg: Boolean(importedPayload.freeSvg ?? false),
            };
            setImportedElements((current) => {
              const deduped = new Map<string, ImportedElementRecord>();
              deduped.set(normalizedItem.id, normalizedItem);
              current.forEach((item) => {
                if (!deduped.has(item.id)) deduped.set(item.id, item);
              });
              return Array.from(deduped.values());
            });
            setImportedElementsTotal((current) => current + 1);
          }
        }
      } catch (_error) {
      }
    }
  };

  const onUploadVideos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/")) continue;
      try {
        const uploaded = await uploadEditorMediaFile(file, "video");
        addVideoElement(uploaded.url, {
          name: file.name.replace(/\.[^.]+$/, "") || "Video",
          width: Math.min(960, activePage.width * 0.7),
          height: Math.min(540, activePage.height * 0.5),
        });
      } catch (_error) {
      }
    }
  };

  const handleLayerDrop = (targetId: string, position: "before" | "after") => {
    if (!dragLayerId || dragLayerId === targetId) {
      setDragLayerId("");
      setDragOver({ id: "", position: "before" });
      return;
    }
    const sourceLayer = layers.find((layer) => layer.id === dragLayerId);
    const targetLayer = layers.find((layer) => layer.id === targetId);
    if (!sourceLayer || !targetLayer) {
      setDragLayerId("");
      setDragOver({ id: "", position: "before" });
      return;
    }
    const mappedPosition = position === "before" ? "after" : "before";
    reorderLayer(dragLayerId, targetId, mappedPosition);
    setDragLayerId("");
    setDragOver({ id: "", position: "before" });
  };

  const handleLayerSelect = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, layerId: string) => {
      const additiveSelectionPressed = event.shiftKey || event.ctrlKey || event.metaKey;
      if (additiveSelectionPressed) {
        if (selectedIds.includes(layerId)) {
          setSelectedIds(selectedIds.filter((item) => item !== layerId));
        } else {
          setSelectedIds([...selectedIds, layerId]);
        }
        return;
      }
      if (selectedIds.length === 1 && selectedIds[0] === layerId) return;
      setSelectedIds([layerId]);
    },
    [selectedIds, setSelectedIds]
  );

  const handleImportedElementsScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      if (importedElementsLoading || !importedElementsHasNextPage) return;
      if (importedElementsScrollLockRef.current) return;
      const target = event.currentTarget;
      const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 40;
      if (!nearBottom) return;
      importedElementsScrollLockRef.current = true;
      setImportedElementsPage((current) => current + 1);
    },
    [importedElementsHasNextPage, importedElementsLoading]
  );

  const applyFontToSelectedTextLayers = (
    familyName: string,
    targetIdsOverride?: string[],
    options?: { recordHistory?: boolean }
  ) => {
    const normalizedFamily = normalizeFontFamilyName(familyName);
    if (!normalizedFamily) return;
    const shouldRecordHistory = options?.recordHistory !== false;
    const targetIds = Array.isArray(targetIdsOverride)
      ? targetIdsOverride.filter(Boolean)
      : selectedTextLayerIds;
    if (targetIds.length === 0) {
      const hasAnyTextLayer = layers.some((element) => element.type === "text");
      if (!hasAnyTextLayer) {
        addTextElement("Text", {
          name: "Text",
          fontFamily: normalizedFamily,
        });
        registerFontFamilies([normalizedFamily]);
      }
      return;
    }
    targetIds.forEach((id) => {
      updateElement(
        id,
        { fontFamily: normalizedFamily },
        { recordHistory: false }
      );
    });
    registerFontFamilies([normalizedFamily]);
    if (shouldRecordHistory) {
      recordHistory();
    }
  };

  useEffect(() => {
    if (activeTab !== "templates") return;

    let cancelled = false;
    const load = async () => {
      setTemplatesLoading(true);
      setTemplatesError("");

      try {
        const response = await fetch("/api/templates", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load templates.");
        }
        if (cancelled) return;
        const templates = Array.isArray(payload?.templates) ? (payload.templates as StoredTemplate[]) : [];
        setStoredTemplates(templates);
      } catch (error: unknown) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load templates.";
        setTemplatesError(message);
      } finally {
        if (cancelled) return;
        setTemplatesLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "elements") return;

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setImportedElementsLoading(true);
      if (importedElementsPage <= 1) {
        setImportedElementsError("");
      }
      try {
        const params = new URLSearchParams({
          source: "all",
          kind: importedElementsKindTab,
          query: elementSearch.trim(),
          page: String(importedElementsPage),
          pageSize: "40",
        });
        const response = await fetch(`/api/editor/elements/imported?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load imported elements.");
        }
        if (cancelled) return;
        const items = Array.isArray(payload?.items) ? (payload.items as ImportedElementRecord[]) : [];
        const normalizedItems = items
          .map((item) => ({
            id: String(item?.id || ""),
            source: String(item?.source || "freepik"),
            sourceAssetId: String(item?.sourceAssetId || ""),
            kind:
              item?.kind === "icon" || item?.kind === "vector" || item?.kind === "image"
                ? item.kind
                : "icon",
            title: String(item?.title || item?.titleEn || item?.titleAr || ""),
            titleEn: String(item?.titleEn || ""),
            titleAr: String(item?.titleAr || ""),
            tags: Array.isArray(item?.tags) ? item.tags.map((value) => String(value || "")).filter(Boolean) : [],
            labels: Array.isArray(item?.labels) ? item.labels.map((value) => String(value || "")).filter(Boolean) : [],
            assetUrl: String(item?.assetUrl || ""),
            thumbnailUrl: String(item?.thumbnailUrl || item?.assetUrl || ""),
            animatedVideoUrl: String(item?.animatedVideoUrl || ""),
            width: Number.isFinite(Number(item?.width)) ? Number(item.width) : null,
            height: Number.isFinite(Number(item?.height)) ? Number(item.height) : null,
            freeSvg: Boolean(item?.freeSvg),
          }))
          .filter((item) => item.id && item.assetUrl);
        setImportedElements((current) => {
          if (importedElementsPage <= 1) {
            return normalizedItems;
          }
          const deduped = new Map(current.map((item) => [item.id, item]));
          normalizedItems.forEach((item) => deduped.set(item.id, item));
          return Array.from(deduped.values());
        });
        setImportedElementsTotal(Math.max(0, Number(payload?.total || 0)));
        setImportedElementsHasNextPage(Boolean(payload?.hasNextPage));
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Failed to load imported elements.";
        setImportedElementsError(message);
        if (importedElementsPage <= 1) {
          setImportedElements([]);
          setImportedElementsTotal(0);
          setImportedElementsHasNextPage(false);
        }
      } finally {
        if (!cancelled) {
          setImportedElementsLoading(false);
          importedElementsScrollLockRef.current = false;
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeTab, elementSearch, importedElementsKindTab, importedElementsPage]);

  const handleDeleteImportedElement = useCallback(
    async (elementId: string) => {
      const id = String(elementId || "").trim();
      if (!id || deletingImportedElementId === id) return;

      setDeletingImportedElementId(id);
      try {
        const response = await fetch("/api/editor/elements/imported", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete imported element.");
        }

        setImportedElements((current) => current.filter((item) => item.id !== id));
        setImportedElementsTotal((current) => Math.max(0, current - 1));
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to delete imported element.";
        setImportedElementsError(message);
      } finally {
        setDeletingImportedElementId((current) => (current === id ? "" : current));
      }
    },
    [deletingImportedElementId]
  );

  useEffect(() => {
    let cancelled = false;
    const loadTaxonomy = async () => {
      setTaxonomyLoading(true);
      try {
        const response = await fetch("/api/settings/template-taxonomy", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load categories.");
        }
        if (cancelled) return;
        const settings = Array.isArray(payload?.settings)
          ? (payload.settings as TaxonomyCategorySetting[])
          : [];
        setTaxonomySettings(settings);
      } catch {
        if (cancelled) return;
      } finally {
        if (cancelled) return;
        setTaxonomyLoading(false);
      }
    };

    void loadTaxonomy();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCustomFonts = async () => {
      setCustomFontsLoading(true);
      try {
        const response = await fetch("/api/editor/fonts", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load custom fonts.");
        }
        if (cancelled) return;
        const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
        setCustomFonts(fonts);
        fonts.forEach((font) => void ensureCustomFontFaceInDocument(font));
        registerFontFamilies(fonts.map((font) => font.family));
      } catch {
        if (cancelled) return;
      } finally {
        if (cancelled) return;
        setCustomFontsLoading(false);
      }
    };

    void loadCustomFonts();
    return () => {
      cancelled = true;
    };
  }, [registerFontFamilies]);

  const handleTemplateSelect = useCallback((
    template: StoredTemplate,
    options?: { requestedTemplateId?: string; requestedUpdatedAt?: string }
  ) => {
    const design = toEditorDesignFromTemplate(template, activePage.width, activePage.height);
    if (!design) {
      window.alert("Template has unsupported data format.");
      return;
    }
    const usedFonts = extractImportUsedFonts(template.data);
    const designFonts = collectDesignTextFonts(design);
    registerFontFamilies([...usedFonts, ...designFonts]);
    const missingUsedFonts = usedFonts.filter(
      (family) =>
        !customFontFamilies.some((customFamily) => customFamily.toLowerCase() === family.toLowerCase())
    );
    if (missingUsedFonts.length > 0) {
      void (async () => {
        try {
          const response = await fetch("/api/editor/fonts", { cache: "no-store" });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) return;
          const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
          setCustomFonts(fonts);
          fonts.forEach((font) => void ensureCustomFontFaceInDocument(font));
          registerFontFamilies(fonts.map((font) => font.family));
        } catch (_error) {
          // Keep template import resilient; user can refresh fonts from My fonts.
        }
      })();
    }
    loadDesign(design);
    setTemplateMeta({
      id: String(template.id || ""),
      name: String(template.name || ""),
      status: template.status === "published" ? "published" : "draft",
      category: String(template.category || "general"),
      subCategory: String(template.subCategory || "general"),
      tags: Array.isArray(template.tags) ? template.tags : [],
    });
    loadedTemplateSignatureRef.current = buildTemplateLoadSignature(
      String(options?.requestedTemplateId || template.id || ""),
      String(options?.requestedUpdatedAt || template.updatedAt || "")
    );
  }, [
    activePage.height,
    activePage.width,
    customFontFamilies,
    loadDesign,
    registerFontFamilies,
    setTemplateMeta,
  ]);

  useEffect(() => {
    if (!activeTemplateCategory || activeTemplateCategory !== activeCategoryValue) {
      setTemplateMeta({ category: activeCategoryValue });
    }
  }, [activeCategoryValue, activeTemplateCategory, setTemplateMeta]);

  useEffect(() => {
    const normalizedActiveSubCategory = String(activeTemplateSubCategory || "")
      .trim()
      .toLowerCase();
    const isValidSubCategory = activeSubCategoryOptions.some(
      (item) => item.value === normalizedActiveSubCategory
    );
    if (!isValidSubCategory) {
      setTemplateMeta({
        subCategory: activeSubCategoryOptions[0]?.value || "general",
      });
    }
  }, [activeSubCategoryOptions, activeTemplateSubCategory, setTemplateMeta]);

  useEffect(() => {
    if (!templateIdFromQuery) return;
    const requestedSignature = buildTemplateLoadSignature(
      templateIdFromQuery,
      templateUpdatedAtFromQuery
    );
    if (loadedTemplateSignatureRef.current === requestedSignature) return;

    let cancelled = false;
    const controller = new AbortController();
    setTemplatesError("");
    const loadRequestedTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${encodeURIComponent(templateIdFromQuery)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load template.");
        }

        if (cancelled) return;
        const template = payload?.template as StoredTemplate | undefined;
        if (!template) {
          throw new Error("Template not found.");
        }

        const currentParams = new URLSearchParams(window.location.search || "");
        const currentSignature = buildTemplateLoadSignature(
          String(currentParams.get("templateId") || "").trim(),
          String(currentParams.get("updatedAt") || "").trim()
        );
        if (currentSignature !== requestedSignature) return;

        handleTemplateSelect(template, {
          requestedTemplateId: templateIdFromQuery,
          requestedUpdatedAt: templateUpdatedAtFromQuery,
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message =
          error instanceof Error ? error.message : "Failed to load template.";
        setTemplatesError(message);
      }
    };

    void loadRequestedTemplate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [handleTemplateSelect, templateIdFromQuery, templateUpdatedAtFromQuery]);

  const handleCustomFontUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setUploadingCustomFont(true);
    try {
      const preferredFamily = normalizeFontFamilyName(customFontFamilyInput);
      const fallbackFamily = sanitizeFontFamilyFromFileName(file.name);
      const family = preferredFamily || fallbackFamily;
      if (!family) {
        throw new Error("Enter a font family name that matches Canva.");
      }
      const uploaded = await uploadEditorMediaFile(file, "font");

      const response = await fetch("/api/editor/fonts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family,
          fileName: file.name,
          mimeType: uploaded.mimeType || file.type,
          fileUrl: uploaded.url,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to upload custom font.");
      }

      const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
      const savedFont = payload?.font as CustomFontRecord | null;
      setCustomFonts(fonts);
      if (savedFont) {
        void ensureCustomFontFaceInDocument(savedFont);
      } else {
        fonts.forEach((font) => void ensureCustomFontFaceInDocument(font));
      }
      registerFontFamilies(fonts.map((font) => font.family));
      setCustomFontFamilyInput(family);
    } catch {
    } finally {
      setUploadingCustomFont(false);
      if (customFontInputRef.current) {
        customFontInputRef.current.value = "";
      }
    }
  };

  const handleDeleteCustomFont = async (font: CustomFontRecord) => {
    if (!font?.id) return;
    setDeletingCustomFontId(font.id);
    try {
      const response = await fetch("/api/editor/fonts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: font.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete custom font.");
      }
      const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
      setCustomFonts(fonts);
      if (typeof document !== "undefined") {
        const styleId = `editor-custom-font-face-${font.id}`;
        document.getElementById(styleId)?.remove();
      }
    } catch {
    } finally {
      setDeletingCustomFontId("");
    }
  };

  const renderFontCard = (font: CustomFontRecord) => {
    const fontDisplay = deriveReadableFontLabel(font);
    const fontSource = String(font.source || "custom").trim().toLowerCase();
    const removable = font.removable !== false && fontSource === "custom";
    const isSelected =
      Boolean(selectedTextFontFamily) &&
      font.family.toLowerCase() === selectedTextFontFamily.toLowerCase();

    return (
      <div
        key={font.id}
        className={`w-full rounded-md border bg-white p-2 ${isSelected ? "border-[#2c68be]" : "border-[#d3d8e1]"}`}
      >
        <button
          type="button"
          className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-left text-sm font-medium text-[#0f172a]"
          style={{ fontFamily: resolveCssFontFamily(font.family) }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            const targetTextIds = [...selectedTextLayerIds];
            applyFontToSelectedTextLayers(font.family, targetTextIds, {
              recordHistory: true,
            });
            void ensureCustomFontFaceInDocument(font).then(() => {
              applyFontToSelectedTextLayers(font.family, targetTextIds, {
                recordHistory: false,
              });
            });
          }}
          title={font.family}
        >
          {fontDisplay}
        </button>
        <div className="mt-2 flex min-w-0 items-center justify-end gap-2 text-[11px] text-[#64748b]">
          <div className="flex shrink-0 items-center gap-2">
            {fontSource !== "custom" ? (
              <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#4b5563]">
                {fontSource}
              </span>
            ) : null}
            {isSelected ? (
              <span className="rounded-full bg-[#e7f0ff] px-2 py-0.5 text-[10px] font-semibold text-[#2c68be]">
                Selected
              </span>
            ) : null}
            {removable ? (
              <Button
                type="button"
                variant="destructive"
                className="!h-7 !px-2 !text-[11px]"
                onClick={() => void handleDeleteCustomFont(font)}
                disabled={deletingCustomFontId === font.id}
              >
                {deletingCustomFontId === font.id ? "Removing..." : "Remove"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside
      className={`relative flex min-h-0 shrink-0 border-r border-[#d7dbe1] bg-[#f3f4f6] transition-[width] duration-300 ease-out ${
        collapsed ? "w-[70px]" : "w-[376px]"
      }`}
    >
      <div className="flex w-[68px] shrink-0 flex-col items-center border-r border-[#d7dbe1] bg-white py-2">
        {TOOL_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setSidebarTab(tab.key);
                if (collapsed) {
                  setShowLeftSidebar(true);
                }
              }}
              className={`mb-1 flex w-full flex-col items-center gap-1 py-2.5 text-[11px] transition ${
                active ? "bg-[#dce9fb] text-[#0f172a]" : "text-[#1f2937] hover:bg-[#eef3fa]"
              }`}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Expand panel"
        title="Expand panel"
        onClick={() => setShowLeftSidebar(true)}
        className={`absolute left-[65px] top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-r-full border border-l-0 border-[#d7dbe1] bg-[#f5f6f8] text-[#8c95a3] shadow-sm transition-opacity duration-150 ${
          collapsed ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ChevronRight size={14} />
      </button>

      <div
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-visible bg-[#f5f6f8] transition-[opacity,transform] duration-200 ${
          collapsed ? "pointer-events-none translate-x-2 opacity-0" : "translate-x-0 opacity-100"
        }`}
        aria-hidden={collapsed}
      >
        <button
          type="button"
          aria-label="Collapse panel"
          onClick={() => setShowLeftSidebar(false)}
          className={`absolute -right-3 top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-r-full border border-l-0 border-[#d7dbe1] bg-[#f5f6f8] text-[#8c95a3] transition-opacity duration-150 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <ChevronLeft size={14} />
        </button>

        <div
          className={`flex-1 overflow-x-hidden overflow-y-auto p-2 transition-opacity duration-150 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => void onUploadFiles(event.target.files)}
          />

          {activeTab === "templates" ? (
              <section className="space-y-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-[#798293]" />
                  <Input className="!h-9 !rounded-full !bg-white !pl-9" placeholder="Search..." value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
                </div>

                <label className="flex items-center justify-between text-[14px] text-[#202a38]">
                  <span>Show templates with the same size</span>
                  <button
                    type="button"
                    onClick={() => setSameSizeOnly((value) => !value)}
                    className={`relative h-5 w-8 rounded-full transition ${sameSizeOnly ? "bg-[#2f6fca]" : "bg-[#c8ced8]"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${sameSizeOnly ? "left-3.5" : "left-0.5"}`} />
                  </button>
                </label>

                {templatesLoading ? (
                  <div className="rounded-md border border-[#d3d8e1] bg-white p-3 text-xs text-[#5a6679]">
                    Loading templates...
                  </div>
                ) : null}

                {templatesError ? (
                  <div className="rounded-md border border-[#f1c7c7] bg-[#fff3f3] p-3 text-xs text-[#8b2f2f]">
                    {templatesError}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  {filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setTemplatesError("");
                        updateTemplateQueryInUrl(template.id, String(template.updatedAt || ""));
                      }}
                      className="overflow-hidden rounded-md border border-[#d3d8e1] bg-white text-left shadow-sm hover:border-[#9fb4d6]"
                    >
                      <div className="relative h-24 bg-[#eef1f6]">
                        {template.thumbnailDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={template.thumbnailDataUrl} alt={template.name} className="h-full w-full object-cover" />
                        ) : null}
                        <div
                          className="absolute bottom-1 left-1 right-1 rounded bg-black/40 px-1 py-0.5 text-[10px] font-medium text-white"
                          title={template.name}
                        >
                          <span className="block truncate whitespace-nowrap">
                            {template.name}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {!templatesLoading && !templatesError && filteredTemplates.length === 0 ? (
                  <div className="rounded-md border border-[#d3d8e1] bg-white p-3 text-xs text-[#5a6679]">
                    No templates found.
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "text" ? (
              <section className="min-w-0 w-full space-y-3">
                <div className="border-b border-[#d7dbe1] pb-2 text-sm font-semibold text-[#2c68be]">
                  My fonts
                </div>

                <div className="min-w-0 w-full space-y-3">
                  <input
                    ref={customFontInputRef}
                    type="file"
                    accept={FONT_UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={(event) => void handleCustomFontUpload(event.target.files)}
                  />
                  <Input
                    placeholder="Search fonts..."
                    value={fontSearchQuery}
                    onChange={(event) => setFontSearchQuery(event.target.value)}
                  />
                  <Input
                    placeholder="Font family (match Canva name)"
                    value={customFontFamilyInput}
                    onChange={(event) => setCustomFontFamilyInput(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="!h-9 !w-full !justify-center !rounded-md"
                    onClick={() => customFontInputRef.current?.click()}
                    disabled={uploadingCustomFont}
                  >
                    {uploadingCustomFont ? "Uploading..." : "Upload font file"}
                  </Button>

                  <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#334155]">
                    {selectedTextFontFamily ? (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-[#64748b]">Selected text font</span>
                        <span
                          className="min-w-0 truncate text-sm font-semibold text-[#0f172a]"
                          style={{ fontFamily: resolveCssFontFamily(selectedTextFontFamily) }}
                          title={selectedTextFontFamily}
                        >
                          {selectedTextFontDisplay}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[#64748b]">Select a text layer to view its current font.</span>
                    )}
                  </div>

                  {customFontsLoading ? (
                    <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                      Loading custom fonts...
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-1 rounded-md border border-[#d3d8e1] bg-white p-1">
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                          fontLanguageTab === "arabic"
                            ? "bg-[#dce9fb] text-[#0f172a]"
                            : "text-[#64748b] hover:bg-[#eef3fa]"
                        }`}
                        onClick={() => setFontLanguageTab("arabic")}
                      >
                        Arabic ({filteredGroupedCustomFonts.arabic.length})
                      </button>
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                          fontLanguageTab === "english"
                            ? "bg-[#dce9fb] text-[#0f172a]"
                            : "text-[#64748b] hover:bg-[#eef3fa]"
                        }`}
                        onClick={() => setFontLanguageTab("english")}
                      >
                        English ({filteredGroupedCustomFonts.english.length})
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(fontLanguageTab === "arabic"
                        ? filteredGroupedCustomFonts.arabic
                        : filteredGroupedCustomFonts.english
                      ).map(renderFontCard)}
                    </div>
                  </div>

                  {!customFontsLoading && customFonts.length === 0 ? (
                    <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                      No fonts available.
                    </div>
                  ) : !customFontsLoading &&
                    (fontLanguageTab === "arabic"
                      ? filteredGroupedCustomFonts.arabic.length === 0
                      : filteredGroupedCustomFonts.english.length === 0) ? (
                    <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                      {fontSearchQuery.trim()
                        ? `No matching ${fontLanguageTab} fonts for "${fontSearchQuery.trim()}".`
                        : `No ${fontLanguageTab} fonts available.`}
                    </div>
                  ) : null}

                </div>
              </section>
            ) : null}

            {activeTab === "videos" ? (
              <section className="space-y-3">
                <div className="text-base font-semibold text-[#1f2a39]">Upload videos</div>
                <input
                  ref={videoUploadInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void onUploadVideos(event.target.files);
                    if (event.currentTarget) {
                      event.currentTarget.value = "";
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-9 !w-full !justify-center !rounded-md"
                  onClick={() => videoUploadInputRef.current?.click()}
                >
                  + Upload video
                </Button>

                <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                  Uploaded videos are added as editable video layers. External video libraries are disabled.
                </div>

                <div className="space-y-2">
                  {activePage.elements
                    .filter((element) => element.type === "video")
                    .slice()
                    .reverse()
                    .map((videoLayer) => (
                      <button
                        key={videoLayer.id}
                        type="button"
                        onClick={() => setSelectedIds([videoLayer.id])}
                        className={`w-full rounded-md border bg-white p-2 text-left text-sm ${
                          selectedIds.includes(videoLayer.id) ? "border-[#2c68be]" : "border-[#d3d8e1]"
                        }`}
                      >
                        <div className="truncate font-medium text-[#0f172a]">
                          {layerDisplayName(videoLayer, activePage)}
                        </div>
                        <div className="mt-1 text-xs text-[#64748b]">
                          {Math.max(1, Math.round(videoLayer.width))}x{Math.max(1, Math.round(videoLayer.height))} px
                        </div>
                      </button>
                    ))}
                </div>

                {activePage.elements.every((element) => element.type !== "video") ? (
                  <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                    No video layers yet.
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "elements" ? (
              <section className="flex h-full min-h-0 flex-col gap-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-[#798293]" />
                  <Input className="!h-9 !rounded-full !bg-white !pl-9" placeholder="Search..." value={elementSearch} onChange={(event) => setElementSearch(event.target.value)} />
                </div>

                <div className="flex min-h-0 flex-1 flex-col rounded-md border border-[#d3d8e1] bg-white p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#202a38]">
                      Imported ({importedElementsTotal})
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Upload image"
                        title="Upload image"
                        onClick={() => uploadInputRef.current?.click()}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#d3d8e1] bg-white text-[#4b5565] transition hover:bg-[#eef3fa]"
                      >
                        <Upload size={14} />
                      </button>
                      <div className="inline-flex rounded-full border border-[#d3d8e1] bg-[#f2f4f7] p-0.5 text-[11px]">
                        {[
                          { key: "all", label: "All" },
                          { key: "icon", label: "Icons" },
                        ].map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className={`rounded-full px-2 py-0.5 ${
                              importedElementsKindTab === item.key
                                ? "bg-white font-semibold text-[#1f2a39]"
                                : "text-[#637087]"
                            }`}
                            onClick={() =>
                              setImportedElementsKindTab(item.key as "all" | "icon")
                            }
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div
                    className="min-h-0 flex-1 overflow-y-auto pr-1"
                    onScroll={handleImportedElementsScroll}
                  >
                    {importedElements.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {importedElements.map((item) => {
                          const isGifAsset = isGifSource(item.assetUrl);
                          const videoSource = deriveFreepikAnimatedVideoUrl(item);
                          const addAsVideo = !isGifAsset && isVideoSource(videoSource);
                          const deletingImported = deletingImportedElementId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              draggable
                              onDragStart={(event) => {
                                const payload = addAsVideo
                                  ? assetPayload({
                                      kind: "video",
                                      src: videoSource,
                                    })
                                  : assetPayload({
                                        payload: {
                                          type: "image",
                                          src: item.assetUrl,
                                          name: item.title || "Imported Icon",
                                          rasterOriginalSrc: item.assetUrl,
                                        },
                                      });
                                event.dataTransfer.setData(
                                  "application/x-editor-asset",
                                  payload
                                );
                              }}
                              onClick={() =>
                                addAsVideo
                                  ? addVideoElement(videoSource, {
                                      name: item.title || "Imported Icon",
                                    })
                                  : addImageElement(item.assetUrl, {
                                      name: item.title || "Imported Icon",
                                      rasterOriginalSrc: item.assetUrl,
                                    })
                              }
                              className="rounded-md border border-[#d3d8e1] bg-white p-2 text-left hover:bg-[#f7f9fc]"
                            >
                              <div className="relative">
                                <span
                                  title="Delete imported element"
                                  aria-label="Delete imported element"
                                  role="button"
                                  tabIndex={deletingImported ? -1 : 0}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (deletingImported) return;
                                    void handleDeleteImportedElement(item.id);
                                  }}
                                  onKeyDown={(event) => {
                                    if (deletingImported) return;
                                    if (event.key !== "Enter" && event.key !== " ") return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void handleDeleteImportedElement(item.id);
                                  }}
                                  className={`absolute bottom-1 right-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#fecaca] bg-white text-[#b91c1c] hover:bg-[#fee2e2] ${
                                    deletingImported ? "cursor-not-allowed opacity-60" : ""
                                  }`}
                                >
                                  <Trash2 size={11} />
                                </span>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={resolveImportedElementPreviewUrl(item)}
                                  alt={item.title || "Imported element"}
                                  className="h-20 w-full rounded object-contain"
                                />
                                {isGifAsset ? (
                                  <span className="absolute right-1 top-1 rounded-full bg-[#1f2a39] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                                    GIF
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 truncate text-[11px] font-semibold text-[#1f2a39]">
                                {item.title || "Imported Icon"}
                              </div>
                              <div className="text-[10px] uppercase text-[#64748b]">
                                {item.kind}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {importedElementsLoading && importedElements.length === 0 ? (
                      <div className="py-2 text-xs text-[#64748b]">Loading imported elements...</div>
                    ) : null}

                    {importedElementsError ? (
                      <div className="py-2 text-xs text-[#b45309]">{importedElementsError}</div>
                    ) : null}

                    {!importedElementsLoading && !importedElementsError && importedElements.length === 0 ? (
                      <div className="py-2 text-xs text-[#64748b]">
                        No imported elements found. Import from Freepik or upload an image to build a recolorable elements library.
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-2 flex items-center justify-between border-t border-[#e6e9ef] pt-2 text-[11px] text-[#637087]">
                    <span>
                      Showing {importedElements.length}/{importedElementsTotal}
                    </span>
                    <span>
                      {importedElementsLoading
                        ? "Loading..."
                        : importedElementsHasNextPage
                        ? "Scroll to load more"
                        : "All loaded"}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "category" ? (
              <section className="space-y-3">
                <div className="text-base font-semibold text-[#202a38]">Template category</div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Template name</Label>
                  <Input
                    placeholder="Template name"
                    value={activeTemplateName}
                    onChange={(event) => setTemplateMeta({ name: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Category</Label>
                  <Select
                    value={activeCategoryValue}
                    onChange={(event) => {
                      const nextCategory = String(event.target.value || "general").trim().toLowerCase();
                      const categoryOption =
                        templateCategorySettings.find((item) => item.value === nextCategory) || null;
                      setTemplateMeta({
                        category: nextCategory,
                        subCategory: categoryOption?.subCategories?.[0]?.value || "general",
                      });
                    }}
                    disabled={taxonomyLoading}
                  >
                    {templateCategorySettings.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.labelEn}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Sub category</Label>
                  <Select
                    value={activeSubCategoryValue}
                    onChange={(event) =>
                      setTemplateMeta({
                        subCategory: String(event.target.value || "general").trim().toLowerCase(),
                      })
                    }
                    disabled={activeSubCategoryOptions.length === 0}
                  >
                    {activeSubCategoryOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.labelEn}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Tags (comma separated)</Label>
                  <Input
                    placeholder="ramadan, promo"
                    value={activeTemplateTags.join(", ")}
                    onChange={(event) =>
                      setTemplateMeta({
                        tags: event.target.value
                          .split(",")
                          .map((item) => item.trim().toLowerCase())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>

                <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#4b5565]">
                  <div className="flex items-center justify-between">
                    <span>Status</span>
                    <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 font-semibold text-[#334155]">
                      {activeTemplateStatus}
                    </span>
                  </div>
                  {activeTemplateId ? (
                    <div className="mt-1 truncate text-[11px] text-[#697182]" title={activeTemplateId}>
                      id: {activeTemplateId}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-[#697182]">
                      Save once to create a template id.
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "upload" ? (
              <section className="space-y-3">
                <div className="text-base font-semibold text-[#1f2a39]">Upload your assets</div>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-9 !w-full !justify-center !rounded-md"
                  onClick={() => uploadInputRef.current?.click()}
                >
                  + Add file
                </Button>
              </section>
            ) : null}

            {activeTab === "backgrounds" ? (
              <section className="space-y-3">
                <div className="overflow-x-auto pb-1">
                  <div className="flex min-w-max items-center gap-3">
                    <input
                      ref={backgroundColorInputRef}
                      type="color"
                      className="sr-only"
                      value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(activeBackgroundColor) ? activeBackgroundColor : "#ffffff"}
                      onChange={(event) =>
                        setBackground({
                          type: "color",
                          color: event.target.value || "#ffffff",
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label="Pick custom background color"
                      title="Pick custom color"
                      onClick={() => backgroundColorInputRef.current?.click()}
                      className="flex h-14 w-14 items-center justify-center rounded border border-[#d3d8e1] bg-white shadow-sm hover:bg-[#f8fafc]"
                    >
                      <Palette size={24} className="text-[#b8bec9]" />
                    </button>

                    {COLOR_SWATCHES.map((color) => {
                      const active = activeBackgroundColor.toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() =>
                            setBackground({
                              type: "color",
                              color,
                            })
                          }
                          className={`h-14 w-14 rounded border shadow-sm ${active ? "border-[#2f6fca] ring-2 ring-[#d9e8ff]" : "border-[#d3d8e1]"}`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      );
                    })}

                    <button
                      type="button"
                      aria-label="Reset to default color"
                      title="Reset to default"
                      onClick={() =>
                        setBackground({
                          type: "color",
                          color: "#ffffff",
                        })
                      }
                      className="h-14 w-14 rounded border border-[#d3d8e1] bg-[conic-gradient(#eceef3_25%,#9ea8ba_0_50%,#eceef3_0_75%,#9ea8ba_0)] [background-size:14px_14px] shadow-sm"
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "layers" ? (
              <section className="space-y-3">
                <div className="text-sm font-medium text-[#202a38]">Elements on your active page:</div>

                {layers.length === 0 ? (
                  <div className="text-sm text-[#333f50]">No elements on the page...</div>
                ) : (
                  <div className="space-y-1">
                    {layers.map((layer) => {
                      const selected = selectedIds.includes(layer.id);
                      const dragOverLayer = dragOver.id === layer.id;
                      const displayName = layerDisplayName(layer, activePage);
                      const textColor =
                        layer.type === "text" && String(layer.color || "").trim()
                          ? String(layer.color || "")
                          : "#1f2a39";
                      return (
                        <div
                          key={layer.id}
                          draggable
                          onDragStart={() => {
                            setDragLayerId(layer.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setDragOver({
                              id: layer.id,
                              position: event.clientY - rect.top > rect.height / 2 ? "after" : "before",
                            });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            handleLayerDrop(layer.id, event.clientY - rect.top > rect.height / 2 ? "after" : "before");
                          }}
                          className={`rounded-xl border px-3 py-2 ${
                            selected ? "border-[#7c3aed] bg-[#d9dbe2]" : "border-[#d3d8e1] bg-[#d6d9e1]"
                          } ${
                            dragOverLayer
                              ? dragOver.position === "after"
                                ? "border-b-2 border-b-[#2f6fca]"
                                : "border-t-2 border-t-[#2f6fca]"
                              : ""
                          } cursor-grab`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex h-5 w-5 items-center justify-center text-[#73809a]">
                              <GripVertical size={14} />
                            </div>
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={(event) => handleLayerSelect(event, layer.id)}
                            >
                              <div className="flex items-center gap-2 text-[13px]">
                                <span className="truncate font-semibold" style={{ color: textColor }}>
                                  {displayName}
                                </span>
                              </div>
                            </button>

                            <button type="button" onClick={() => toggleVisibility(layer.id)} className="rounded p-1 text-[#4f5d72] hover:bg-[#e7edf6]">
                              {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleLock(layer.id)}
                              className="rounded p-1 text-[#4f5d72] hover:bg-[#e7edf6]"
                            >
                              {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteElement(layer.id)}
                              className="rounded p-1 text-[#4f5d72] hover:bg-[#e7edf6]"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "resize" ? (
              <section className="space-y-4">
                <label className="flex items-center justify-between text-[15px] text-[#202a38]">
                  <span>Use magic resize</span>
                  <button
                    type="button"
                    onClick={() => setResizeUseMagic(!resizeUseMagic)}
                    className={`relative h-5 w-8 rounded-full transition ${resizeUseMagic ? "bg-[#2f6fca]" : "bg-[#c8ced8]"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${resizeUseMagic ? "left-3.5" : "left-0.5"}`} />
                  </button>
                </label>

                <div className="space-y-2">
                  <label className="block text-sm text-[#2d3748]">Width (px)</label>
                  <Input
                    className="!h-9 !rounded-md !bg-white"
                    value={resizeWidth}
                    onChange={(event) => setResizeWidth(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-[#2d3748]">Height (px)</label>
                  <Input
                    className="!h-9 !rounded-md !bg-white"
                    value={resizeHeight}
                    onChange={(event) => setResizeHeight(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-[#2d3748]">Units</label>
                  <select
                    className="select !h-9 !rounded-md !bg-white"
                    value={resizeUnits}
                    onChange={(event) => setResizeUnits(event.target.value)}
                  >
                    <option value="px">px</option>
                  </select>
                </div>

                <Button
                  type="button"
                  className="!h-9 !w-full !rounded-md"
                  onClick={() => {
                    const width = Number(resizeWidth) || activePage.width;
                    const height = Number(resizeHeight) || activePage.height;
                    resizeActivePage(width, height, { useMagic: resizeUseMagic });
                  }}
                >
                  Resize
                </Button>

                {RESIZE_PRESETS.map((group) => (
                  <div key={group.group} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#222d3d]">
                      {group.icon ? <group.icon size={15} /> : null}
                      <span>{group.group}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {group.items.map((item) => (
                        <button
                          key={`${group.group}-${item.label}`}
                          type="button"
                          className="rounded-md border border-[#d3d8e1] bg-white p-2 text-center text-[11px] text-[#344255] hover:bg-[#f5f8fc]"
                          onClick={() => {
                            setResizeWidth(String(item.width));
                            setResizeHeight(String(item.height));
                            resizeActivePage(item.width, item.height, { useMagic: resizeUseMagic });
                          }}
                        >
                          <div className="font-semibold">{item.label}</div>
                          <div>{item.displaySize || `${item.width}x${item.height} px`}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ) : null}
        </div>
      </div>
    </aside>
  );
}
