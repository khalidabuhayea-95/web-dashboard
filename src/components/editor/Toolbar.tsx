"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  FlipHorizontal,
  FlipVertical,
  Italic,
  Layers,
  Menu,
  Scissors,
  SlidersHorizontal,
  Strikethrough,
  Underline,
  Undo2,
  Redo2,
} from "lucide-react";

import Button from "@/components/ui/button";
import { FilmstripFrames, FilmstripOverlay } from "@/components/editor/TimelineFilmstrip";
import { useTimelineScrubber } from "@/components/editor/useTimelineScrubber";
import { dataUrlToFile, uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import {
  canUseCanvasCropForImage,
  canTrimTransparentPaddingForImage,
  computeClipToCanvasPatch,
  computeFitToCanvasPatch,
  prepareImageElementForCanvasCrop,
  computeTrimTransparentPaddingPatch,
} from "@/lib/editor/imageCrop";
import { normalizeHexColor } from "@/lib/editor/colorUtils";
import {
  extractImagePaletteFromSource,
  normalizeRasterColorMap,
  RASTER_PALETTE_VERSION,
} from "@/lib/editor/imagePalette";
import { formatTimelineTime, hasAnimatedTemplateContent } from "@/lib/editor/animationTimeline";
import { PREVIEW_RENDER_FPS } from "@/lib/editor/previewRuntime";
import { useEditorStore, type EditorDesign, type EditorElement } from "@/store/editorStore";

interface ToolbarProps {
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

type TextDecorationValue =
  | ""
  | "underline"
  | "line-through"
  | "underline line-through";

type TrimRange = {
  start: number;
  end: number;
};

const TEMPLATE_PREVIEW_VIDEO_MAX_DIMENSION = 240;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTrimTime(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return safeValue.toFixed(2);
}

function normalizeTrimRange(startInput: number, endInput: number, durationInput: number): TrimRange {
  const duration = Number.isFinite(durationInput) && durationInput > 0 ? durationInput : Math.max(1, endInput, startInput + 1);
  const minWindow = Math.max(0.08, duration / 600);
  const start = clampNumber(Number.isFinite(startInput) ? startInput : 0, 0, Math.max(0, duration - minWindow));
  let end = Number.isFinite(endInput) ? endInput : duration;
  end = clampNumber(end, start + minWindow, duration);
  return { start, end };
}

const TRIM_TRACK_SLOT_COUNT = 18;
const TRIM_PROGRESSIVE_SAMPLE_COUNT = 4;
const VIDEO_TRIM_HANDLE_WIDTH_PX = 32;

function extensionFromMimeType(mimeType: string) {
  const value = String(mimeType || "").trim().toLowerCase();
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  return "webm";
}

function logPreviewProgress(message: string, details?: Record<string, unknown>) {
  if (details && Object.keys(details).length > 0) {
    console.info("[template-preview]", message, details);
    return;
  }
  console.info("[template-preview]", message);
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function buildCanceledPreviewPayload(fallbackPosterDataUrl: string, templateVersion: number, durationMs: number) {
  return {
    status: "not_requested",
    url: null,
    posterUrl: String(fallbackPosterDataUrl || "").trim() || null,
    durationMs,
    version: templateVersion,
    error: null,
  };
}

export default function Toolbar({ onToggleLeft, onToggleRight }: ToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isPublishingTemplate, setIsPublishingTemplate] = useState(false);
  const [isUnpublishingTemplate, setIsUnpublishingTemplate] = useState(false);
  const [isPublishingElements, setIsPublishingElements] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isVideoTrimOpen, setIsVideoTrimOpen] = useState(false);
  const [isTrimmingImagePadding, setIsTrimmingImagePadding] = useState(false);
  const [previewToast, setPreviewToast] = useState<{
    tone: "info" | "success" | "error";
    message: string;
  } | null>(null);
  const [videoTrimDraft, setVideoTrimDraft] = useState<TrimRange>({ start: 0, end: 1 });
  const [videoTrimDragEdge, setVideoTrimDragEdge] = useState<"start" | "end" | null>(null);
  const [videoTrimPlayhead, setVideoTrimPlayhead] = useState(0);
  const [videoTrimFrameStrip, setVideoTrimFrameStrip] = useState<string[]>([]);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);
  const videoTrimViewportRef = useRef<HTMLDivElement | null>(null);
  const videoTrimDraftRef = useRef<TrimRange>({ start: 0, end: 1 });
  const videoTrimFrameCacheRef = useRef<Map<string, string[]>>(new Map());
  const previewGenerationIdRef = useRef(0);
  const saveAbortControllerRef = useRef<AbortController | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const unloadAbortHandledRef = useRef(false);
  const activePreviewCancelRef = useRef<{
    templateId: string;
    preview: ReturnType<typeof buildCanceledPreviewPayload>;
    controller: AbortController;
  } | null>(null);
  const [videoTrimViewportWidth, setVideoTrimViewportWidth] = useState(0);

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const availableFontFamilies = useEditorStore((state) => state.availableFontFamilies);
  const activeTemplateId = useEditorStore((state) => state.activeTemplateId);
  const activeTemplateName = useEditorStore((state) => state.activeTemplateName);
  const activeTemplateStatus = useEditorStore((state) => state.activeTemplateStatus);
  const activeTemplateCategory = useEditorStore((state) => state.activeTemplateCategory);
  const activeTemplateSubCategory = useEditorStore((state) => state.activeTemplateSubCategory);
  const activeTemplateTags = useEditorStore((state) => state.activeTemplateTags);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const publishCandidateIds = useEditorStore((state) => state.publishCandidateIds);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const historyLength = useEditorStore((state) => state.history.length);
  const stageApi = useEditorStore((state) => state.stageApi);
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const timelineIsPlaying = useEditorStore((state) => state.timelineIsPlaying);

  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const flipSelected = useEditorStore((state) => state.flipSelected);
  const exportDesign = useEditorStore((state) => state.exportDesign);
  const updateElement = useEditorStore((state) => state.updateElement);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);
  const setTemplateMeta = useEditorStore((state) => state.setTemplateMeta);
  const updateTimeline = useEditorStore((state) => state.updateTimeline);
  const setTimelinePlaying = useEditorStore((state) => state.setTimelinePlaying);
  const setPreviewGenerationActive = useEditorStore((state) => state.setPreviewGenerationActive);
  const clearTemplateMeta = useEditorStore((state) => state.clearTemplateMeta);
  const bumpImportedElementsRefreshKey = useEditorStore((state) => state.bumpImportedElementsRefreshKey);
  const clearPublishCandidates = useEditorStore((state) => state.clearPublishCandidates);

  const hasSelection = selectedIds.length > 0;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyLength - 1;
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );
  const templateQueryKey = useMemo(() => searchParams.toString(), [searchParams]);
  const templateIdFromQuery = useMemo(
    () => String(new URLSearchParams(templateQueryKey).get("templateId") || "").trim(),
    [templateQueryKey]
  );

  useEffect(() => {
    if (templateIdFromQuery && templateIdFromQuery !== activeTemplateId) {
      setTemplateMeta({ id: templateIdFromQuery });
    }
  }, [activeTemplateId, setTemplateMeta, templateIdFromQuery]);

  const buildEditorUrl = useCallback((templateId: string) => {
    const params = new URLSearchParams(templateQueryKey);
    if (templateId) {
      params.set("templateId", templateId);
    } else {
      params.delete("templateId");
    }
    const nextQuery = params.toString();
    return nextQuery ? `/editor-pro?${nextQuery}` : "/editor-pro";
  }, [templateQueryKey]);

  const updateTemplateIdInUrl = useCallback(
    (templateId: string) => {
      router.replace(buildEditorUrl(templateId));
    },
    [buildEditorUrl, router]
  );
  const selectedElements = useMemo(() => {
    if (!activePage || selectedIds.length === 0) return [];
    const selectedSet = new Set(selectedIds);
    return activePage.elements.filter((element) => selectedSet.has(element.id));
  }, [activePage, selectedIds]);
  const selectedTextElements = useMemo(
    () => selectedElements.filter((element): element is EditorElement & { type: "text" } => element.type === "text"),
    [selectedElements]
  );
  const selectedImageElements = useMemo(
    () => selectedElements.filter((element): element is EditorElement & { type: "image" } => element.type === "image"),
    [selectedElements]
  );
  const selectedVideoElements = useMemo(
    () => selectedElements.filter((element): element is EditorElement & { type: "video" } => element.type === "video"),
    [selectedElements]
  );
  const hasOnlyTextSelection = selectedTextElements.length > 0 && selectedTextElements.length === selectedElements.length;
  const hasSingleImageSelection = selectedElements.length === 1 && selectedImageElements.length === 1;
  const hasSingleVideoSelection = selectedElements.length === 1 && selectedVideoElements.length === 1;
  const canMergeSelection = selectedElements.length > 1;
  const hasVideoInSelection = selectedElements.some((element) => element.type === "video");
  const activeTextElement = hasOnlyTextSelection ? selectedTextElements[0] : null;
  const activeImageElement = hasSingleImageSelection ? selectedImageElements[0] : null;
  const activeVideoElement = hasSingleVideoSelection ? selectedVideoElements[0] : null;
  const activeImageId = String(activeImageElement?.id || "");
  const activeImageSrc = String(activeImageElement?.src || "").trim();
  const activeImageRasterOriginalSrc = String(activeImageElement?.rasterOriginalSrc || "").trim();
  const activeRasterSource = useMemo(() => {
    const source = String(activeImageElement?.rasterOriginalSrc || activeImageSrc || "").trim();
    return source || "";
  }, [activeImageElement?.rasterOriginalSrc, activeImageSrc]);
  const activeRasterPalette = Array.isArray(activeImageElement?.rasterPalette)
    ? activeImageElement.rasterPalette
        .map((value) => normalizeHexColor(String(value || "")))
        .filter((value): value is string => Boolean(value))
    : ([] as string[]);
  const activeRasterPaletteVersion = Math.max(0, Number(activeImageElement?.rasterPaletteVersion || 0));
  const activeRasterColorMap = normalizeRasterColorMap(activeImageElement?.rasterColorMap);
  const activeRasterPaletteLoading = Boolean(
    hasSingleImageSelection &&
      activeImageId &&
      activeRasterSource &&
      (activeImageRasterOriginalSrc !== activeRasterSource || activeRasterPaletteVersion < RASTER_PALETTE_VERSION)
  );
  const activeVideoDuration = Number(activeVideoElement?.videoDuration || 0);
  const previewTimelineDurationMs = useMemo(
    () => Math.max(1, Math.round(designTimeline.totalDurationMs || activePage?.durationMs || 0)),
    [activePage?.durationMs, designTimeline.totalDurationMs]
  );
  const resolvedVideoDuration = useMemo(() => {
    if (Number.isFinite(activeVideoDuration) && activeVideoDuration > 0) return activeVideoDuration;
    const fallbackEnd = Number(activeVideoElement?.videoEnd);
    if (Number.isFinite(fallbackEnd) && fallbackEnd > 0) return fallbackEnd;
    return Math.max(1, (activeVideoElement?.videoStart || 0) + 1);
  }, [activeVideoDuration, activeVideoElement?.videoEnd, activeVideoElement?.videoStart]);
  const videoTrimFrameCacheKey = useMemo(
    () => String(activeVideoElement?.src || ""),
    [activeVideoElement?.src]
  );
  const fontOptions = useMemo(() => {
    const set = new Set(availableFontFamilies);
    if (activeTextElement?.fontFamily) {
      set.add(activeTextElement.fontFamily);
    }
    return Array.from(set);
  }, [activeTextElement?.fontFamily, availableFontFamilies]);
  const activeFontWeight = String(activeTextElement?.fontWeight || "400");
  const activeFontWeightNumber = Number.parseInt(activeFontWeight.replace(/[^\d]/g, ""), 10);
  const isBold = Number.isFinite(activeFontWeightNumber) ? activeFontWeightNumber >= 600 : /bold/i.test(activeFontWeight);
  const isItalic = activeTextElement?.fontStyle === "italic";
  const textDecorationValue = String(activeTextElement?.textDecoration || "") as TextDecorationValue;
  const hasDecoration = (token: "underline" | "line-through") =>
    textDecorationValue
      .split(/\s+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
      .includes(token);
  const isUnderline = hasDecoration("underline");
  const isStrikethrough = hasDecoration("line-through");
  const toggleTextDecoration = (token: "underline" | "line-through"): TextDecorationValue => {
    const tokens = new Set(
      textDecorationValue
        .split(/\s+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part === "underline" || part === "line-through")
    );
    if (tokens.has(token)) {
      tokens.delete(token);
    } else {
      tokens.add(token);
    }
    const hasUnderline = tokens.has("underline");
    const hasStrike = tokens.has("line-through");
    if (hasUnderline && hasStrike) return "underline line-through";
    if (hasUnderline) return "underline";
    if (hasStrike) return "line-through";
    return "";
  };
  const imageCanvasSupport = useMemo(() => {
    if (!activeImageElement) {
      return { supported: false, reason: "Select exactly one image layer." };
    }
    return canUseCanvasCropForImage(activeImageElement);
  }, [activeImageElement]);
  const imageTrimSupport = useMemo(() => {
    if (!activeImageElement) {
      return { supported: false, reason: "Select exactly one image layer." };
    }
    return canTrimTransparentPaddingForImage(activeImageElement);
  }, [activeImageElement]);
  const canUseImageCanvasTools =
    hasSingleImageSelection && Boolean(activePage) && imageCanvasSupport.supported;
  const imageCanvasToolTitle = imageCanvasSupport.supported
    ? "This action keeps image bounds inside canvas area"
    : imageCanvasSupport.reason || "Select exactly one image layer";
  const canTrimImagePadding =
    hasSingleImageSelection && imageTrimSupport.supported && !isTrimmingImagePadding;
  const imageTrimToolTitle = isTrimmingImagePadding
    ? "Removing transparent padding..."
    : imageTrimSupport.supported
      ? "Trim transparent padding around the selected image"
      : imageTrimSupport.reason || "Select exactly one image layer";

  const fitSelectedImageToPage = useCallback(() => {
    if (!activeImageElement || !activePage) return;

    const imageWidth = Math.max(1, activeImageElement.width);
    const imageHeight = Math.max(1, activeImageElement.height);
    const pageWidth = Math.max(1, activePage.width);
    const pageHeight = Math.max(1, activePage.height);

    const imageRatio = imageWidth / imageHeight;
    const pageRatio = pageWidth / pageHeight;

    let nextWidth = pageWidth;
    let nextHeight = pageHeight;

    if (imageRatio > pageRatio) {
      nextHeight = pageHeight;
      nextWidth = pageHeight * imageRatio;
    } else {
      nextWidth = pageWidth;
      nextHeight = pageWidth / imageRatio;
    }

    updateElement(activeImageElement.id, {
      x: (pageWidth - nextWidth) / 2,
      y: (pageHeight - nextHeight) / 2,
      width: nextWidth,
      height: nextHeight,
      rotation: 0,
      scaleX: activeImageElement.scaleX < 0 ? -1 : 1,
      scaleY: activeImageElement.scaleY < 0 ? -1 : 1,
    });
  }, [activeImageElement, activePage, updateElement]);

  const clipSelectedImageToCanvas = useCallback(async () => {
    if (!activeImageElement || !activePage) return;
    const prepared = await prepareImageElementForCanvasCrop(activeImageElement);
    if (!prepared.supported || !prepared.element) {
      if (prepared.reason) window.alert(prepared.reason);
      return;
    }
    const result = computeClipToCanvasPatch(prepared.element, activePage);
    if (!result.supported) {
      if (result.reason) window.alert(result.reason);
      return;
    }
    if (!result.patch) {
      if (result.reason) window.alert(result.reason);
      return;
    }
    updateElement(activeImageElement.id, result.patch);
  }, [activeImageElement, activePage, updateElement]);

  const fitSelectedImageToCanvas = useCallback(async () => {
    if (!activeImageElement || !activePage) return;
    const prepared = await prepareImageElementForCanvasCrop(activeImageElement);
    if (!prepared.supported || !prepared.element) {
      if (prepared.reason) window.alert(prepared.reason);
      return;
    }
    const result = computeFitToCanvasPatch(prepared.element, activePage);
    if (!result.supported) {
      if (result.reason) window.alert(result.reason);
      return;
    }
    if (!result.patch) {
      if (result.reason) window.alert(result.reason);
      return;
    }
    updateElement(activeImageElement.id, result.patch);
  }, [activeImageElement, activePage, updateElement]);

  const trimSelectedImagePadding = useCallback(async () => {
    if (!activeImageElement) return;
    const support = canTrimTransparentPaddingForImage(activeImageElement);
    if (!support.supported) {
      if (support.reason) window.alert(support.reason);
      return;
    }

    setIsTrimmingImagePadding(true);
    try {
      const result = await computeTrimTransparentPaddingPatch(activeImageElement);
      if (!result.supported) {
        if (result.reason) window.alert(result.reason);
        return;
      }
      if (!result.patch) {
        if (result.reason) window.alert(result.reason);
        return;
      }
      updateElement(activeImageElement.id, result.patch);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to trim image padding.");
    } finally {
      setIsTrimmingImagePadding(false);
    }
  }, [activeImageElement, updateElement]);

  useEffect(() => {
    if (!activeImageId || !activeRasterSource) return;
    const hasPalette = activeRasterPalette.length > 0;
    const sourceWasPersisted = activeImageRasterOriginalSrc === activeRasterSource;
    const paletteIsCurrent = activeRasterPaletteVersion >= RASTER_PALETTE_VERSION;
    if (hasPalette && sourceWasPersisted && paletteIsCurrent) return;

    let cancelled = false;

    void extractImagePaletteFromSource(activeRasterSource, 6)
      .then((colors) => {
        if (cancelled) return;
        const patch: {
          rasterOriginalSrc?: string;
          rasterPalette?: string[];
          rasterPaletteVersion?: number;
        } = {
          rasterPaletteVersion: RASTER_PALETTE_VERSION,
          rasterPalette: Array.isArray(colors) ? colors : [],
        };
        if (!sourceWasPersisted) {
          patch.rasterOriginalSrc = activeRasterSource;
        }
        updateElement(activeImageId, patch, { recordHistory: false });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    activeImageId,
    activeImageRasterOriginalSrc,
    activeRasterPalette.length,
    activeRasterPaletteVersion,
    activeRasterSource,
    updateElement,
  ]);

  const fitSelectedVideoToPage = useCallback(() => {
    if (!activeVideoElement || !activePage) return;

    const videoWidth = Math.max(1, activeVideoElement.width);
    const videoHeight = Math.max(1, activeVideoElement.height);
    const pageWidth = Math.max(1, activePage.width);
    const pageHeight = Math.max(1, activePage.height);

    const videoRatio = videoWidth / videoHeight;
    const pageRatio = pageWidth / pageHeight;

    let nextWidth = pageWidth;
    let nextHeight = pageHeight;

    if (videoRatio > pageRatio) {
      nextHeight = pageHeight;
      nextWidth = pageHeight * videoRatio;
    } else {
      nextWidth = pageWidth;
      nextHeight = pageWidth / videoRatio;
    }

    updateElement(activeVideoElement.id, {
      x: (pageWidth - nextWidth) / 2,
      y: (pageHeight - nextHeight) / 2,
      width: nextWidth,
      height: nextHeight,
      rotation: 0,
      scaleX: activeVideoElement.scaleX < 0 ? -1 : 1,
      scaleY: activeVideoElement.scaleY < 0 ? -1 : 1,
    });
  }, [activePage, activeVideoElement, updateElement]);

  useEffect(() => {
    if (!hasSingleVideoSelection) {
      setIsVideoTrimOpen(false);
      setVideoTrimDragEdge(null);
      setVideoTrimFrameStrip([]);
    }
  }, [hasSingleVideoSelection]);

  useEffect(() => {
    if (!activeVideoElement || videoTrimDragEdge) return;
    const rawEnd = Number(activeVideoElement.videoEnd);
    const normalized = normalizeTrimRange(
      Math.max(0, activeVideoElement.videoStart || 0),
      Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : resolvedVideoDuration,
      resolvedVideoDuration
    );
    setVideoTrimDraft(normalized);
    setVideoTrimPlayhead((prev) => clampNumber(prev || normalized.start, normalized.start, normalized.end));
  }, [
    activeVideoElement,
    resolvedVideoDuration,
    videoTrimDragEdge,
  ]);

  useEffect(() => {
    videoTrimDraftRef.current = videoTrimDraft;
  }, [videoTrimDraft]);

  useEffect(() => {
    if (!isVideoTrimOpen) return;
    const node = videoTrimViewportRef.current;
    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      setVideoTrimViewportWidth(rect.width || node.clientWidth || 0);
    };

    measure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    resizeObserver?.observe(node);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isVideoTrimOpen]);

  const updateTrimByPointer = useCallback(
    (edge: "start" | "end", clientX: number, options?: { commit?: boolean }) => {
      if (!trimTrackRef.current) return;
      const rect = trimTrackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const contentWidth = Math.max(Math.ceil(videoTrimViewportWidth * 1.65), Math.max(720, Math.ceil(resolvedVideoDuration * 84)));
      const centerInset = rect.width / 2;
      const playheadRatio = resolvedVideoDuration > 0 ? clampNumber(videoTrimPlayhead / resolvedVideoDuration, 0, 1) : 0;
      const scrollOffset = clampNumber(
        rect.width / 2 - playheadRatio * contentWidth,
        Math.min(centerInset, centerInset - contentWidth),
        centerInset
      );
      const absolutePx = clampNumber(clientX - rect.left - scrollOffset, 0, contentWidth);
      const targetTime = (absolutePx / contentWidth) * resolvedVideoDuration;
      let nextStart = videoTrimDraftRef.current.start;
      let nextEnd = videoTrimDraftRef.current.end;
      const minWindow = Math.max(0.08, resolvedVideoDuration / 600);

      if (edge === "start") {
        nextStart = clampNumber(targetTime, 0, Math.max(0, nextEnd - minWindow));
      } else {
        nextEnd = clampNumber(targetTime, Math.min(resolvedVideoDuration, nextStart + minWindow), resolvedVideoDuration);
      }

      const normalized = normalizeTrimRange(nextStart, nextEnd, resolvedVideoDuration);
      setVideoTrimDraft(normalized);
      setVideoTrimPlayhead((prev) => clampNumber(prev || normalized.start, normalized.start, normalized.end));

      if (activeVideoElement && options?.commit) {
        updateElement(
          activeVideoElement.id,
          {
            videoStart: normalized.start,
            videoEnd: normalized.end,
          },
          { recordHistory: true }
        );
      }
    },
    [activeVideoElement, resolvedVideoDuration, updateElement, videoTrimPlayhead, videoTrimViewportWidth]
  );

  useEffect(() => {
    if (!videoTrimDragEdge) return;

    const onPointerMove = (event: PointerEvent) => {
      updateTrimByPointer(videoTrimDragEdge, event.clientX);
    };

    const onPointerUp = (event: PointerEvent) => {
      updateTrimByPointer(videoTrimDragEdge, event.clientX, { commit: true });
      setVideoTrimDragEdge(null);
    };
    const onPointerCancel = () => {
      if (activeVideoElement) {
        const { start, end } = normalizeTrimRange(
          videoTrimDraftRef.current.start,
          videoTrimDraftRef.current.end,
          resolvedVideoDuration
        );
        updateElement(activeVideoElement.id, { videoStart: start, videoEnd: end }, { recordHistory: true });
      }
      setVideoTrimDragEdge(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [activeVideoElement, resolvedVideoDuration, updateElement, updateTrimByPointer, videoTrimDragEdge]);

  useEffect(() => {
    if (!isVideoTrimOpen || !videoTrimFrameCacheKey) {
      setVideoTrimFrameStrip([]);
      return;
    }

    const cached = videoTrimFrameCacheRef.current.get(videoTrimFrameCacheKey);
    if (cached && cached.length > 0) {
      setVideoTrimFrameStrip(cached);
      return;
    }

    let disposed = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    setVideoTrimFrameStrip([]);

    const toStrip = (samples: string[]) =>
      Array.from({ length: TRIM_TRACK_SLOT_COUNT }, (_, slotIndex) => {
        if (samples.length === 0) return "";
        const ratio = TRIM_TRACK_SLOT_COUNT > 1 ? slotIndex / (TRIM_TRACK_SLOT_COUNT - 1) : 0;
        const sampleIndex = Math.round(ratio * (samples.length - 1));
        return samples[sampleIndex] || "";
      });

    const captureProgressiveFrames = async () => {
      if (disposed) return;

      const video = document.createElement("video");
      video.src = videoTrimFrameCacheKey;
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.setAttribute("playsinline", "true");

      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 36;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cleanup = () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      };

      const waitForReady = () =>
        new Promise<void>((resolve) => {
          if (video.readyState >= 1) {
            resolve();
            return;
          }
          const done = () => {
            video.removeEventListener("loadedmetadata", done);
            video.removeEventListener("loadeddata", done);
            video.removeEventListener("canplay", done);
            video.removeEventListener("error", done);
            resolve();
          };
          video.addEventListener("loadedmetadata", done);
          video.addEventListener("loadeddata", done);
          video.addEventListener("canplay", done);
          video.addEventListener("error", done);
          video.load();
        });

      const seekTo = (time: number) =>
        new Promise<void>((resolve) => {
          const done = () => {
            video.removeEventListener("seeked", done);
            video.removeEventListener("error", done);
            resolve();
          };
          video.addEventListener("seeked", done);
          video.addEventListener("error", done);
          try {
            const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : resolvedVideoDuration;
            const safe = Math.max(0, Math.min(time, Math.max(0, duration - 0.02)));
            video.currentTime = safe;
          } catch {
            resolve();
          }
        });

      const drawFrame = () => {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/jpeg", 0.42);
        } catch {
          return "";
        }
      };

      await waitForReady();
      if (disposed) {
        cleanup();
        return;
      }

      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : resolvedVideoDuration;

      const quickTime = Math.max(0, Math.min(videoTrimDraftRef.current.start, Math.max(0, duration - 0.02)));
      await seekTo(quickTime);
      if (disposed) {
        cleanup();
        return;
      }
      const firstFrame = drawFrame();
      if (firstFrame && !disposed) {
        setVideoTrimFrameStrip(toStrip([firstFrame]));
      }

      const sampledFrames: string[] = [];
      for (let index = 0; index < TRIM_PROGRESSIVE_SAMPLE_COUNT; index += 1) {
        if (disposed) break;
        const ratio = TRIM_PROGRESSIVE_SAMPLE_COUNT > 1 ? index / (TRIM_PROGRESSIVE_SAMPLE_COUNT - 1) : 0;
        await seekTo(ratio * duration);
        if (disposed) break;
        const frame = drawFrame();
        if (frame) sampledFrames.push(frame);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }

      if (!disposed) {
        const finalFrames = sampledFrames.length > 0 ? toStrip(sampledFrames) : toStrip(firstFrame ? [firstFrame] : []);
        setVideoTrimFrameStrip(finalFrames);
        if (finalFrames.some(Boolean)) {
          const cache = videoTrimFrameCacheRef.current;
          cache.set(videoTrimFrameCacheKey, finalFrames);
          if (cache.size > 36) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey) cache.delete(oldestKey);
          }
        }
      }

      cleanup();
    };

    const win = window as Window & {
      requestIdleCallback?: (
        callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
        options?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    timeoutId = window.setTimeout(() => {
      if (win.requestIdleCallback) {
        idleId = win.requestIdleCallback(() => {
          void captureProgressiveFrames();
        }, { timeout: 450 });
      } else {
        void captureProgressiveFrames();
      }
    }, 70);

    return () => {
      disposed = true;
      if (idleId !== null && win.cancelIdleCallback) {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isVideoTrimOpen, resolvedVideoDuration, videoTrimFrameCacheKey]);

  useEffect(() => {
    if (!previewToast) return;
    const timeoutId = window.setTimeout(() => {
      setPreviewToast((current) => (current?.message === previewToast.message ? null : current));
    }, previewToast.tone === "error" ? 5200 : 3200);
    return () => window.clearTimeout(timeoutId);
  }, [previewToast]);

  useEffect(() => {
    const handlePageUnload = () => {
      if (unloadAbortHandledRef.current) return;
      unloadAbortHandledRef.current = true;
      previewGenerationIdRef.current += 1;
      saveAbortControllerRef.current?.abort();
      previewAbortControllerRef.current?.abort();
      setPreviewGenerationActive(false);
      const activePreview = activePreviewCancelRef.current;
      if (!activePreview?.templateId) return;
      void fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activePreview.templateId,
          action: "updatePreview",
          preview: activePreview.preview,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    window.addEventListener("beforeunload", handlePageUnload);
    window.addEventListener("pagehide", handlePageUnload);
    return () => {
      window.removeEventListener("beforeunload", handlePageUnload);
      window.removeEventListener("pagehide", handlePageUnload);
    };
  }, [setPreviewGenerationActive]);

  const patchTemplatePreview = useCallback(
    async ({
      id,
      preview,
    }: {
      id: string;
      preview: {
        status?: string | null;
        url?: string | null;
        posterUrl?: string | null;
        durationMs?: number | null;
        version?: number | null;
        error?: string | null;
      } | null;
    }, options?: { signal?: AbortSignal; keepalive?: boolean }) => {
      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: "updatePreview",
          preview,
        }),
        keepalive: options?.keepalive,
        signal: options?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update template preview.");
      }
      return payload?.template || null;
    },
    []
  );

  const generateTemplatePreview = useCallback(
    async ({
      templateId,
      templateVersion,
      fallbackPosterDataUrl,
    }: {
      templateId: string;
      templateVersion: number;
      fallbackPosterDataUrl: string;
    }) => {
      const stageRecorder = stageApi?.recordTimelinePreviewVideo;
      if (!templateId || !stageRecorder) return;

      previewAbortControllerRef.current?.abort();
      const jobId = previewGenerationIdRef.current + 1;
      previewGenerationIdRef.current = jobId;
      const nextGeneratedAt = new Date().toISOString();
      const wasPlaying = timelineIsPlaying;
      const controller = new AbortController();
      const canceledPreview = buildCanceledPreviewPayload(
        fallbackPosterDataUrl || designTimeline.preview.posterUrl || "",
        templateVersion,
        previewTimelineDurationMs
      );
      previewAbortControllerRef.current = controller;
      activePreviewCancelRef.current = {
        templateId,
        preview: canceledPreview,
        controller,
      };
      const announce = (
        tone: "info" | "success" | "error",
        message: string,
        details?: Record<string, unknown>
      ) => {
        logPreviewProgress(message, details);
        if (previewGenerationIdRef.current !== jobId) return;
        setPreviewToast({ tone, message });
      };
      const appendPreviewVersion = (url: string, token: string) => {
        const safeUrl = String(url || "").trim();
        const safeToken = String(token || "").trim();
        if (!safeUrl || !safeToken) return safeUrl;
        try {
          const parsed = new URL(
            safeUrl,
            typeof window !== "undefined" ? window.location.origin : "http://localhost"
          );
          parsed.searchParams.set("v", safeToken);
          if (/^https?:\/\//i.test(safeUrl)) {
            return parsed.toString();
          }
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch {
          const separator = safeUrl.includes("?") ? "&" : "?";
          return `${safeUrl}${separator}v=${encodeURIComponent(safeToken)}`;
        }
      };
      const setLocalPreviewState = (patch: {
        status?: string | null;
        url?: string | null;
        posterUrl?: string | null;
        generatedAt?: string | null;
        error?: string | null;
      }) => {
        if (previewGenerationIdRef.current !== jobId) return;
        updateTimeline(
          {
            preview: {
              ...designTimeline.preview,
              ...patch,
            },
          },
          { recordHistory: false }
        );
      };

      try {
        setPreviewGenerationActive(true);
        announce("info", "Generating template preview...");
        setLocalPreviewState({
          status: "processing",
          url: null,
          posterUrl: fallbackPosterDataUrl || designTimeline.preview.posterUrl || null,
          generatedAt: nextGeneratedAt,
          error: null,
        });

        await patchTemplatePreview({
          id: templateId,
          preview: {
            status: "processing",
            posterUrl: null,
            durationMs: previewTimelineDurationMs,
            version: templateVersion,
            error: null,
          },
        }, { signal: controller.signal });
        announce("info", "Recording preview video...");

        setTimelinePlaying(false);
        const recorded = await stageRecorder({
          fps: PREVIEW_RENDER_FPS,
          maxDimension: TEMPLATE_PREVIEW_VIDEO_MAX_DIMENSION,
          durationMs: previewTimelineDurationMs,
          signal: controller.signal,
        });
        if (!recorded?.blob || recorded.blob.size <= 0) {
          throw new Error("Preview renderer did not return a video.");
        }
        announce("info", "Uploading preview assets...", {
          mimeType: recorded.mimeType,
          durationMs: recorded.durationMs,
          width: recorded.width,
          height: recorded.height,
        });

        const videoExtension = extensionFromMimeType(recorded.mimeType);
        const videoFile = new File([recorded.blob], `template-preview-${templateId}.${videoExtension}`, {
          type: recorded.mimeType,
        });
        const uploadedVideo = await uploadEditorMediaFile(videoFile, "video", {
          signal: controller.signal,
          variant: "template-preview-video",
          templateId,
        });

        let posterUrl = fallbackPosterDataUrl || designTimeline.preview.posterUrl || "";
        if (recorded.posterDataUrl) {
          const posterFile = dataUrlToFile(recorded.posterDataUrl, `template-preview-${templateId}.png`);
          const uploadedPoster = await uploadEditorMediaFile(posterFile, "image", {
            signal: controller.signal,
            variant: "template-preview-poster",
            templateId,
          });
          posterUrl = uploadedPoster.url;
        }

        const template = await patchTemplatePreview({
          id: templateId,
          preview: {
            status: "ready",
            url: uploadedVideo.url,
            posterUrl: posterUrl || null,
            durationMs: recorded.durationMs,
            version: templateVersion,
            error: null,
          },
        }, { signal: controller.signal });
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
        if (activePreviewCancelRef.current?.controller === controller) {
          activePreviewCancelRef.current = null;
        }
        const previewVersionToken =
          String(template?.preview?.updatedAt || "").trim() ||
          String(template?.preview?.version || "").trim() ||
          String(Date.parse(nextGeneratedAt) || Date.now());
        const resolvedPreviewUrl = String(template?.preview?.url || "").trim()
          || appendPreviewVersion(uploadedVideo.url, previewVersionToken);
        const resolvedPosterUrl = String(template?.preview?.posterUrl || "").trim()
          || appendPreviewVersion(posterUrl || "", previewVersionToken);

        setLocalPreviewState({
          status: "ready",
          url: resolvedPreviewUrl || null,
          posterUrl: resolvedPosterUrl || null,
          generatedAt: nextGeneratedAt,
          error: null,
        });
        announce("success", "Template preview is ready.", {
          url: resolvedPreviewUrl || null,
        });
      } catch (error) {
        if (isAbortError(error)) {
          logPreviewProgress("Template preview generation canceled.", { templateId, templateVersion });
          if (previewGenerationIdRef.current !== jobId) {
            return;
          }
          if (!unloadAbortHandledRef.current) {
            await patchTemplatePreview({
              id: templateId,
              preview: canceledPreview,
            }).catch(() => undefined);
            setLocalPreviewState({
              status: "not_requested",
              url: null,
              posterUrl: canceledPreview.posterUrl,
              generatedAt: null,
              error: null,
            });
          }
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to generate template preview.";
        await patchTemplatePreview({
          id: templateId,
          preview: {
            status: "failed",
            posterUrl: null,
            durationMs: previewTimelineDurationMs,
            version: templateVersion,
            error: message,
          },
        }, { signal: controller.signal }).catch(() => undefined);

        setLocalPreviewState({
          status: "failed",
          generatedAt: nextGeneratedAt,
          error: message,
        });
        announce("error", `Preview generation failed: ${message}`);
      } finally {
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
        if (activePreviewCancelRef.current?.controller === controller) {
          activePreviewCancelRef.current = null;
        }
        setPreviewGenerationActive(false);
        if (wasPlaying) {
          setTimelinePlaying(true);
        }
      }
    },
    [
      designTimeline.preview,
      patchTemplatePreview,
      previewTimelineDurationMs,
      setPreviewGenerationActive,
      stageApi,
      setTimelinePlaying,
      timelineIsPlaying,
      updateTimeline,
    ]
  );

  const saveTemplate = useCallback(async () => {
    if (isSavingTemplate) return null;

    let nextName = activeTemplateName.trim();
    if (!nextName) {
      const fallbackName = `Untitled ${new Date().toISOString().slice(0, 10)}`;
      const askedName = window.prompt("Template name", fallbackName);
      if (askedName === null) return null;
      nextName = askedName.trim();
      if (!nextName) {
        window.alert("Template name is required.");
        return null;
      }
    }

    setIsSavingTemplate(true);
    unloadAbortHandledRef.current = false;
    const saveController = new AbortController();
    saveAbortControllerRef.current = saveController;
    try {
      const parsedDesign = JSON.parse(exportDesign()) as EditorDesign;
      const thumbnailDataUrl = stageApi?.captureThumbnailDataUrl?.() || "";
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeTemplateId ? { id: activeTemplateId } : {}),
          name: nextName,
          data: parsedDesign,
          canvasSize: {
            width: Math.max(1, Math.round(activePage?.width || 1080)),
            height: Math.max(1, Math.round(activePage?.height || 1080)),
          },
          category: activeTemplateCategory || "general",
          subCategory: activeTemplateSubCategory || "general",
          tags: activeTemplateTags,
          thumbnailDataUrl,
        }),
        signal: saveController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save template.");
      }

      const template = payload?.template || null;
      if (template?.id) {
        setTemplateMeta({
          id: String(template.id),
          name: String(template.name || nextName),
          status: template.status === "published" ? "published" : "draft",
          category: String(template.category || activeTemplateCategory || "general"),
          subCategory: String(template.subCategory || activeTemplateSubCategory || "general"),
          tags: Array.isArray(template.tags) ? template.tags : activeTemplateTags,
        });
        updateTemplateIdInUrl(String(template.id));
      } else {
        setTemplateMeta({ name: nextName });
      }

      const isMotionTemplate = hasAnimatedTemplateContent(parsedDesign.pages, parsedDesign.timeline);
      if (template?.id) {
        const posterUrl =
          String(template?.preview?.posterUrl || "").trim() ||
          String(template?.thumbnailDataUrl || "").trim() ||
          String(thumbnailDataUrl || "").trim() ||
          null;
        if (isMotionTemplate && stageApi?.recordTimelinePreviewVideo) {
          void generateTemplatePreview({
            templateId: String(template.id),
            templateVersion: Number(template.version || 0),
            fallbackPosterDataUrl: String(posterUrl || ""),
          });
        } else {
          const templatePreview = template?.preview || null;
          updateTimeline(
            {
              preview: {
                status: String(templatePreview?.status || "not_requested"),
                url: String(templatePreview?.url || "").trim() || null,
                posterUrl:
                  String(templatePreview?.posterUrl || "").trim() ||
                  String(posterUrl || "").trim() ||
                  null,
                generatedAt:
                  Number.isFinite(Number(templatePreview?.updatedAt))
                    ? new Date(Number(templatePreview.updatedAt)).toISOString()
                    : null,
                error: String(templatePreview?.error || "").trim() || null,
              },
            },
            { recordHistory: false }
          );
        }
      }

      return template;
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return null;
      }
      const message = error instanceof Error ? error.message : "Failed to save template.";
      window.alert(message);
      return null;
    } finally {
      if (saveAbortControllerRef.current === saveController) {
        saveAbortControllerRef.current = null;
      }
      setIsSavingTemplate(false);
    }
  }, [
    activePage?.height,
    activePage?.width,
    activeTemplateCategory,
    activeTemplateId,
    activeTemplateName,
    activeTemplateSubCategory,
    activeTemplateTags,
    exportDesign,
    generateTemplatePreview,
    isSavingTemplate,
    stageApi,
    setTemplateMeta,
    updateTimeline,
    updateTemplateIdInUrl,
  ]);

  const publishTemplate = useCallback(async () => {
    if (isPublishingTemplate || activeTemplateStatus === "published") return;

    setIsPublishingTemplate(true);
    try {
      const saved = await saveTemplate();
      const templateId = String(saved?.id || "");
      if (!templateId) return;

      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: templateId,
          action: "publish",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to publish template.");
      }

      const template = payload?.template;
      if (template?.id) {
        setTemplateMeta({
          id: String(template.id),
          name: String(template.name || activeTemplateName || "Untitled"),
          status: template.status === "published" ? "published" : "draft",
          category: String(template.category || activeTemplateCategory || "general"),
          subCategory: String(template.subCategory || activeTemplateSubCategory || "general"),
          tags: Array.isArray(template.tags) ? template.tags : activeTemplateTags,
        });
      } else {
        setTemplateMeta({ status: "published" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to publish template.";
      window.alert(message);
    } finally {
      setIsPublishingTemplate(false);
    }
  }, [
    activeTemplateCategory,
    activeTemplateName,
    activeTemplateStatus,
    activeTemplateSubCategory,
    activeTemplateTags,
    isPublishingTemplate,
    saveTemplate,
    setTemplateMeta,
  ]);

  const unpublishTemplate = useCallback(async () => {
    if (isUnpublishingTemplate || activeTemplateStatus !== "published") return;
    if (!activeTemplateId) {
      window.alert("Save the template first before unpublishing.");
      return;
    }
    const confirmed = window.confirm(
      `Unpublish template "${activeTemplateName.trim() || "Untitled"}"?`
    );
    if (!confirmed) return;

    setIsUnpublishingTemplate(true);
    try {
      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeTemplateId,
          action: "unpublish",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to unpublish template.");
      }

      const template = payload?.template;
      if (template?.id) {
        setTemplateMeta({
          id: String(template.id),
          name: String(template.name || activeTemplateName || "Untitled"),
          status: template.status === "published" ? "published" : "draft",
          category: String(template.category || activeTemplateCategory || "general"),
          subCategory: String(template.subCategory || activeTemplateSubCategory || "general"),
          tags: Array.isArray(template.tags) ? template.tags : activeTemplateTags,
        });
      } else {
        setTemplateMeta({ status: "draft" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to unpublish template.";
      window.alert(message);
    } finally {
      setIsUnpublishingTemplate(false);
    }
  }, [
    activeTemplateCategory,
    activeTemplateId,
    activeTemplateName,
    activeTemplateStatus,
    activeTemplateSubCategory,
    activeTemplateTags,
    isUnpublishingTemplate,
    setTemplateMeta,
  ]);

  const publishSelectedElements = useCallback(async () => {
    if (isPublishingElements) return;
    if (!activePage || publishCandidateIds.length === 0) return;

    setIsPublishingElements(true);
    try {
      const parsedDesign = JSON.parse(exportDesign()) as EditorDesign;
      const response = await fetch("/api/editor/elements/publish-from-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: activeTemplateId || "",
          pageId: activePage.id,
          elementIds: publishCandidateIds,
          design: parsedDesign,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to publish selected elements.");
      }

      const publishedCount = Array.isArray(payload?.published) ? payload.published.length : 0;
      const skippedCount = Array.isArray(payload?.skipped) ? payload.skipped.length : 0;
      bumpImportedElementsRefreshKey();
      clearPublishCandidates();

      if (publishedCount === 0 && skippedCount > 0) {
        window.alert("No selected elements were publishable. Background and full-page images are skipped.");
        return;
      }

      window.alert(
        skippedCount > 0
          ? `Published ${publishedCount} element${publishedCount === 1 ? "" : "s"}. Skipped ${skippedCount} background-like item${skippedCount === 1 ? "" : "s"}.`
          : `Published ${publishedCount} element${publishedCount === 1 ? "" : "s"} to the Elements library.`
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to publish selected elements.";
      window.alert(message);
    } finally {
      setIsPublishingElements(false);
    }
  }, [
    activePage,
    activeTemplateId,
    bumpImportedElementsRefreshKey,
    clearPublishCandidates,
    exportDesign,
    isPublishingElements,
    publishCandidateIds,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (isDeletingTemplate) return;
    if (!activeTemplateId) {
      window.alert("Save the template first before deleting.");
      return;
    }

    const confirmed = window.confirm(
      `Delete template "${activeTemplateName.trim() || "Untitled"}"?`
    );
    if (!confirmed) return;

    setIsDeletingTemplate(true);
    try {
      const response = await fetch(`/api/templates/${encodeURIComponent(activeTemplateId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete template.");
      }

      clearTemplateMeta();
      window.location.assign(buildEditorUrl(""));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete template.";
      window.alert(message);
    } finally {
      setIsDeletingTemplate(false);
    }
  }, [
    activeTemplateId,
    activeTemplateName,
    buildEditorUrl,
    clearTemplateMeta,
    isDeletingTemplate,
  ]);

  const topActionClass =
    "inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-[#202a38] hover:bg-[#eef2f8] disabled:cursor-not-allowed disabled:opacity-40";
  const iconBtnClass =
    "inline-flex h-8 w-8 items-center justify-center rounded text-[#445066] hover:bg-[#eef2f8] disabled:opacity-40";
  const textControlBtnClass =
    "inline-flex h-8 w-8 items-center justify-center rounded border border-[#d7dbe1] bg-white text-[#445066] hover:bg-[#eef2f8]";
  const textControlBtnActiveClass =
    "inline-flex h-8 w-8 items-center justify-center rounded border border-[#2f6fca] bg-[#e8f1ff] text-[#2458a3]";
  const textCurveEnabled = Boolean(activeTextElement?.textCurveEnabled);
  const textCurveAmount = Math.max(-100, Math.min(100, Number(activeTextElement?.textCurveAmount || 0)));
  const videoTrimPlayheadPercent = resolvedVideoDuration > 0 ? clampNumber(videoTrimPlayhead / resolvedVideoDuration, 0, 1) : 0;
  const videoTrimWindowLabel = `${formatTrimTime(videoTrimDraft.start)}s - ${formatTrimTime(videoTrimDraft.end)}s`;
  const videoTrimThumbs = useMemo(
    () => (videoTrimFrameStrip.length > 0 ? videoTrimFrameStrip : new Array(TRIM_TRACK_SLOT_COUNT).fill("")),
    [videoTrimFrameStrip]
  );
  const videoTrimContentWidthPx = useMemo(() => {
    const durationWidth = Math.max(720, Math.ceil(resolvedVideoDuration * 84));
    if (videoTrimViewportWidth <= 0) return durationWidth;
    return Math.max(durationWidth, Math.ceil(videoTrimViewportWidth * 1.65));
  }, [resolvedVideoDuration, videoTrimViewportWidth]);
  const videoTrimScrollOffsetPx = useMemo(() => {
    if (videoTrimViewportWidth <= 0) return 0;
    const centerInset = videoTrimViewportWidth / 2;
    const minOffset = Math.min(centerInset, centerInset - videoTrimContentWidthPx);
    const maxOffset = centerInset;
    const centeredOffset = videoTrimViewportWidth / 2 - videoTrimPlayheadPercent * videoTrimContentWidthPx;
    return clampNumber(centeredOffset, minOffset, maxOffset);
  }, [videoTrimContentWidthPx, videoTrimPlayheadPercent, videoTrimViewportWidth]);
  const videoTrimPlayheadViewportXPx = useMemo(() => {
    if (videoTrimViewportWidth <= 0) return 0;
    return clampNumber(
      videoTrimPlayheadPercent * videoTrimContentWidthPx + videoTrimScrollOffsetPx,
      0,
      videoTrimViewportWidth
    );
  }, [videoTrimContentWidthPx, videoTrimPlayheadPercent, videoTrimScrollOffsetPx, videoTrimViewportWidth]);
  const videoTrimPlayheadLabelXPx = useMemo(() => {
    if (videoTrimViewportWidth <= 0) return 0;
    return clampNumber(videoTrimPlayheadViewportXPx, 64, Math.max(64, videoTrimViewportWidth - 132));
  }, [videoTrimPlayheadViewportXPx, videoTrimViewportWidth]);
  const videoTrimContentStyle = useMemo(
    () => ({
      width: `${videoTrimContentWidthPx}px`,
      transform: `translateX(${videoTrimScrollOffsetPx}px)`,
    }),
    [videoTrimContentWidthPx, videoTrimScrollOffsetPx]
  );
  const videoTrimSecondMarkers = useMemo(() => {
    const seconds = Math.max(1, Math.ceil(resolvedVideoDuration));
    return Array.from({ length: seconds + 1 }, (_, index) => ({
      second: index,
      ratio: seconds === 0 ? 0 : Math.min(1, index / Math.max(resolvedVideoDuration, 1)),
    }));
  }, [resolvedVideoDuration]);
  const visibleVideoTrimSecondLabels = useMemo(() => {
    const totalSeconds = Math.max(1, Math.ceil(resolvedVideoDuration));
    return videoTrimSecondMarkers.filter(
      (marker) =>
        marker.second > 0 &&
        marker.second < totalSeconds &&
        marker.ratio > 0.02 &&
        marker.ratio < 0.96
    );
  }, [resolvedVideoDuration, videoTrimSecondMarkers]);
  const videoTrimFilmstripFrameCount = useMemo(
    () => Math.max(12, Math.min(48, Math.ceil(videoTrimContentWidthPx / 40))),
    [videoTrimContentWidthPx]
  );
  const videoTrimSelectedBarStyle = useMemo(() => {
    if (resolvedVideoDuration <= 0 || videoTrimContentWidthPx <= 0) return null;
    const startRatio = videoTrimDraft.start / resolvedVideoDuration;
    const widthRatio = (videoTrimDraft.end - videoTrimDraft.start) / resolvedVideoDuration;
    const trimContentWidthPx = Math.max(widthRatio * videoTrimContentWidthPx, 92);
    return {
      left: `${startRatio * videoTrimContentWidthPx - VIDEO_TRIM_HANDLE_WIDTH_PX}px`,
      width: `${trimContentWidthPx + VIDEO_TRIM_HANDLE_WIDTH_PX * 2}px`,
      minWidth: `${92 + VIDEO_TRIM_HANDLE_WIDTH_PX * 2}px`,
    };
  }, [resolvedVideoDuration, videoTrimContentWidthPx, videoTrimDraft.end, videoTrimDraft.start]);
  const {
    isScrubbing: videoTrimIsScrubbing,
    activePointerId: activeVideoTrimPointerId,
    startScrubbing: startVideoTrimScrubbing,
    updateScrubbing: updateVideoTrimScrubbing,
    endScrubbing: endVideoTrimScrubbing,
  } = useTimelineScrubber({
    totalDurationMs: resolvedVideoDuration,
    contentWidthPx: videoTrimContentWidthPx,
    deadZonePx: 2,
    snapMs: null,
    invertDirection: true,
    clampMin: videoTrimDraft.start,
    clampMax: videoTrimDraft.end,
    getBounds: () => {
      const node = trimTrackRef.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        width: rect.width || node.clientWidth || 0,
      };
    },
    getCurrentTime: () => videoTrimPlayhead,
    onCommit: (time) => {
      setVideoTrimPlayhead(Math.round(time * 1000) / 1000);
    },
  });

  useEffect(() => {
    if (isVideoTrimOpen) return;
    endVideoTrimScrubbing();
  }, [endVideoTrimScrubbing, isVideoTrimOpen]);

  useEffect(() => {
    if (!videoTrimIsScrubbing) return;

    const onPointerMove = (event: PointerEvent) => {
      if (activeVideoTrimPointerId !== null && event.pointerId !== activeVideoTrimPointerId) return;
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
      updateVideoTrimScrubbing(event.clientX);
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (activeVideoTrimPointerId !== null && event.pointerId !== activeVideoTrimPointerId) return;
      endVideoTrimScrubbing();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [activeVideoTrimPointerId, endVideoTrimScrubbing, updateVideoTrimScrubbing, videoTrimIsScrubbing]);

  const onTrimTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement)?.closest("[data-video-trim-handle]")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!trimTrackRef.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startVideoTrimScrubbing(event.clientX, event.pointerId);
    },
    [startVideoTrimScrubbing]
  );

  const mergeSelectedLayers = useCallback(async () => {
    if (!stageApi?.mergeSelectedLayers) return;
    const result = await stageApi.mergeSelectedLayers();
    if (!result.merged && result.message) {
      window.alert(result.message);
    }
  }, [stageApi]);

  return (
    <div className="z-30 border-b border-[#d7dbe1] bg-[#f6f7f9] px-3 py-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap">
          <button type="button" className={iconBtnClass} onClick={onToggleLeft}>
            <Menu size={16} />
          </button>

          <button type="button" className={iconBtnClass} onClick={undo} disabled={!canUndo}>
            <Undo2 size={16} />
          </button>
          <button type="button" className={iconBtnClass} onClick={redo} disabled={!canRedo}>
            <Redo2 size={16} />
          </button>

          {hasOnlyTextSelection && activeTextElement ? (
            <>
              <input
                type="color"
                aria-label="Text color"
                className="h-8 w-8 cursor-pointer rounded border border-[#d7dbe1] bg-white p-0"
                value={activeTextElement.color || activeTextElement.fill || "#111827"}
                onChange={(event) =>
                  updateSelectedElements({
                    color: event.target.value,
                    fill: event.target.value,
                  })
                }
              />
              <div className="relative">
                <select
                  aria-label="Font family"
                  className="h-8 min-w-[150px] rounded border border-[#d7dbe1] bg-white pl-2 pr-7 text-sm text-[#202a38]"
                  value={activeTextElement.fontFamily}
                  onChange={(event) => updateSelectedElements({ fontFamily: event.target.value })}
                >
                  {fontOptions.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#667085]" />
              </div>
              <input
                type="number"
                min={8}
                max={400}
                aria-label="Font size"
                className="h-8 w-16 rounded border border-[#d7dbe1] bg-white px-2 text-sm text-[#202a38]"
                value={Math.round(activeTextElement.fontSize)}
                onChange={(event) =>
                  updateSelectedElements({
                    fontSize: Math.max(8, Math.min(400, Number(event.target.value) || activeTextElement.fontSize)),
                  })
                }
              />
              <button
                type="button"
                aria-label="Bold"
                className={isBold ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ fontWeight: isBold ? "400" : "700" })}
              >
                <Bold size={14} />
              </button>
              <button
                type="button"
                aria-label="Italic"
                className={isItalic ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ fontStyle: isItalic ? "normal" : "italic" })}
              >
                <Italic size={14} />
              </button>
              <button
                type="button"
                aria-label="Underline"
                className={isUnderline ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ textDecoration: toggleTextDecoration("underline") })}
              >
                <Underline size={14} />
              </button>
              <button
                type="button"
                aria-label="Strikethrough"
                className={isStrikethrough ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ textDecoration: toggleTextDecoration("line-through") })}
              >
                <Strikethrough size={14} />
              </button>
              <button
                type="button"
                aria-label="Align left"
                className={activeTextElement.align === "left" ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ align: "left" })}
              >
                <AlignLeft size={14} />
              </button>
              <button
                type="button"
                aria-label="Align center"
                className={activeTextElement.align === "center" ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ align: "center" })}
              >
                <AlignCenter size={14} />
              </button>
              <button
                type="button"
                aria-label="Align right"
                className={activeTextElement.align === "right" ? textControlBtnActiveClass : textControlBtnClass}
                onClick={() => updateSelectedElements({ align: "right" })}
              >
                <AlignRight size={14} />
              </button>
              <input
                type="number"
                min={0.4}
                max={4}
                step={0.05}
                aria-label="Line height"
                className="h-8 w-20 rounded border border-[#d7dbe1] bg-white px-2 text-sm text-[#202a38]"
                value={Number(activeTextElement.lineHeight || 1).toFixed(2)}
                onChange={(event) =>
                  updateSelectedElements({
                    lineHeight: Math.max(0.4, Math.min(4, Number(event.target.value) || activeTextElement.lineHeight)),
                  })
                }
              />
              <input
                type="number"
                min={-10}
                max={200}
                step={0.1}
                aria-label="Letter spacing"
                className="h-8 w-20 rounded border border-[#d7dbe1] bg-white px-2 text-sm text-[#202a38]"
                value={Number(activeTextElement.letterSpacing || 0)}
                onChange={(event) =>
                  updateSelectedElements({
                    letterSpacing: Math.max(-10, Math.min(200, Number(event.target.value) || 0)),
                  })
                }
              />
              <button
                type="button"
                className={topActionClass}
                onClick={() => void mergeSelectedLayers()}
                disabled={!canMergeSelection}
                title={
                  canMergeSelection
                    ? "Merge selected layers into one image layer"
                    : "Select at least two layers"
                }
              >
                <Layers size={14} /> Merge
              </button>
            </>
          ) : hasSingleVideoSelection && activeVideoElement ? (
            <>
              <button
                type="button"
                className={`${topActionClass} border border-transparent ${isVideoTrimOpen ? "border-[#2f6fca] bg-[#e8f1ff] text-[#2458a3]" : ""}`}
                onClick={() => setIsVideoTrimOpen((prev) => !prev)}
              >
                <Scissors size={14} /> Trim
              </button>
              <button
                type="button"
                className={topActionClass}
                onClick={fitSelectedVideoToPage}
              >
                Fit to page
              </button>
              {isVideoTrimOpen ? (
                <span className="text-xs font-medium text-[#41536d]">{videoTrimWindowLabel}</span>
              ) : null}
            </>
          ) : hasSelection ? (
            <>
              <button
                type="button"
                className={topActionClass}
                onClick={() => void mergeSelectedLayers()}
                disabled={!canMergeSelection || hasVideoInSelection}
                title={
                  hasVideoInSelection
                    ? "Video layers are not supported in merge yet"
                    : canMergeSelection
                      ? "Merge selected layers into one image layer"
                      : "Select at least two layers"
                }
              >
                <Layers size={14} /> Merge
              </button>
              <button
                type="button"
                className={topActionClass}
                onClick={() => flipSelected("x")}
                title="Flip horizontally"
              >
                <FlipHorizontal size={14} /> Flip H
              </button>
              <button
                type="button"
                className={topActionClass}
                onClick={() => flipSelected("y")}
                title="Flip vertically"
              >
                <FlipVertical size={14} /> Flip V
              </button>
              <button
                type="button"
                className={topActionClass}
                onClick={fitSelectedImageToPage}
                disabled={!hasSingleImageSelection}
                title={hasSingleImageSelection ? "Fit selected image to page" : "Select exactly one image layer"}
              >
                Fit to page
              </button>
              {hasSingleImageSelection ? (
                <button
                  type="button"
                  className={topActionClass}
                  onClick={() => void trimSelectedImagePadding()}
                  disabled={!canTrimImagePadding}
                  title={imageTrimToolTitle}
                >
                  <Scissors size={14} /> Trim padding
                </button>
              ) : null}
              <button
                type="button"
                className={topActionClass}
                onClick={clipSelectedImageToCanvas}
                disabled={!canUseImageCanvasTools}
                title={imageCanvasToolTitle}
              >
                <Scissors size={14} /> Clip to canvas
              </button>
              <button
                type="button"
                className={topActionClass}
                onClick={fitSelectedImageToCanvas}
                disabled={!canUseImageCanvasTools}
                title={imageCanvasToolTitle}
              >
                Fit to canvas
              </button>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={topActionClass}
            onClick={onToggleRight}
          >
            <SlidersHorizontal size={14} /> Properties
          </button>
          <Button
            type="button"
            variant="ghost"
            className="!h-8 !rounded !px-3 !text-sm !font-medium !text-[#1b2738]"
            onClick={() => void saveTemplate()}
            disabled={isSavingTemplate || isDeletingTemplate}
          >
            {isSavingTemplate ? "Saving..." : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="!h-8 !rounded !px-3 !text-sm !font-medium !text-[#1b2738]"
            onClick={() => void publishSelectedElements()}
            disabled={
              isPublishingElements ||
              isDeletingTemplate ||
              publishCandidateIds.length === 0 ||
              !activePage
            }
          >
            {isPublishingElements ? "Publishing Elements..." : "Publish Elements"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={
              activeTemplateStatus === "published"
                ? "!h-8 !rounded !px-3 !text-sm !font-medium !text-[#b42318] hover:!text-[#8a1a13]"
                : "!h-8 !rounded !px-3 !text-sm !font-medium !text-[#1b2738]"
            }
            onClick={() =>
              void (activeTemplateStatus === "published" ? unpublishTemplate() : publishTemplate())
            }
            disabled={isPublishingTemplate || isUnpublishingTemplate || isDeletingTemplate}
          >
            {activeTemplateStatus === "published"
              ? isUnpublishingTemplate
                ? "Unpublishing..."
                : "Unpublish"
              : isPublishingTemplate
                ? "Publishing..."
                : "Publish"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="!h-8 !rounded !px-3 !text-sm !font-medium !text-[#b42318] hover:!text-[#8a1a13]"
            onClick={() => void deleteTemplate()}
            disabled={
              isDeletingTemplate ||
              isSavingTemplate ||
              isPublishingTemplate ||
              isUnpublishingTemplate ||
              !activeTemplateId
            }
          >
            {isDeletingTemplate ? "Deleting..." : "Delete"}
          </Button>

          <Button type="button" variant="ghost" className="!h-8 !rounded !px-3 !text-sm !font-medium !text-[#1b2738]" onClick={() => stageApi?.exportPng()}>
            <Download size={15} /> Download
          </Button>
        </div>
      </div>

      {hasSingleImageSelection ? (
        <div className="mt-2 border-t border-[#d7dbe1] bg-[#eef1f5] px-0 py-2">
          <div className="flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap px-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#667085]">
              Colors
            </span>
            {activeRasterPaletteLoading ? (
              <span className="px-2 text-xs text-[#667085]">Analyzing colors...</span>
            ) : activeRasterPalette.length > 0 ? (
              <div className="flex items-center gap-1.5">
                {activeRasterPalette.map((originalColor) => {
                  const mappedColor = activeRasterColorMap[originalColor] || originalColor;
                  return (
                    <label
                      key={`toolbar-raster-color-${originalColor}`}
                      className="group relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border border-[#d7dbe1]"
                      title={`${originalColor} → ${mappedColor}`}
                    >
                      <span
                        className="h-5 w-5 rounded-sm border border-black/10"
                        style={{ backgroundColor: mappedColor }}
                      />
                      <input
                        type="color"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        value={mappedColor}
                        onChange={(event) => {
                          const nextColor = normalizeHexColor(event.target.value) || originalColor;
                          const nextMap = { ...activeRasterColorMap };
                          if (nextColor === originalColor) {
                            delete nextMap[originalColor];
                          } else {
                            nextMap[originalColor] = nextColor;
                          }
                          updateElement(activeImageId, { rasterColorMap: nextMap });
                        }}
                      />
                    </label>
                  );
                })}
                <button
                  type="button"
                  className="whitespace-nowrap px-1 text-[11px] text-[#667085] underline underline-offset-2"
                  onClick={() => updateElement(activeImageId, { rasterColorMap: {} })}
                  disabled={Object.keys(activeRasterColorMap).length === 0}
                >
                  Reset
                </button>
              </div>
            ) : (
              <span className="px-2 text-xs text-[#667085]">No palette</span>
            )}
          </div>
        </div>
      ) : null}

      {hasOnlyTextSelection && activeTextElement ? (
        <div className="mt-2 border-t border-[#d7dbe1] bg-[#eef1f5] px-0 py-2">
          <div className="flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap px-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#667085]">
              Text Curve
            </span>
            <button
              type="button"
              className={
                textCurveEnabled
                  ? "inline-flex h-8 items-center rounded border border-[#2f6fca] bg-[#e8f1ff] px-3 text-sm font-medium text-[#2458a3]"
                  : "inline-flex h-8 items-center rounded border border-[#d7dbe1] bg-white px-3 text-sm font-medium text-[#445066] hover:bg-[#f8fafc]"
              }
              onClick={() =>
                updateSelectedElements({
                  textCurveEnabled: !textCurveEnabled,
                  textCurveAmount: !textCurveEnabled && textCurveAmount === 0 ? 40 : textCurveAmount,
                })
              }
            >
              {textCurveEnabled ? "On" : "Off"}
            </button>
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              aria-label="Text curve amount"
              className="h-8 w-[240px] accent-[#2f6fca] disabled:opacity-45"
              value={textCurveAmount}
              disabled={!textCurveEnabled}
              onChange={(event) =>
                updateSelectedElements({
                  textCurveEnabled: true,
                  textCurveAmount: Number(event.target.value) || 0,
                })
              }
            />
            <input
              type="number"
              min={-100}
              max={100}
              step={1}
              aria-label="Text curve value"
              className="h-8 w-20 rounded border border-[#d7dbe1] bg-white px-2 text-sm text-[#202a38] disabled:opacity-45"
              value={Math.round(textCurveAmount)}
              disabled={!textCurveEnabled}
              onChange={(event) =>
                updateSelectedElements({
                  textCurveEnabled: true,
                  textCurveAmount: Math.max(-100, Math.min(100, Number(event.target.value) || 0)),
                })
              }
            />
            <span className="text-xs text-[#667085]">
              Negative bends down, positive bends up.
            </span>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded border border-[#d7dbe1] bg-white px-3 text-sm font-medium text-[#445066] hover:bg-[#f8fafc]"
              onClick={() => updateSelectedElements({ textCurveEnabled: false, textCurveAmount: 0 })}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}

      {hasSingleVideoSelection && activeVideoElement && isVideoTrimOpen ? (
        <div className="mt-2 border-t border-[#d7dbe1] bg-[#eef1f5] px-0 py-3">
          <div className="rounded-[24px] border border-[#cad1db] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 pb-4 pt-2 shadow-sm">
            <div className="grid grid-cols-[28px,1fr] gap-x-3">
              <div className="pt-4" />

              <div ref={videoTrimViewportRef} className="relative min-w-0">
                <div
                  className="pointer-events-none absolute top-[45px] z-30 w-[3px] rounded-full bg-black/90"
                  style={{ left: `${videoTrimPlayheadViewportXPx}px`, bottom: "0px" }}
                />
                <div
                  className="pointer-events-none absolute left-0 top-0 z-30 -translate-x-1/2 whitespace-nowrap text-[13px] font-bold tabular-nums text-[#111827]"
                  style={{ left: `${videoTrimPlayheadLabelXPx}px` }}
                >
                  {formatTimelineTime(videoTrimPlayhead * 1000, true)}
                </div>
                <div className="pointer-events-none absolute right-0 top-0 flex flex-col items-end justify-start pr-1 text-right leading-none">
                  <span className="text-[11px] font-semibold text-[#9aa3ad]">Total</span>
                  <span className="mt-1 text-[12px] font-semibold tabular-nums text-[#6b7280]">
                    {formatTimelineTime(resolvedVideoDuration * 1000)}
                  </span>
                </div>

                <div className="pointer-events-none relative h-11 overflow-hidden">
                  <div className="absolute left-0 top-0 h-full" style={videoTrimContentStyle}>
                    {videoTrimSecondMarkers.map((marker) => (
                      <div
                        key={`video-minor-${marker.second}`}
                        className="absolute top-[31px] h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#8e96a3]"
                        style={{ left: `${marker.ratio * 100}%` }}
                      />
                    ))}
                    {visibleVideoTrimSecondLabels.map((marker) => (
                      <div
                        key={`video-label-${marker.second}`}
                        className="absolute top-[12px] -translate-x-1/2 text-[11px] font-semibold tabular-nums text-[#8a9099]"
                        style={{ left: `${marker.ratio * 100}%` }}
                      >
                        {formatTimelineTime(marker.second * 1000)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div
                    ref={trimTrackRef}
                    className="relative h-14 overflow-hidden touch-none select-none"
                    onPointerDown={onTrimTrackPointerDown}
                  >
                    {videoTrimSelectedBarStyle ? (
                      <div className="absolute left-0 top-0 h-full" style={videoTrimContentStyle}>
                        <div
                          className="absolute top-0 z-20 h-14 rounded-[18px] bg-[#ff5b78] px-8 shadow-[0_10px_22px_rgba(255,91,120,0.32)]"
                          style={videoTrimSelectedBarStyle}
                        >
                          <div className="absolute inset-y-1.5 left-8 right-8 overflow-hidden rounded-[12px]">
                            <FilmstripFrames
                              count={Math.max(
                                8,
                                Math.ceil(((videoTrimDraft.end - videoTrimDraft.start) / Math.max(resolvedVideoDuration, 0.001)) * videoTrimFilmstripFrameCount)
                              )}
                              images={videoTrimThumbs}
                              tone="selected"
                            />
                          </div>
                          <button
                            type="button"
                            aria-label="Trim start"
                            data-video-trim-handle
                            className="absolute inset-y-0 left-0 flex w-8 cursor-ew-resize items-center justify-center rounded-l-[18px] bg-[#ff5b78] text-white"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setVideoTrimDragEdge("start");
                              updateTrimByPointer("start", event.clientX);
                            }}
                          >
                            <ChevronLeft size={18} />
                          </button>
                          <button
                            type="button"
                            aria-label="Trim end"
                            data-video-trim-handle
                            className="absolute inset-y-0 right-0 flex w-8 cursor-ew-resize items-center justify-center rounded-r-[18px] bg-[#ff5b78] text-white"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setVideoTrimDragEdge("end");
                              updateTrimByPointer("end", event.clientX);
                            }}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="relative h-14 overflow-hidden rounded-[16px] border border-[#d0d6df] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                    <div className="absolute left-0 top-0 h-full" style={videoTrimContentStyle}>
                      <FilmstripFrames count={videoTrimFilmstripFrameCount} images={videoTrimThumbs} tone="preview" />
                      <FilmstripOverlay count={videoTrimFilmstripFrameCount} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewToast ? (
        <div
          className="editor-status-toast"
          style={
            previewToast.tone === "success"
              ? {
                  borderColor: "#86efac",
                  background: "#f0fdf4",
                }
              : previewToast.tone === "error"
                ? {
                    borderColor: "#fca5a5",
                    background: "#fef2f2",
                  }
                : undefined
          }
        >
          <div className="flex items-start gap-2">
            <span
              className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                previewToast.tone === "success"
                  ? "bg-[#16a34a]"
                  : previewToast.tone === "error"
                    ? "bg-[#dc2626]"
                    : "bg-[#2563eb]"
              }`}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#667085]">
                Template Preview
              </p>
              <p className="mt-1 text-sm font-medium text-[#1f2937]">
                {previewToast.message}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
