"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Download,
  FlipHorizontal,
  Italic,
  Layers,
  Menu,
  Scissors,
  Strikethrough,
  Underline,
  Undo2,
  Redo2,
} from "lucide-react";

import Button from "@/components/ui/button";
import {
  canUseCanvasCropForImage,
  computeClipToCanvasPatch,
  computeFitToCanvasPatch,
} from "@/lib/editor/imageCrop";
import {
  extractSvgPaletteFromSource,
  isSvgSource,
  normalizeHexColor,
  normalizeSvgColorMap,
} from "@/lib/editor/svgColors";
import { extractImagePaletteFromSource } from "@/lib/editor/imagePalette";
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

export default function Toolbar({ onToggleLeft, onToggleRight }: ToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isPublishingTemplate, setIsPublishingTemplate] = useState(false);
  const [isUnpublishingTemplate, setIsUnpublishingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isVideoTrimOpen, setIsVideoTrimOpen] = useState(false);
  const [videoTrimDraft, setVideoTrimDraft] = useState<TrimRange>({ start: 0, end: 1 });
  const [videoTrimDragEdge, setVideoTrimDragEdge] = useState<"start" | "end" | null>(null);
  const [videoTrimPlayhead, setVideoTrimPlayhead] = useState(0);
  const [videoTrimFrameStrip, setVideoTrimFrameStrip] = useState<string[]>([]);
  const [rasterPaletteEntry, setRasterPaletteEntry] = useState<{ key: string; colors: string[] }>({
    key: "",
    colors: [],
  });
  const trimTrackRef = useRef<HTMLDivElement | null>(null);
  const videoTrimDraftRef = useRef<TrimRange>({ start: 0, end: 1 });
  const videoTrimFrameCacheRef = useRef<Map<string, string[]>>(new Map());

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
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const historyLength = useEditorStore((state) => state.history.length);
  const stageApi = useEditorStore((state) => state.stageApi);

  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const flipSelected = useEditorStore((state) => state.flipSelected);
  const exportDesign = useEditorStore((state) => state.exportDesign);
  const updateElement = useEditorStore((state) => state.updateElement);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);
  const setTemplateMeta = useEditorStore((state) => state.setTemplateMeta);
  const clearTemplateMeta = useEditorStore((state) => state.clearTemplateMeta);

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

  const updateTemplateIdInUrl = useCallback(
    (templateId: string) => {
      const params = new URLSearchParams(templateQueryKey);
      if (templateId) {
        params.set("templateId", templateId);
      } else {
        params.delete("templateId");
      }
      const nextQuery = params.toString();
      router.replace(nextQuery ? `/editor-pro?${nextQuery}` : "/editor-pro");
    },
    [router, templateQueryKey]
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
  const activeImageSvgOriginalSrc = String(activeImageElement?.svgOriginalSrc || "").trim();
  const activeSvgSource = useMemo(() => {
    const source = String(activeImageElement?.svgOriginalSrc || activeImageSrc || "").trim();
    if (!source || !isSvgSource(source)) return "";
    return source;
  }, [activeImageElement?.svgOriginalSrc, activeImageSrc]);
  const activeSvgPalette = Array.isArray(activeImageElement?.svgPalette)
    ? activeImageElement.svgPalette
        .map((value) => normalizeHexColor(String(value || "")))
        .filter((value): value is string => Boolean(value))
    : ([] as string[]);
  const activeSvgColorMap = normalizeSvgColorMap(activeImageElement?.svgColorMap);
  const rasterPaletteKey = useMemo(() => {
    if (!hasSingleImageSelection || !activeImageId || !activeImageSrc || activeSvgSource) return "";
    return `${activeImageId}::${activeImageSrc}`;
  }, [activeImageId, activeImageSrc, activeSvgSource, hasSingleImageSelection]);
  const activeRasterPalette =
    rasterPaletteKey && rasterPaletteEntry.key === rasterPaletteKey ? rasterPaletteEntry.colors : [];
  const activeRasterPaletteLoading =
    Boolean(rasterPaletteKey) && rasterPaletteEntry.key !== rasterPaletteKey;
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
  const canUseImageCanvasTools =
    hasSingleImageSelection && Boolean(activePage) && imageCanvasSupport.supported;
  const imageCanvasToolTitle = imageCanvasSupport.supported
    ? "This action keeps image bounds inside canvas area"
    : imageCanvasSupport.reason || "Select exactly one image layer";

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

  const clipSelectedImageToCanvas = useCallback(() => {
    if (!activeImageElement || !activePage) return;
    const result = computeClipToCanvasPatch(activeImageElement, activePage);
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

  const fitSelectedImageToCanvas = useCallback(() => {
    if (!activeImageElement || !activePage) return;
    const result = computeFitToCanvasPatch(activeImageElement, activePage);
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

  useEffect(() => {
    if (!activeImageId || !activeSvgSource) return;

    const hasPalette = activeSvgPalette.length > 0;
    const sourceWasPersisted = activeImageSvgOriginalSrc === activeSvgSource;
    if (hasPalette && sourceWasPersisted) return;

    let cancelled = false;

    void extractSvgPaletteFromSource(activeSvgSource)
      .then((palette) => {
        if (cancelled) return;
        const patch: { svgOriginalSrc?: string; svgPalette?: string[] } = {};
        if (!sourceWasPersisted) {
          patch.svgOriginalSrc = activeSvgSource;
        }
        if (Array.isArray(palette) && palette.length > 0) {
          patch.svgPalette = palette;
        }
        if (Object.keys(patch).length > 0) {
          updateElement(activeImageId, patch, { recordHistory: false });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    activeImageId,
    activeImageSvgOriginalSrc,
    activeSvgPalette.length,
    activeSvgSource,
    updateElement,
  ]);

  useEffect(() => {
    if (!rasterPaletteKey || !activeImageSrc) return;
    let cancelled = false;

    void extractImagePaletteFromSource(activeImageSrc, 8)
      .then((colors) => {
        if (cancelled) return;
        setRasterPaletteEntry({
          key: rasterPaletteKey,
          colors: Array.isArray(colors) ? colors : [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRasterPaletteEntry({
          key: rasterPaletteKey,
          colors: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeImageSrc, rasterPaletteKey]);

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

  const updateTrimByPointer = useCallback(
    (edge: "start" | "end", clientX: number, options?: { commit?: boolean }) => {
      if (!trimTrackRef.current) return;
      const rect = trimTrackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clampNumber((clientX - rect.left) / rect.width, 0, 1);
      const targetTime = ratio * resolvedVideoDuration;
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
    [activeVideoElement, resolvedVideoDuration, updateElement]
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

      return template;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save template.";
      window.alert(message);
      return null;
    } finally {
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
    isSavingTemplate,
    stageApi,
    setTemplateMeta,
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
      updateTemplateIdInUrl("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete template.";
      window.alert(message);
    } finally {
      setIsDeletingTemplate(false);
    }
  }, [
    activeTemplateId,
    activeTemplateName,
    clearTemplateMeta,
    isDeletingTemplate,
    updateTemplateIdInUrl,
  ]);

  const topActionClass =
    "inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-[#202a38] hover:bg-[#eef2f8] disabled:cursor-not-allowed disabled:opacity-40";
  const iconBtnClass =
    "inline-flex h-8 w-8 items-center justify-center rounded text-[#445066] hover:bg-[#eef2f8] disabled:opacity-40";
  const textControlBtnClass =
    "inline-flex h-8 w-8 items-center justify-center rounded border border-[#d7dbe1] bg-white text-[#445066] hover:bg-[#eef2f8]";
  const textControlBtnActiveClass =
    "inline-flex h-8 w-8 items-center justify-center rounded border border-[#2f6fca] bg-[#e8f1ff] text-[#2458a3]";
  const videoTrimStartPercent = resolvedVideoDuration > 0 ? clampNumber(videoTrimDraft.start / resolvedVideoDuration, 0, 1) : 0;
  const videoTrimEndPercent = resolvedVideoDuration > 0 ? clampNumber(videoTrimDraft.end / resolvedVideoDuration, 0, 1) : 1;
  const videoTrimPlayheadPercent = resolvedVideoDuration > 0 ? clampNumber(videoTrimPlayhead / resolvedVideoDuration, 0, 1) : 0;
  const videoTrimWindowLabel = `${formatTrimTime(videoTrimDraft.start)}s - ${formatTrimTime(videoTrimDraft.end)}s`;
  const videoTrimThumbs = useMemo(
    () => (videoTrimFrameStrip.length > 0 ? videoTrimFrameStrip : new Array(TRIM_TRACK_SLOT_COUNT).fill("")),
    [videoTrimFrameStrip]
  );
  const onTrimTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!trimTrackRef.current) return;
      const rect = trimTrackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
      const nextTime = ratio * resolvedVideoDuration;
      setVideoTrimPlayhead(clampNumber(nextTime, videoTrimDraft.start, videoTrimDraft.end));
    },
    [resolvedVideoDuration, videoTrimDraft.end, videoTrimDraft.start]
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
              <button type="button" className={topActionClass} onClick={() => flipSelected("x")}>
                <FlipHorizontal size={14} /> Flip
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
              {hasSingleImageSelection ? (
                <div className="flex max-w-[380px] items-center gap-1 overflow-x-auto rounded border border-[#d7dbe1] bg-white px-1 py-1">
                  {activeSvgSource && activeSvgPalette.length > 0 ? (
                    activeSvgPalette.map((originalColor) => {
                      const mappedColor = activeSvgColorMap[originalColor] || originalColor;
                      return (
                        <label
                          key={`toolbar-svg-color-${originalColor}`}
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
                              const nextMap = { ...activeSvgColorMap };
                              if (nextColor === originalColor) {
                                delete nextMap[originalColor];
                              } else {
                                nextMap[originalColor] = nextColor;
                              }
                              updateElement(activeImageId, { svgColorMap: nextMap });
                            }}
                          />
                        </label>
                      );
                    })
                  ) : activeSvgSource ? (
                    <span className="px-2 text-xs text-[#667085]">No SVG palette</span>
                  ) : activeRasterPaletteLoading ? (
                    <span className="px-2 text-xs text-[#667085]">Analyzing colors...</span>
                  ) : activeRasterPalette.length > 0 ? (
                    activeRasterPalette.map((color) => (
                      <span
                        key={`toolbar-raster-color-${color}`}
                        className="inline-flex h-7 w-7 shrink-0 rounded border border-[#d7dbe1]"
                        style={{ backgroundColor: color }}
                        title={color}
                        aria-label={`Detected color ${color}`}
                      />
                    ))
                  ) : (
                    <span className="px-2 text-xs text-[#667085]">No palette</span>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={topActionClass}
            onClick={onToggleRight}
          >
            <Layers size={14} /> Position
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

      {hasSingleVideoSelection && activeVideoElement && isVideoTrimOpen ? (
        <div className="mt-2 flex items-center gap-3 rounded-md border border-[#2b3038] bg-[#14181f] p-2">
          <div className="w-[68px] shrink-0 rounded bg-[#272d36] px-2 py-1 text-right text-[28px] font-semibold tracking-tight text-[#f8fafc] [font-size:clamp(14px,2.1vw,30px)] leading-none">
            {formatTrimTime(videoTrimPlayhead)}
          </div>

          <div
            ref={trimTrackRef}
            className="relative h-12 min-w-0 flex-1 overflow-hidden rounded border border-[#2f3640] bg-[#0f1218]"
            onPointerDown={onTrimTrackPointerDown}
          >
            <div className="absolute inset-0 flex">
              {videoTrimThumbs.map((thumb, index) => (
                <div key={`trim-thumb-${index}`} className="relative h-full min-w-0 flex-1 overflow-hidden border-r border-[#1c222b] last:border-r-0">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover opacity-95" draggable={false} />
                  ) : (
                    <div className="h-full w-full bg-[linear-gradient(135deg,#1b222c,#11161d)]" />
                  )}
                </div>
              ))}
            </div>

            <div
              className="absolute bottom-0 top-0 bg-black/55"
              style={{ left: 0, width: `${videoTrimStartPercent * 100}%` }}
            />
            <div
              className="absolute bottom-0 top-0 bg-black/55"
              style={{ left: `${videoTrimEndPercent * 100}%`, right: 0 }}
            />
            <div
              className="absolute bottom-0 top-0 border-x-2 border-[#37b2ff] bg-[#37b2ff]/10"
              style={{
                left: `${videoTrimStartPercent * 100}%`,
                width: `${Math.max(0.8, (videoTrimEndPercent - videoTrimStartPercent) * 100)}%`,
              }}
            />
            <div
              className="absolute bottom-0 top-0 z-[3] w-0.5 bg-[#1fb4ff] shadow-[0_0_0_1px_rgba(31,180,255,0.45)]"
              style={{ left: `${videoTrimPlayheadPercent * 100}%` }}
            />

            <button
              type="button"
              aria-label="Trim start"
              className="absolute bottom-0 top-0 z-[4] w-2 -translate-x-1/2 cursor-ew-resize bg-[#37b2ff] shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
              style={{ left: `${videoTrimStartPercent * 100}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setVideoTrimDragEdge("start");
                updateTrimByPointer("start", event.clientX);
              }}
            />
            <button
              type="button"
              aria-label="Trim end"
              className="absolute bottom-0 top-0 z-[4] w-2 -translate-x-1/2 cursor-ew-resize bg-[#37b2ff] shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
              style={{ left: `${videoTrimEndPercent * 100}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setVideoTrimDragEdge("end");
                updateTrimByPointer("end", event.clientX);
              }}
            />
          </div>

          <div className="shrink-0 rounded bg-[#272d36] px-2 py-1 text-xs font-semibold text-[#d2d7de]">
            {formatTrimTime(resolvedVideoDuration)}s
          </div>
        </div>
      ) : null}
    </div>
  );
}
