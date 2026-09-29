"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronLeft,
  ChevronRight,
  Crop,
  FlipHorizontal,
  FlipVertical,
  Highlighter,
  Italic,
  Layers,
  Minus,
  Palette,
  Plus,
  Scissors,
  SlidersHorizontal,
  Spline,
  Strikethrough,
  Underline,
  UnfoldVertical,
} from "lucide-react";

import {
  cx,
  FLOATING_SHADOW,
  MenuItem,
  MiniSwitch,
  PopoverHeader,
  SliderField,
  ToolButton,
  ToolDivider,
  ToolPopover,
} from "@/components/editor/EditorChrome";
import { FilmstripFrames, FilmstripOverlay } from "@/components/editor/TimelineFilmstrip";
import { useTimelineScrubber } from "@/components/editor/useTimelineScrubber";
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
  extractSvgPaletteColors,
  migrateRasterColorMap,
  normalizeRasterColorMap,
  RASTER_PALETTE_VERSION,
  serializeRasterColorMap,
} from "@/lib/editor/imagePalette";
import { formatTimelineTime } from "@/lib/editor/animationTimeline";
import { useEditorStore, type EditorElement } from "@/store/editorStore";

type TextDecorationValue =
  | ""
  | "underline"
  | "line-through"
  | "underline line-through";

type TrimRange = {
  start: number;
  end: number;
};

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

/**
 * Selection-aware tools, floating over the top of the canvas.
 *
 * Only what applies to the current selection is shown; settings with several knobs (spacing,
 * curve, text background, image colours, crop & fit) open in popovers instead of stacking extra
 * rows above the canvas. The video trimmer docks over the bottom of the canvas while open.
 */
export default function ContextToolbar() {
  const [isVideoTrimOpen, setIsVideoTrimOpen] = useState(false);
  const [isTrimmingImagePadding, setIsTrimmingImagePadding] = useState(false);
  const [videoTrimDraft, setVideoTrimDraft] = useState<TrimRange>({ start: 0, end: 1 });
  const [videoTrimDragEdge, setVideoTrimDragEdge] = useState<"start" | "end" | null>(null);
  const [videoTrimPlayhead, setVideoTrimPlayhead] = useState(0);
  const [videoTrimFrameStrip, setVideoTrimFrameStrip] = useState<string[]>([]);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);
  const videoTrimViewportRef = useRef<HTMLDivElement | null>(null);
  const videoTrimDraftRef = useRef<TrimRange>({ start: 0, end: 1 });
  const videoTrimFrameCacheRef = useRef<Map<string, string[]>>(new Map());
  const [videoTrimViewportWidth, setVideoTrimViewportWidth] = useState(0);

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const stageApi = useEditorStore((state) => state.stageApi);
  const showRightSidebar = useEditorStore((state) => state.showRightSidebar);
  const setShowRightSidebar = useEditorStore((state) => state.setShowRightSidebar);
  const flipSelected = useEditorStore((state) => state.flipSelected);
  const updateElement = useEditorStore((state) => state.updateElement);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);

  const hasSelection = selectedIds.length > 0;
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
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
  const activeRasterColorMapKey = serializeRasterColorMap(activeRasterColorMap);
  const activeVectorSource = String(activeImageElement?.vectorSrc || "").trim();
  const activeRasterPaletteLoading = Boolean(
    hasSingleImageSelection &&
      activeImageId &&
      activeRasterSource &&
      (activeImageRasterOriginalSrc !== activeRasterSource || activeRasterPaletteVersion < RASTER_PALETTE_VERSION)
  );
  const activeVideoDuration = Number(activeVideoElement?.videoDuration || 0);
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

    // Shapes keep their authored SVG: list its true colours instead of pixel-extracting the
    // rasterized PNG, whose anti-aliased edges hallucinate phantom near-black palette entries.
    const svgPalette = extractSvgPaletteColors(activeVectorSource, 6);
    const palettePromise =
      svgPalette.length > 0 ? Promise.resolve(svgPalette) : extractImagePaletteFromSource(activeRasterSource, 6);

    void palettePromise
      .then((colors) => {
        if (cancelled) return;
        const palette = Array.isArray(colors) ? colors : [];
        const patch: {
          rasterOriginalSrc?: string;
          rasterPalette?: string[];
          rasterPaletteVersion?: number;
          rasterColorMap?: Record<string, string>;
        } = {
          rasterPaletteVersion: RASTER_PALETTE_VERSION,
          rasterPalette: palette,
        };
        if (!sourceWasPersisted) {
          patch.rasterOriginalSrc = activeRasterSource;
        }
        // Carry an existing recolor over to the re-derived palette's keys (nearest colour wins).
        const currentMap = Object.fromEntries(JSON.parse(activeRasterColorMapKey) as Array<[string, string]>);
        const migratedMap = migrateRasterColorMap(currentMap, palette);
        if (serializeRasterColorMap(migratedMap) !== activeRasterColorMapKey) {
          patch.rasterColorMap = migratedMap;
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
    activeRasterColorMapKey,
    activeRasterPalette.length,
    activeRasterPaletteVersion,
    activeRasterSource,
    activeVectorSource,
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

  const textCurveEnabled = Boolean(activeTextElement?.textCurveEnabled);
  const textBackgroundEnabled = Boolean(activeTextElement?.textBackgroundEnabled);
  const textBackgroundColor =
    normalizeHexColor(String(activeTextElement?.textBackgroundColor || "")) || "#000000";
  const textBackgroundPercent = (value: unknown, fallback: number) => {
    const numeric = Number(value);
    return Math.round((Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback) * 100);
  };
  const textBackgroundOpacityPct = textBackgroundPercent(activeTextElement?.textBackgroundOpacity, 1);
  const textBackgroundRoundnessPct = textBackgroundPercent(activeTextElement?.textBackgroundAngleSize, 0);
  const textBackgroundPaddingXPct = textBackgroundPercent(activeTextElement?.textBackgroundPaddingX, 0);
  const textBackgroundPaddingYPct = textBackgroundPercent(activeTextElement?.textBackgroundPaddingY, 0);
  const textCurveAmount = Math.max(-200, Math.min(200, Number(activeTextElement?.textCurveAmount || 0)));
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

  if (!hasSelection || selectedElements.length === 0) return null;

  const textAlign = activeTextElement?.align === "center" || activeTextElement?.align === "right" ? activeTextElement.align : "left";
  const AlignIcon = textAlign === "center" ? AlignCenter : textAlign === "right" ? AlignRight : AlignLeft;
  const nextTextAlign = textAlign === "left" ? "center" : textAlign === "center" ? "right" : "left";
  const textColor = activeTextElement ? activeTextElement.color || activeTextElement.fill || "#111827" : "#111827";
  const fontSize = activeTextElement ? Math.round(activeTextElement.fontSize) : 0;
  const setFontSize = (value: number) => {
    if (!activeTextElement) return;
    updateSelectedElements({
      fontSize: Math.max(8, Math.min(400, Number(value) || activeTextElement.fontSize)),
    });
  };
  const lineHeight = Number(activeTextElement?.lineHeight || 1);
  const letterSpacing = Number(activeTextElement?.letterSpacing || 0);
  const mappedPalette = activeRasterPalette.map((original) => activeRasterColorMap[original] || original);
  const numberFieldClass =
    "h-7 w-16 rounded-lg bg-[#f1f2f4] px-2 text-right text-[12px] tabular-nums text-t-primary outline-none focus:ring-2 focus:ring-brand-teal/30 disabled:opacity-45";

  const mergeButton = canMergeSelection ? (
    <ToolButton
      icon={Layers}
      label="Merge"
      showLabel
      onClick={() => void mergeSelectedLayers()}
      disabled={hasVideoInSelection}
      title={hasVideoInSelection ? "Video layers are not supported in merge yet" : "Merge selected layers into one image layer (Ctrl+Shift+M)"}
    />
  ) : null;

  const flipButtons = (
    <>
      <ToolButton icon={FlipHorizontal} label="Flip horizontally" onClick={() => flipSelected("x")} />
      <ToolButton icon={FlipVertical} label="Flip vertically" onClick={() => flipSelected("y")} />
    </>
  );

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
        <div
          role="toolbar"
          aria-label="Selection tools"
          className={cx(
            "pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-white p-1 [scrollbar-width:none]",
            FLOATING_SHADOW
          )}
        >
          {hasOnlyTextSelection && activeTextElement ? (
            <>
              <label
                className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[#eef0f2]"
                title="Text color"
              >
                <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: textColor }} />
                <input
                  type="color"
                  aria-label="Text color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={textColor}
                  onChange={(event) => updateSelectedElements({ color: event.target.value, fill: event.target.value })}
                />
              </label>

              <div className="mx-0.5 flex h-8 shrink-0 items-center rounded-full bg-[#f1f2f4]">
                <button
                  type="button"
                  aria-label="Decrease font size"
                  title="Decrease font size"
                  className="inline-flex h-8 w-7 items-center justify-center rounded-l-full text-t-secondary hover:text-t-primary"
                  onClick={() => setFontSize(fontSize - 1)}
                >
                  <Minus size={13} />
                </button>
                <input
                  type="number"
                  min={8}
                  max={400}
                  aria-label="Font size"
                  title="Font size"
                  className="h-8 w-9 bg-transparent text-center text-[13px] font-medium tabular-nums text-t-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                />
                <button
                  type="button"
                  aria-label="Increase font size"
                  title="Increase font size"
                  className="inline-flex h-8 w-7 items-center justify-center rounded-r-full text-t-secondary hover:text-t-primary"
                  onClick={() => setFontSize(fontSize + 1)}
                >
                  <Plus size={13} />
                </button>
              </div>

              <ToolDivider />
              <ToolButton
                icon={Bold}
                label="Bold"
                active={isBold}
                onClick={() => updateSelectedElements({ fontWeight: isBold ? "400" : "700" })}
              />
              <ToolButton
                icon={Italic}
                label="Italic"
                active={isItalic}
                onClick={() => updateSelectedElements({ fontStyle: isItalic ? "normal" : "italic" })}
              />
              <ToolButton
                icon={Underline}
                label="Underline"
                active={isUnderline}
                onClick={() => updateSelectedElements({ textDecoration: toggleTextDecoration("underline") })}
              />
              <ToolButton
                icon={Strikethrough}
                label="Strikethrough"
                active={isStrikethrough}
                onClick={() => updateSelectedElements({ textDecoration: toggleTextDecoration("line-through") })}
              />

              <ToolDivider />
              <ToolButton
                icon={AlignIcon}
                label={`Alignment: ${textAlign} (click for ${nextTextAlign})`}
                onClick={() => updateSelectedElements({ align: nextTextAlign })}
              />
              <ToolPopover
                label="Spacing"
                width={260}
                trigger={({ open, triggerProps }) => (
                  <ToolButton icon={UnfoldVertical} label="Spacing" active={open} chevron {...triggerProps} />
                )}
              >
                <PopoverHeader title="Spacing" />
                <div className="space-y-3">
                  <SliderField
                    label="Line height"
                    min={0.4}
                    max={4}
                    step={0.05}
                    value={lineHeight}
                    onChange={(value) => updateSelectedElements({ lineHeight: Math.max(0.4, Math.min(4, value)) })}
                    display={
                      <input
                        type="number"
                        min={0.4}
                        max={4}
                        step={0.05}
                        aria-label="Line height value"
                        className={numberFieldClass}
                        value={lineHeight.toFixed(2)}
                        onChange={(event) =>
                          updateSelectedElements({
                            lineHeight: Math.max(0.4, Math.min(4, Number(event.target.value) || lineHeight)),
                          })
                        }
                      />
                    }
                  />
                  <SliderField
                    label="Letter spacing"
                    min={-10}
                    max={100}
                    step={0.5}
                    value={letterSpacing}
                    onChange={(value) => updateSelectedElements({ letterSpacing: Math.max(-10, Math.min(200, value)) })}
                    display={
                      <input
                        type="number"
                        min={-10}
                        max={200}
                        step={0.1}
                        aria-label="Letter spacing value"
                        className={numberFieldClass}
                        value={letterSpacing}
                        onChange={(event) =>
                          updateSelectedElements({
                            letterSpacing: Math.max(-10, Math.min(200, Number(event.target.value) || 0)),
                          })
                        }
                      />
                    }
                  />
                </div>
              </ToolPopover>

              <ToolDivider />
              <ToolPopover
                label="Curve"
                width={280}
                trigger={({ open, triggerProps }) => (
                  <ToolButton
                    icon={Spline}
                    label="Curve"
                    showLabel
                    active={open || textCurveEnabled}
                    chevron
                    {...triggerProps}
                  />
                )}
              >
                <PopoverHeader title="Curve">
                  <MiniSwitch
                    label="Curve text"
                    checked={textCurveEnabled}
                    onChange={() =>
                      updateSelectedElements({
                        textCurveEnabled: !textCurveEnabled,
                        textCurveAmount: !textCurveEnabled && textCurveAmount === 0 ? 40 : textCurveAmount,
                      })
                    }
                  />
                </PopoverHeader>
                <SliderField
                  label="Bend"
                  min={-100}
                  max={100}
                  value={textCurveAmount}
                  disabled={!textCurveEnabled}
                  onChange={(value) => updateSelectedElements({ textCurveEnabled: true, textCurveAmount: value || 0 })}
                  display={
                    <input
                      type="number"
                      min={-200}
                      max={200}
                      step={1}
                      aria-label="Text curve value"
                      className={numberFieldClass}
                      value={Math.round(textCurveAmount)}
                      disabled={!textCurveEnabled}
                      onChange={(event) =>
                        updateSelectedElements({
                          textCurveEnabled: true,
                          textCurveAmount: Math.max(-200, Math.min(200, Number(event.target.value) || 0)),
                        })
                      }
                    />
                  }
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] leading-4 text-t-tertiary">Negative bends down, positive bends up.</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-t-secondary hover:bg-[#f1f2f4] hover:text-t-primary"
                    onClick={() => updateSelectedElements({ textCurveEnabled: false, textCurveAmount: 0 })}
                  >
                    Reset
                  </button>
                </div>
              </ToolPopover>

              <ToolPopover
                label="Text background"
                width={280}
                trigger={({ open, triggerProps }) => (
                  <ToolButton
                    icon={Highlighter}
                    label="Background"
                    showLabel
                    active={open || textBackgroundEnabled}
                    chevron
                    {...triggerProps}
                  />
                )}
              >
                <PopoverHeader title="Text background">
                  <MiniSwitch
                    label="Text background"
                    checked={textBackgroundEnabled}
                    onChange={() =>
                      updateSelectedElements(
                        textBackgroundEnabled
                          ? { textBackgroundEnabled: false }
                          : {
                              textBackgroundEnabled: true,
                              // First switch-on gets a readable pill; later toggles keep what was set.
                              textBackgroundColor: activeTextElement.textBackgroundColor || "#000000",
                              textBackgroundOpacity: activeTextElement.textBackgroundOpacity ?? 1,
                              textBackgroundAngleSize: activeTextElement.textBackgroundAngleSize ?? 0.4,
                              textBackgroundPaddingX: activeTextElement.textBackgroundPaddingX ?? 0.4,
                              textBackgroundPaddingY: activeTextElement.textBackgroundPaddingY ?? 0.2,
                            }
                      )
                    }
                  />
                </PopoverHeader>
                <div className={cx("space-y-3", !textBackgroundEnabled && "pointer-events-none")}>
                  <label
                    className={cx(
                      "flex items-center justify-between text-[12px] text-t-secondary",
                      !textBackgroundEnabled && "opacity-45"
                    )}
                  >
                    <span>Color</span>
                    <span className="relative inline-flex h-7 w-12 items-center justify-center rounded-lg bg-[#f1f2f4]">
                      <span className="h-4 w-8 rounded ring-1 ring-black/10" style={{ backgroundColor: textBackgroundColor }} />
                      <input
                        type="color"
                        aria-label="Text background color"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        value={textBackgroundColor}
                        disabled={!textBackgroundEnabled}
                        onChange={(event) => updateSelectedElements({ textBackgroundColor: event.target.value })}
                      />
                    </span>
                  </label>
                  {(
                    [
                      ["Opacity", "textBackgroundOpacity", textBackgroundOpacityPct],
                      ["Roundness", "textBackgroundAngleSize", textBackgroundRoundnessPct],
                      ["Padding X", "textBackgroundPaddingX", textBackgroundPaddingXPct],
                      ["Padding Y", "textBackgroundPaddingY", textBackgroundPaddingYPct],
                    ] as const
                  ).map(([label, field, value]) => (
                    <SliderField
                      key={field}
                      label={label}
                      min={0}
                      max={100}
                      value={value}
                      disabled={!textBackgroundEnabled}
                      onChange={(next) => updateSelectedElements({ [field]: (Number(next) || 0) / 100 })}
                    />
                  ))}
                </div>
              </ToolPopover>

              {mergeButton ? (
                <>
                  <ToolDivider />
                  {mergeButton}
                </>
              ) : null}
            </>
          ) : hasSingleVideoSelection && activeVideoElement ? (
            <>
              <ToolButton
                icon={Scissors}
                label="Trim"
                showLabel
                active={isVideoTrimOpen}
                onClick={() => setIsVideoTrimOpen((prev) => !prev)}
              />
              <ToolButton icon={Crop} label="Fill page" showLabel onClick={fitSelectedVideoToPage} />
            </>
          ) : (
            <>
              {flipButtons}
              {hasSingleImageSelection ? (
                <>
                  <ToolDivider />
                  <ToolPopover
                    label="Image colors"
                    width={260}
                    trigger={({ open, triggerProps }) => (
                      <ToolButton label="Colors" active={open} chevron title="Recolor this image" {...triggerProps}>
                        {mappedPalette.length > 0 ? (
                          <span className="flex -space-x-1">
                            {mappedPalette.slice(0, 4).map((color, index) => (
                              <span
                                key={`${color}-${index}`}
                                className="h-4 w-4 rounded-full ring-2 ring-white"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </span>
                        ) : (
                          <Palette size={16} strokeWidth={1.9} />
                        )}
                      </ToolButton>
                    )}
                  >
                    <PopoverHeader title="Colors">
                      <button
                        type="button"
                        className="rounded-full px-2.5 py-1 text-[12px] font-medium text-t-secondary hover:bg-[#f1f2f4] hover:text-t-primary disabled:opacity-40"
                        onClick={() => updateElement(activeImageId, { rasterColorMap: {} })}
                        disabled={Object.keys(activeRasterColorMap).length === 0}
                      >
                        Reset
                      </button>
                    </PopoverHeader>
                    {activeRasterPaletteLoading ? (
                      <p className="text-[12px] text-t-secondary">Analyzing colors…</p>
                    ) : activeRasterPalette.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {activeRasterPalette.map((originalColor) => {
                          const mappedColor = activeRasterColorMap[originalColor] || originalColor;
                          return (
                            <label
                              key={`context-raster-color-${originalColor}`}
                              className="relative inline-flex h-9 w-9 cursor-pointer rounded-full ring-1 ring-black/10 transition-transform hover:scale-105"
                              style={{ backgroundColor: mappedColor }}
                              title={`${originalColor} → ${mappedColor}`}
                            >
                              <input
                                type="color"
                                aria-label={`Replace ${originalColor}`}
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
                      </div>
                    ) : (
                      <p className="text-[12px] text-t-secondary">No palette for this image.</p>
                    )}
                  </ToolPopover>

                  <ToolPopover
                    label="Crop and fit"
                    role="menu"
                    width={250}
                    trigger={({ open, triggerProps }) => (
                      <ToolButton icon={Crop} label="Crop & fit" showLabel active={open} chevron {...triggerProps} />
                    )}
                  >
                    {(close) => (
                      <div className="-m-1.5">
                        <MenuItem
                          onClick={() => {
                            close();
                            fitSelectedImageToPage();
                          }}
                          title="Scale the image to cover the whole page"
                        >
                          Fill page
                        </MenuItem>
                        <MenuItem
                          disabled={!canUseImageCanvasTools}
                          title={imageCanvasToolTitle}
                          onClick={() => {
                            close();
                            void fitSelectedImageToCanvas();
                          }}
                        >
                          Fill page and crop overflow
                        </MenuItem>
                        <MenuItem
                          disabled={!canUseImageCanvasTools}
                          title={imageCanvasToolTitle}
                          onClick={() => {
                            close();
                            void clipSelectedImageToCanvas();
                          }}
                        >
                          Crop to page edges
                        </MenuItem>
                        <MenuItem
                          icon={Scissors}
                          disabled={!canTrimImagePadding}
                          title={imageTrimToolTitle}
                          onClick={() => {
                            close();
                            void trimSelectedImagePadding();
                          }}
                        >
                          {isTrimmingImagePadding ? "Trimming…" : "Trim transparent padding"}
                        </MenuItem>
                      </div>
                    )}
                  </ToolPopover>
                </>
              ) : null}
              {mergeButton ? (
                <>
                  <ToolDivider />
                  {mergeButton}
                </>
              ) : null}
            </>
          )}

          <ToolDivider />
          <ToolButton
            icon={SlidersHorizontal}
            label="Properties"
            active={showRightSidebar}
            onClick={() => setShowRightSidebar(!showRightSidebar)}
            title="Position, size and advanced settings"
          />
        </div>
      </div>

      {hasSingleVideoSelection && activeVideoElement && isVideoTrimOpen ? (
        <div className="absolute inset-x-3 bottom-3 z-30">
          <div className={cx("rounded-3xl bg-white px-4 pb-4 pt-3", FLOATING_SHADOW)}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-t-primary">Trim video</span>
                <span className="rounded-full bg-[#f1f2f4] px-2 py-0.5 text-[12px] tabular-nums text-t-secondary">
                  {videoTrimWindowLabel}
                </span>
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-full bg-brand-teal px-3.5 text-[13px] font-semibold text-white hover:bg-brand-teal/90"
                onClick={() => setIsVideoTrimOpen(false)}
              >
                Done
              </button>
            </div>

            <div ref={videoTrimViewportRef} className="relative min-w-0">
              <div
                className="pointer-events-none absolute top-[45px] z-30 w-[3px] rounded-full bg-black/90"
                style={{ left: `${videoTrimPlayheadViewportXPx}px`, bottom: "0px" }}
              />
              <div
                className="pointer-events-none absolute left-0 top-0 z-30 -translate-x-1/2 whitespace-nowrap text-[13px] font-bold tabular-nums text-t-primary"
                style={{ left: `${videoTrimPlayheadLabelXPx}px` }}
              >
                {formatTimelineTime(videoTrimPlayhead * 1000, true)}
              </div>
              <div className="pointer-events-none absolute right-0 top-0 flex flex-col items-end justify-start pr-1 text-right leading-none">
                <span className="text-[11px] font-semibold text-t-tertiary">Total</span>
                <span className="mt-1 text-[12px] font-semibold tabular-nums text-t-secondary">
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
                        className="absolute top-0 z-20 h-14 rounded-[18px] bg-brand-teal px-8 shadow-[0_10px_22px_rgba(34,130,140,0.28)]"
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
                          className="absolute inset-y-0 left-0 flex w-8 cursor-ew-resize items-center justify-center rounded-l-[18px] bg-brand-teal text-white"
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
                          className="absolute inset-y-0 right-0 flex w-8 cursor-ew-resize items-center justify-center rounded-r-[18px] bg-brand-teal text-white"
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

                <div className="relative h-14 overflow-hidden rounded-[16px] bg-[#f1f2f4]">
                  <div className="absolute left-0 top-0 h-full" style={videoTrimContentStyle}>
                    <FilmstripFrames count={videoTrimFilmstripFrameCount} images={videoTrimThumbs} tone="preview" />
                    <FilmstripOverlay count={videoTrimFilmstripFrameCount} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
