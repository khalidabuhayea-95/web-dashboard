"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

import { FilmstripFrames, FilmstripOverlay } from "@/components/editor/TimelineFilmstrip";
import { useTimelineScrubber } from "@/components/editor/useTimelineScrubber";
import {
  MIN_LAYER_DURATION_MS,
  clampTimelineWindow,
  formatTimelineTime,
  getPageDurationMs,
  normalizeAnimationType,
  resolveTimelineWindow,
} from "@/lib/editor/animationTimeline";
import { useEditorStore } from "@/store/editorStore";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampProgress(value: number) {
  return clamp(value, 0, 1);
}

function getProgressFromPointerPosition(clientX: number, rectLeft: number, rectWidth: number) {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return 0;
  return clampProgress((clientX - rectLeft) / rectWidth);
}

function getTimeFromProgress(progress: number, durationMs: number) {
  return clampProgress(progress) * Math.max(0, durationMs);
}

type TrimDragMode = "start" | "end" | "move";

interface TrimDragState {
  mode: TrimDragMode;
  initialClientX: number;
  startMs: number;
  endMs: number;
}

interface TimelineTrackBounds {
  left: number;
  width: number;
}

interface PagesTimelineProps {
  showTimeline?: boolean;
}

const SCRUB_DEAD_ZONE_PX = 2;
const TRIM_HANDLE_WIDTH_PX = 32;

function isLikelyVideoSource(source: string) {
  const safeSource = String(source || "").trim().toLowerCase();
  return (
    safeSource.startsWith("data:video/") ||
    /\.(mp4|mov|webm|m4v|ogg)(\?.*)?$/i.test(safeSource)
  );
}

function getElementVideoSource(
  element:
    | {
        type?: unknown;
        src?: unknown;
        frameContent?: { kind?: unknown; src?: unknown } | null;
      }
    | null
    | undefined
) {
  const type = String(element?.type || "").trim().toLowerCase();
  if (type === "video") return String(element?.src || "").trim();
  if (type === "frame" && String(element?.frameContent?.kind || "").trim().toLowerCase() === "video") {
    return String(element?.frameContent?.src || "").trim();
  }
  return "";
}

function getElementVideoDurationSeconds(
  element:
    | {
        type?: unknown;
        videoDuration?: unknown;
        videoEnd?: unknown;
        frameContent?: { kind?: unknown; videoDuration?: unknown; videoEnd?: unknown } | null;
      }
    | null
    | undefined
) {
  const type = String(element?.type || "").trim().toLowerCase();
  if (type === "video") {
    const videoEnd = Number(element?.videoEnd);
    if (Number.isFinite(videoEnd) && videoEnd > 0) return videoEnd;
    const videoDuration = Number(element?.videoDuration);
    return Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0;
  }
  if (type === "frame" && String(element?.frameContent?.kind || "").trim().toLowerCase() === "video") {
    const videoEnd = Number(element?.frameContent?.videoEnd);
    if (Number.isFinite(videoEnd) && videoEnd > 0) return videoEnd;
    const videoDuration = Number(element?.frameContent?.videoDuration);
    return Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0;
  }
  return 0;
}

async function captureVideoFilmstripFrames(
  source: string,
  durationSeconds: number,
  frameCount: number
) {
  const safeSource = String(source || "").trim();
  if (!safeSource) return [];

  const video = document.createElement("video");
  video.src = safeSource;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.setAttribute("playsinline", "true");

  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

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
        const duration =
          Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : durationSeconds;
        const safeTime = Math.max(0, Math.min(time, Math.max(0, duration - 0.02)));
        video.currentTime = safeTime;
      } catch {
        resolve();
      }
    });

  const drawFrame = () => {
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.55);
    } catch {
      return "";
    }
  };

  try {
    await waitForReady();
    const resolvedDuration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : Math.max(0.25, durationSeconds);
    const frames: string[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const ratio = frameCount > 1 ? index / (frameCount - 1) : 0;
      await seekTo(ratio * resolvedDuration);
      const frame = drawFrame();
      if (frame) {
        frames.push(frame);
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    return frames;
  } finally {
    cleanup();
  }
}

export default function PagesTimeline({ showTimeline = true }: PagesTimelineProps) {
  const timelineRightInsetPx = 28;
  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const timelinePlayheadMs = useEditorStore((state) => state.timelinePlayheadMs);
  const timelineIsPlaying = useEditorStore((state) => state.timelineIsPlaying);
  const stageApi = useEditorStore((state) => state.stageApi);
  const setTimelinePlayheadMs = useEditorStore((state) => state.setTimelinePlayheadMs);
  const setTimelinePlaying = useEditorStore((state) => state.setTimelinePlaying);
  const updateElement = useEditorStore((state) => state.updateElement);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0] || null,
    [activePageId, pages]
  );
  const activePageDurationMs = useMemo(() => getPageDurationMs(activePage), [activePage]);
  const totalDurationMs = activePageDurationMs;
  const lowEndDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const cores = Number(navigator.hardwareConcurrency || 0);
    const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0);
    return (Number.isFinite(cores) && cores > 0 && cores <= 4) || (Number.isFinite(memory) && memory > 0 && memory <= 4);
  }, []);
  const timelineFps = useMemo(() => {
    const raw = Number(designTimeline.fps);
    if (!Number.isFinite(raw) || raw <= 0) return 30;
    return Math.min(60, Math.max(12, Math.round(raw)));
  }, [designTimeline.fps]);
  const scrubFrameStepMs = useMemo(() => {
    const baseStep = Math.max(8, Math.round(1000 / timelineFps));
    return lowEndDevice ? Math.max(16, baseStep * 2) : baseStep;
  }, [lowEndDevice, timelineFps]);
  const selectedElement = useMemo(() => {
    if (!activePage || selectedIds.length !== 1) return null;
    return activePage.elements.find((element) => element.id === selectedIds[0]) || null;
  }, [activePage, selectedIds]);
  const selectedWindow = useMemo(
    () => resolveTimelineWindow(selectedElement, activePageDurationMs),
    [activePageDurationMs, selectedElement]
  );
  const [canvasPreviewSrc, setCanvasPreviewSrc] = useState("");
  const [templateStageFrames, setTemplateStageFrames] = useState<string[]>([]);
  const [templateVideoFrames, setTemplateVideoFrames] = useState<string[]>([]);
  const [selectedVideoFrames, setSelectedVideoFrames] = useState<string[]>([]);
  const previewUrl = String(designTimeline.preview?.url || "").trim();
  const previewPosterUrl = String(designTimeline.preview?.posterUrl || "").trim();
  const activeBackgroundImageUri =
    activePage?.background?.type === "image" ? String(activePage.background.imageUri || "").trim() : "";
  const firstVideoSource = useMemo(() => {
    if (!activePage) return "";
    const videoElement = activePage.elements.find((element) => Boolean(getElementVideoSource(element)));
    return getElementVideoSource(videoElement);
  }, [activePage]);
  const firstVisualSource = useMemo(() => {
    if (!activePage) return "";
    const visualElement = activePage.elements.find((element) =>
      Boolean(String(element.rasterOriginalSrc || element.src || "").trim())
    );
    return String(visualElement?.rasterOriginalSrc || visualElement?.src || "").trim();
  }, [activePage]);
  const selectedVideoSource = useMemo(() => getElementVideoSource(selectedElement), [selectedElement]);
  const selectedPreviewKind = useMemo(() => {
    if (!selectedElement) return "none";
    const elementType = String(selectedElement.type || "").trim().toLowerCase();
    if (elementType === "text") return "text";
    if (elementType === "video") return "video";
    if (elementType === "frame") {
      const frameContentKind = String(selectedElement.frameContent?.kind || "").trim().toLowerCase();
      if (frameContentKind === "video") return "video";
      if (frameContentKind === "image") return "image";
    }
    if (elementType === "image") return "image";
    return "generic";
  }, [selectedElement]);
  const selectedTextPreview = useMemo(() => {
    if (selectedPreviewKind !== "text") return "";
    const rawText = String(selectedElement?.text || "").replace(/\s+/g, " ").trim();
    if (!rawText) return "Text";
    return rawText.length > 18 ? `${rawText.slice(0, 18).trim()}…` : rawText;
  }, [selectedElement?.text, selectedPreviewKind]);
  const selectedHasAnimationStrip = useMemo(() => {
    if (!selectedElement) return false;
    if (normalizeAnimationType(selectedElement.mediaAnimationType) !== "NONE") return true;
    return selectedWindow.startMs > 0 || selectedWindow.endMs < activePageDurationMs;
  }, [activePageDurationMs, selectedElement, selectedWindow.endMs, selectedWindow.startMs]);
  const selectedPreviewSrc = useMemo(() => {
    if (!selectedElement) return previewPosterUrl || activeBackgroundImageUri || firstVisualSource || canvasPreviewSrc;
    const directSource = String(selectedElement.rasterOriginalSrc || selectedElement.src || "").trim();
    if (directSource) return directSource;
    return previewPosterUrl || activeBackgroundImageUri || firstVisualSource || canvasPreviewSrc;
  }, [activeBackgroundImageUri, canvasPreviewSrc, firstVisualSource, previewPosterUrl, selectedElement]);
  const templatePreviewSrc = useMemo(
    () => canvasPreviewSrc || previewPosterUrl || activeBackgroundImageUri || firstVisualSource,
    [activeBackgroundImageUri, canvasPreviewSrc, firstVisualSource, previewPosterUrl]
  );
  const templateVideoSource = useMemo(
    () => (isLikelyVideoSource(previewUrl) ? previewUrl : firstVideoSource),
    [firstVideoSource, previewUrl]
  );

  const playheadRef = useRef(timelinePlayheadMs);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackBoundsRef = useRef<TimelineTrackBounds | null>(null);
  const pendingTrimRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const timelineScrubPlaybackRef = useRef<{ wasPlaying: boolean; resumeOnRelease: boolean } | null>(null);
  const [trimDrag, setTrimDrag] = useState<TrimDragState | null>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);

  useEffect(() => {
    playheadRef.current = timelinePlayheadMs;
  }, [timelinePlayheadMs]);

  useEffect(() => {
    if (!stageApi?.captureThumbnailDataUrl) return;

    let cancelled = false;
    let timeoutIds: number[] = [];

    const tryCapture = () => {
      if (cancelled) return;
      const captured = String(stageApi.captureThumbnailDataUrl() || "").trim();
      if (captured) {
        setCanvasPreviewSrc(captured);
      }
    };

    // Refresh a few times after edits/load so the filmstrip keeps matching the live stage.
    [40, 140, 320, 620].forEach((delay) => {
      const timeoutId = window.setTimeout(tryCapture, delay);
      timeoutIds.push(timeoutId);
    });

    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [activePage?.background?.imageUri, activePage?.elements, selectedIds, showTimeline, stageApi]);

  useEffect(() => {
    if (!templateVideoSource) return;

    let disposed = false;

    void captureVideoFilmstripFrames(
      templateVideoSource,
      Math.max(0.25, totalDurationMs / 1000),
      24
    )
      .then((frames) => {
        if (disposed) return;
        setTemplateVideoFrames(frames);
      })
      .catch(() => {
        if (disposed) return;
        setTemplateVideoFrames([]);
      });

    return () => {
      disposed = true;
    };
  }, [templateVideoSource, totalDurationMs]);

  useEffect(() => {
    if (!selectedVideoSource || selectedPreviewKind !== "video") return;

    let disposed = false;

    void captureVideoFilmstripFrames(
      selectedVideoSource,
      Math.max(0.25, (selectedWindow.endMs - selectedWindow.startMs) / 1000),
      16
    )
      .then((frames) => {
        if (disposed) return;
        setSelectedVideoFrames(frames);
      })
      .catch(() => {
        if (disposed) return;
        setSelectedVideoFrames([]);
      });

    return () => {
      disposed = true;
    };
  }, [
    selectedPreviewKind,
    selectedVideoSource,
    selectedWindow.endMs,
    selectedWindow.startMs,
    totalDurationMs,
  ]);
  const effectiveTemplateVideoFrames = templateVideoSource ? templateVideoFrames : templateStageFrames;
  const effectiveSelectedVideoFrames =
    selectedVideoSource && selectedPreviewKind === "video" ? selectedVideoFrames : [];

  useEffect(() => {
    if (!showTimeline) return;
    const node = timelineTrackRef.current;
    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      timelineTrackBoundsRef.current = {
        left: rect.left,
        width: Math.max(0, (rect.width || node.clientWidth || 0) - timelineRightInsetPx),
      };
      setTimelineViewportWidth(Math.max(0, (rect.width || node.clientWidth || 0) - timelineRightInsetPx));
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
  }, [showTimeline, timelineRightInsetPx]);

  useEffect(() => {
    if (!timelineIsPlaying || totalDurationMs <= 0) return;

    let frame = 0;
    let lastTs = performance.now();

    const tick = (ts: number) => {
      const delta = ts - lastTs;
      lastTs = ts;
      const nextPlayheadMs = Math.min(totalDurationMs, playheadRef.current + delta);
      playheadRef.current = nextPlayheadMs;
      setTimelinePlayheadMs(nextPlayheadMs);

      if (nextPlayheadMs >= totalDurationMs) {
        setTimelinePlaying(false);
        return;
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [setTimelinePlayheadMs, setTimelinePlaying, timelineIsPlaying, totalDurationMs]);

  useEffect(
    () => () => {
      timelineScrubPlaybackRef.current = null;
    },
    []
  );

  const playheadRatio = totalDurationMs > 0 ? clamp(timelinePlayheadMs / totalDurationMs, 0, 1) : 0;
  const timelineContentWidthPx = useMemo(() => {
    const durationWidth = Math.max(720, Math.ceil((totalDurationMs / 1000) * 84));
    if (timelineViewportWidth <= 0) return durationWidth;
    return Math.max(durationWidth, Math.ceil(timelineViewportWidth * 1.65));
  }, [timelineViewportWidth, totalDurationMs]);
  const timelineScrollOffsetPx = useMemo(() => {
    if (timelineViewportWidth <= 0) return 0;
    const centerInset = timelineViewportWidth / 2;
    const minOffset = Math.min(centerInset, centerInset - timelineContentWidthPx);
    const maxOffset = centerInset;
    const centeredOffset = timelineViewportWidth / 2 - playheadRatio * timelineContentWidthPx;
    return clamp(centeredOffset, minOffset, maxOffset);
  }, [playheadRatio, timelineContentWidthPx, timelineViewportWidth]);
  const playheadViewportXPx = useMemo(() => {
    if (timelineViewportWidth <= 0) return 0;
    const x = playheadRatio * timelineContentWidthPx + timelineScrollOffsetPx;
    return clamp(x, 0, timelineViewportWidth);
  }, [playheadRatio, timelineContentWidthPx, timelineScrollOffsetPx, timelineViewportWidth]);
  const playheadLabelXPx = useMemo(() => {
    if (timelineViewportWidth <= 0) return 0;
    const minX = 64;
    const maxX = Math.max(minX, timelineViewportWidth - 132);
    return clamp(playheadViewportXPx, minX, maxX);
  }, [playheadViewportXPx, timelineViewportWidth]);
  const timelineContentStyle = useMemo(
    () => ({
      width: `${timelineContentWidthPx}px`,
      transform: `translateX(${timelineScrollOffsetPx}px)`,
    }),
    [timelineContentWidthPx, timelineScrollOffsetPx]
  );
  const filmstripFrameCount = Math.max(12, Math.min(48, Math.ceil(timelineContentWidthPx / 40)));

  const measureTimelineTrackBounds = useCallback(() => {
    const node = timelineTrackRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const bounds = {
      left: rect.left,
      width: rect.width || node.clientWidth || 0,
    };
    timelineTrackBoundsRef.current = bounds;
    return bounds;
  }, []);

  const { isScrubbing: timelineIsScrubbing, activePointerId, startScrubbing, updateScrubbing, endScrubbing } =
    useTimelineScrubber({
      totalDurationMs,
      contentWidthPx: timelineContentWidthPx,
      deadZonePx: SCRUB_DEAD_ZONE_PX,
      snapMs: scrubFrameStepMs,
      invertDirection: true,
      getBounds: () => timelineTrackBoundsRef.current || measureTimelineTrackBounds(),
      getCurrentTime: () => playheadRef.current,
      onCommit: (time) => {
        playheadRef.current = time;
        setTimelinePlayheadMs(time);
      },
      onStart: () => {
        setTimelinePlaying(false);
      },
      onEnd: () => {
        const shouldResumePlayback =
          timelineScrubPlaybackRef.current?.resumeOnRelease === true &&
          timelineScrubPlaybackRef.current?.wasPlaying === true;
        timelineScrubPlaybackRef.current = null;
        setTimelinePlaying(shouldResumePlayback);
      },
    });

  const beginTimelineScrub = useCallback(
    (clientX: number, pointerId: number | null, resumeOnRelease = false) => {
      if (totalDurationMs <= 0) return;
      timelineScrubPlaybackRef.current = {
        wasPlaying: timelineIsPlaying,
        resumeOnRelease,
      };
      measureTimelineTrackBounds();
      startScrubbing(clientX, pointerId);
    },
    [measureTimelineTrackBounds, startScrubbing, timelineIsPlaying, totalDurationMs]
  );

  useEffect(() => {
    if (!showTimeline || !stageApi?.captureTimelineStripDataUrls || totalDurationMs <= 0) return;
    if (templateVideoSource) return;
    if (timelineIsPlaying || timelineIsScrubbing) return;

    let disposed = false;
    const timeouts: number[] = [];

    const captureStrip = () => {
      const sampleCount = Math.max(10, Math.min(24, filmstripFrameCount));
      const playheads = Array.from({ length: sampleCount }, (_, index) => {
        if (sampleCount <= 1) return 0;
        return (index / (sampleCount - 1)) * totalDurationMs;
      });

      void stageApi
        .captureTimelineStripDataUrls(playheads)
        .then((frames) => {
          if (disposed) return;
          setTemplateStageFrames(frames);
        })
        .catch(() => {
          if (disposed) return;
          setTemplateStageFrames([]);
        });
    };

    [80, 260].forEach((delay) => {
      timeouts.push(window.setTimeout(captureStrip, delay));
    });

    return () => {
      disposed = true;
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [
    activePage?.background?.imageUri,
    activePage?.elements,
    filmstripFrameCount,
    selectedIds,
    showTimeline,
    stageApi,
    templateVideoSource,
    timelineIsPlaying,
    timelineIsScrubbing,
    totalDurationMs,
  ]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !previewUrl) return;
    video.muted = true;
    video.volume = 0;

    const targetTimeSeconds = Math.max(0, timelinePlayheadMs / 1000);
    const boundedTarget = Number.isFinite(video.duration)
      ? Math.min(video.duration, targetTimeSeconds)
      : targetTimeSeconds;
    const seekDeltaThreshold = Math.max(0.012, scrubFrameStepMs / 1000 / 2);

    if (timelineIsScrubbing) {
      video.pause();
      if (Math.abs(video.currentTime - boundedTarget) > seekDeltaThreshold) {
        try {
          if (typeof video.fastSeek === "function") {
            video.fastSeek(boundedTarget);
          } else {
            video.currentTime = boundedTarget;
          }
        } catch {
          // Ignore sync errors while metadata is still loading.
        }
      }
      return;
    }

    if (Math.abs(video.currentTime - boundedTarget) > 0.08) {
      try {
        video.currentTime = boundedTarget;
      } catch {
        // Ignore sync errors while metadata is still loading.
      }
    }

    if (timelineIsPlaying && !timelineIsScrubbing) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [previewUrl, scrubFrameStepMs, timelineIsPlaying, timelineIsScrubbing, timelinePlayheadMs]);

  useEffect(() => {
    if (!timelineIsScrubbing) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
      updateScrubbing(event.clientX);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      endScrubbing();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [activePointerId, endScrubbing, timelineIsScrubbing, updateScrubbing]);

  const handleTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement)?.closest("[data-trim-handle], [data-trim-bar]")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginTimelineScrub(event.clientX, event.pointerId, false);
    },
    [beginTimelineScrub]
  );

  const startTrimDrag = useCallback(
    (mode: TrimDragMode, event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectedElement) return;
      event.preventDefault();
      event.stopPropagation();
      setTimelinePlaying(false);
      setTrimDrag({
        mode,
        initialClientX: event.clientX,
        startMs: selectedWindow.startMs,
        endMs: selectedWindow.endMs,
      });
      pendingTrimRef.current = {
        startMs: selectedWindow.startMs,
        endMs: selectedWindow.endMs,
      };
    },
    [selectedElement, selectedWindow.endMs, selectedWindow.startMs, setTimelinePlaying]
  );

  useEffect(() => {
    if (!trimDrag || !selectedElement || !trimTrackRef.current) return;

    const handleMove = (event: MouseEvent) => {
      const rect = trimTrackRef.current?.getBoundingClientRect();
      if (!rect || timelineContentWidthPx <= 0 || totalDurationMs <= 0) return;

      const pixelsPerMs = timelineContentWidthPx / totalDurationMs;
      let nextStartMs = trimDrag.startMs;
      let nextEndMs = trimDrag.endMs;

      if (trimDrag.mode === "move") {
        const deltaMs = Math.round((event.clientX - trimDrag.initialClientX) / pixelsPerMs);
        const durationMs = trimDrag.endMs - trimDrag.startMs;
        nextStartMs = clamp(trimDrag.startMs + deltaMs, 0, Math.max(0, activePageDurationMs - durationMs));
        nextEndMs = nextStartMs + durationMs;
      } else {
        const absolutePx = clamp(
          event.clientX - rect.left - timelineScrollOffsetPx,
          0,
          timelineContentWidthPx
        );
        const absoluteMs = (absolutePx / timelineContentWidthPx) * totalDurationMs;
        const relativeMs = clamp(absoluteMs, 0, activePageDurationMs);

        if (trimDrag.mode === "start") {
          nextStartMs = Math.min(relativeMs, trimDrag.endMs - MIN_LAYER_DURATION_MS);
        } else {
          nextEndMs = Math.max(trimDrag.startMs + MIN_LAYER_DURATION_MS, relativeMs);
        }
      }

      const window = clampTimelineWindow(nextStartMs, nextEndMs, activePageDurationMs);
      pendingTrimRef.current = window;
      updateElement(
        selectedElement.id,
        {
          timelineStartMs: window.startMs,
          timelineEndMs: window.endMs,
        },
        { recordHistory: false }
      );
    };

    const handleUp = () => {
      const pending = pendingTrimRef.current;
      if (pending) {
        updateElement(
          selectedElement.id,
          {
            timelineStartMs: pending.startMs,
            timelineEndMs: pending.endMs,
          },
          { recordHistory: true }
        );
      }
      pendingTrimRef.current = null;
      setTrimDrag(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [
    activePageDurationMs,
    selectedElement,
    timelineContentWidthPx,
    timelineScrollOffsetPx,
    totalDurationMs,
    trimDrag,
    updateElement,
  ]);

  const secondMarkers = useMemo(() => {
    const seconds = Math.max(1, Math.ceil(totalDurationMs / 1000));
    return Array.from({ length: seconds + 1 }, (_, index) => ({
      second: index,
      ratio: seconds === 0 ? 0 : Math.min(1, (index * 1000) / Math.max(totalDurationMs, 1)),
    }));
  }, [totalDurationMs]);
  const visibleSecondLabels = useMemo(() => {
    const totalSeconds = Math.max(1, Math.ceil(totalDurationMs / 1000));
    return secondMarkers.filter(
      (marker) =>
        marker.second > 0 &&
        marker.second < totalSeconds &&
        marker.ratio > 0.02 &&
        marker.ratio < 0.96
    );
  }, [secondMarkers, totalDurationMs]);
  const selectedBarStyle = useMemo(() => {
    if (!selectedElement || totalDurationMs <= 0 || timelineContentWidthPx <= 0) return null;
    const startRatio = selectedWindow.startMs / totalDurationMs;
    const widthRatio = (selectedWindow.endMs - selectedWindow.startMs) / totalDurationMs;
    const trimContentWidthPx = Math.max(widthRatio * timelineContentWidthPx, 92);
    return {
      left: `${startRatio * timelineContentWidthPx - TRIM_HANDLE_WIDTH_PX}px`,
      width: `${trimContentWidthPx + TRIM_HANDLE_WIDTH_PX * 2}px`,
      minWidth: `${92 + TRIM_HANDLE_WIDTH_PX * 2}px`,
    };
  }, [
    selectedElement,
    selectedWindow.endMs,
    selectedWindow.startMs,
    timelineContentWidthPx,
    totalDurationMs,
  ]);
  const handlePlayButtonClick = useCallback(() => {
    if (timelineIsPlaying) {
      setTimelinePlaying(false);
      return;
    }
    if (totalDurationMs > 0 && timelinePlayheadMs >= totalDurationMs) {
      setTimelinePlayheadMs(0);
    }
    setTimelinePlaying(true);
  }, [setTimelinePlayheadMs, setTimelinePlaying, timelineIsPlaying, timelinePlayheadMs, totalDurationMs]);

  if (!showTimeline) {
    return null;
  }

  return (
    <div className="border-t border-[#cbd1da] bg-[#eef1f5] px-3 py-3">
      <div className="rounded-[24px] border border-[#cad1db] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 pb-4 pt-2 shadow-sm">
          <div className="grid grid-cols-[28px,1fr] gap-x-3">
            <div className="pt-4">
              <button
                type="button"
                onClick={handlePlayButtonClick}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-black transition hover:bg-black/5"
                aria-label={timelineIsPlaying ? "Pause timeline" : "Play timeline"}
              >
                {timelineIsPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-[1px]" />}
              </button>
            </div>

            <div
              ref={timelineTrackRef}
              className="relative touch-none select-none px-2 pt-1"
              onPointerDown={handleTrackPointerDown}
            >
              <div
                className="pointer-events-none absolute top-11 z-30 w-[3px] rounded-full bg-black/90"
                style={{ left: `${playheadViewportXPx}px`, bottom: "0px" }}
              />
              <div
                className="pointer-events-none absolute left-0 top-0 z-30 -translate-x-1/2 whitespace-nowrap text-[13px] font-bold tabular-nums text-[#111827]"
                style={{ left: `${playheadLabelXPx}px` }}
              >
                {formatTimelineTime(timelinePlayheadMs, true)}
              </div>
              <div className="pointer-events-none absolute right-0 top-0 flex flex-col items-end justify-start pr-1 text-right leading-none">
                <span className="text-[11px] font-semibold text-[#9aa3ad]">
                  Total
                </span>
                <span className="mt-1 text-[12px] font-semibold tabular-nums text-[#6b7280]">
                  {formatTimelineTime(totalDurationMs)}
                </span>
              </div>

              <div className="pointer-events-none relative h-11 overflow-hidden">
                <div className="absolute left-0 top-0 h-full" style={timelineContentStyle}>
                  {secondMarkers.map((marker) => (
                    <div
                      key={`minor-${marker.second}`}
                      className="absolute top-[31px] h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#8e96a3]"
                      style={{ left: `${marker.ratio * 100}%` }}
                    />
                  ))}
                  {visibleSecondLabels.map((marker) => (
                    <div
                      key={`label-${marker.second}`}
                      className="absolute top-[12px] -translate-x-1/2 text-[11px] font-semibold tabular-nums text-[#8a9099]"
                      style={{ left: `${marker.ratio * 100}%` }}
                    >
                      {formatTimelineTime(marker.second * 1000)}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {selectedElement && selectedBarStyle ? (
                  <div ref={trimTrackRef} className="relative h-14 overflow-hidden">
                    <div className="absolute left-0 top-0 h-full" style={timelineContentStyle}>
                      <div
                        data-trim-bar
                        className="absolute top-0 z-20 h-14 rounded-[18px] bg-[#ff5b78] px-8 shadow-[0_10px_22px_rgba(255,91,120,0.32)]"
                        style={selectedBarStyle}
                        onMouseDown={(event) => startTrimDrag("move", event)}
                      >
                        <div className="absolute inset-y-1.5 left-8 right-8 overflow-hidden rounded-[12px]">
                          {selectedPreviewKind === "text" ? (
                            <div className="flex h-full items-center justify-center rounded-[12px] bg-[linear-gradient(180deg,#fffefe_0%,#f8f9fb_100%)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                              <div className="inline-flex max-w-[78%] items-center justify-center rounded-[10px] border border-[#eceff3] bg-white px-4 py-1.5 shadow-[0_8px_16px_rgba(15,23,42,0.08)]">
                                <span
                                  className="block truncate whitespace-nowrap text-center text-[15px] font-semibold leading-none"
                                  style={{
                                    color: String(selectedElement?.color || selectedElement?.fill || "#111827"),
                                  }}
                                >
                                  {selectedTextPreview}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="px-1">
                              <FilmstripFrames
                                count={Math.max(8, Math.ceil(((selectedWindow.endMs - selectedWindow.startMs) / totalDurationMs) * filmstripFrameCount))}
                                images={effectiveSelectedVideoFrames.length > 0 ? effectiveSelectedVideoFrames : undefined}
                                imageSrc={
                                  effectiveSelectedVideoFrames.length === 0 &&
                                  (selectedPreviewKind === "image" || selectedPreviewKind === "generic")
                                    ? selectedPreviewSrc || undefined
                                    : undefined
                                }
                                tone="selected"
                              />
                            </div>
                          )}
                        </div>
                        <div
                          data-trim-handle
                          className="absolute inset-y-0 left-0 flex w-8 cursor-ew-resize items-center justify-center rounded-l-[18px] bg-[#ff5b78] text-white"
                          onMouseDown={(event) => startTrimDrag("start", event)}
                        >
                          <ChevronLeft size={18} />
                        </div>
                        <div
                          data-trim-handle
                          className="absolute inset-y-0 right-0 flex w-8 cursor-ew-resize items-center justify-center rounded-r-[18px] bg-[#ff5b78] text-white"
                          onMouseDown={(event) => startTrimDrag("end", event)}
                        >
                          <ChevronRight size={18} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="relative h-14 overflow-hidden rounded-[16px] border border-[#d0d6df] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                  {previewUrl ? (
                    <video
                      ref={previewVideoRef}
                      className="absolute h-0 w-0 opacity-0"
                      src={previewUrl}
                      poster={previewPosterUrl || undefined}
                      muted
                      loop={false}
                      playsInline
                      preload="metadata"
                    />
                  ) : null}
                  <div className="absolute left-0 top-0 h-full" style={timelineContentStyle}>
                    <FilmstripFrames
                      count={filmstripFrameCount}
                      images={effectiveTemplateVideoFrames.length > 0 ? effectiveTemplateVideoFrames : undefined}
                      imageSrc={effectiveTemplateVideoFrames.length === 0 ? templatePreviewSrc || undefined : undefined}
                      tone="preview"
                    />
                    <FilmstripOverlay count={filmstripFrameCount} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
