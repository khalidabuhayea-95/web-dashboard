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

import {
  MIN_LAYER_DURATION_MS,
  clampTimelineWindow,
  formatTimelineTime,
  getPageDurationMs,
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

interface ScrubSessionState {
  wasPlaying: boolean;
  pointerId: number | null;
}

interface PagesTimelineProps {
  showTimeline?: boolean;
}

type FilmstripTone = "selected" | "preview";

function FilmstripFrames({
  count,
  imageSrc,
  tone,
}: {
  count: number;
  imageSrc?: string;
  tone: FilmstripTone;
}) {
  const frameCount = Math.max(8, count);
  const frameClassName =
    tone === "selected"
      ? "relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-[#6d4e12]/55 bg-[#f6c15f] shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]"
      : "relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-black/25 bg-[#d6d7db] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]";
  const overlayClassName =
    tone === "selected"
      ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(102,63,7,0.14))]"
      : "bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(15,23,42,0.16))]";

  return (
    <div className="flex h-full items-stretch gap-[2px] px-1 py-1">
      {Array.from({ length: frameCount }, (_, index) => (
        <div key={`${tone}-frame-${index}`} className={frameClassName}>
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt=""
              className={`h-full w-full object-cover ${tone === "preview" ? "grayscale" : ""}`}
            />
          ) : (
            <div
              className={`h-full w-full ${
                tone === "selected"
                  ? "bg-[linear-gradient(180deg,#f3d79d_0%,#b48229_100%)]"
                  : "bg-[linear-gradient(180deg,#f8fafc_0%,#9ca3af_100%)]"
              }`}
            />
          )}
          <div className={`absolute inset-0 ${overlayClassName}`} />
          <div className="absolute inset-y-0 left-[28%] w-px bg-black/30" />
          <div className="absolute inset-y-0 right-[28%] w-px bg-black/22" />
        </div>
      ))}
    </div>
  );
}

function FilmstripOverlay({ count }: { count: number }) {
  const frameCount = Math.max(8, count);

  return (
    <div className="pointer-events-none absolute inset-0 flex gap-[2px] px-1 py-1">
      {Array.from({ length: frameCount }, (_, index) => (
        <div
          key={`overlay-frame-${index}`}
          className="relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-black/28 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
        >
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(15,23,42,0.08))]" />
          <div className="absolute inset-y-0 left-[28%] w-px bg-black/30" />
          <div className="absolute inset-y-0 right-[28%] w-px bg-black/24" />
        </div>
      ))}
    </div>
  );
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
  const previewUrl = String(designTimeline.preview?.url || "").trim();
  const previewPosterUrl = String(designTimeline.preview?.posterUrl || "").trim();
  const activeBackgroundImageUri =
    activePage?.background?.type === "image" ? String(activePage.background.imageUri || "").trim() : "";
  const firstVisualSource = useMemo(() => {
    if (!activePage) return "";
    const visualElement = activePage.elements.find((element) =>
      Boolean(String(element.rasterOriginalSrc || element.src || "").trim())
    );
    return String(visualElement?.rasterOriginalSrc || visualElement?.src || "").trim();
  }, [activePage]);
  const selectedPreviewSrc = useMemo(() => {
    if (!selectedElement) return previewPosterUrl || activeBackgroundImageUri || firstVisualSource || canvasPreviewSrc;
    const directSource = String(selectedElement.rasterOriginalSrc || selectedElement.src || "").trim();
    if (directSource) return directSource;
    return previewPosterUrl || activeBackgroundImageUri || firstVisualSource || canvasPreviewSrc;
  }, [activeBackgroundImageUri, canvasPreviewSrc, firstVisualSource, previewPosterUrl, selectedElement]);
  const templatePreviewSrc = useMemo(
    () => previewPosterUrl || activeBackgroundImageUri || firstVisualSource || canvasPreviewSrc,
    [activeBackgroundImageUri, canvasPreviewSrc, firstVisualSource, previewPosterUrl]
  );

  const playheadRef = useRef(timelinePlayheadMs);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackBoundsRef = useRef<TimelineTrackBounds | null>(null);
  const pendingTrimRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const scrubSessionRef = useRef<ScrubSessionState | null>(null);
  const isScrubbingRef = useRef(false);
  const pendingScrubClientXRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const lastScrubTargetMsRef = useRef<number | null>(null);
  const [trimDrag, setTrimDrag] = useState<TrimDragState | null>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [timelineIsScrubbing, setTimelineIsScrubbing] = useState(false);

  useEffect(() => {
    playheadRef.current = timelinePlayheadMs;
  }, [timelinePlayheadMs]);

  useEffect(() => {
    if (templatePreviewSrc) {
      return;
    }
    if (!stageApi?.captureThumbnailDataUrl) return;

    let cancelled = false;
    let attemptCount = 0;
    let timeoutId: number | null = null;

    const tryCapture = () => {
      if (cancelled) return;
      const captured = String(stageApi.captureThumbnailDataUrl() || "").trim();
      if (captured) {
        setCanvasPreviewSrc(captured);
        return;
      }
      attemptCount += 1;
      if (attemptCount >= 12) return;
      timeoutId = window.setTimeout(tryCapture, attemptCount < 4 ? 120 : 220);
    };

    timeoutId = window.setTimeout(tryCapture, 120);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activePage?.background?.imageUri, activePage?.elements, stageApi, templatePreviewSrc]);

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
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingScrubClientXRef.current = null;
      lastScrubTargetMsRef.current = null;
    },
    []
  );

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

  const playheadRatio = totalDurationMs > 0 ? clamp(timelinePlayheadMs / totalDurationMs, 0, 1) : 0;
  const timelineContentWidthPx = useMemo(() => {
    const durationWidth = Math.max(720, Math.ceil((totalDurationMs / 1000) * 84));
    if (timelineViewportWidth <= 0) return durationWidth;
    return Math.max(durationWidth, Math.ceil(timelineViewportWidth * 1.65));
  }, [timelineViewportWidth, totalDurationMs]);
  const timelineScrollOffsetPx = useMemo(() => {
    if (timelineViewportWidth <= 0) return 0;
    const minOffset = Math.min(0, timelineViewportWidth - timelineContentWidthPx);
    const centeredOffset = timelineViewportWidth / 2 - playheadRatio * timelineContentWidthPx;
    return clamp(centeredOffset, minOffset, 0);
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

  const getScrubTimeFromPointer = useCallback(
    (clientX: number) => {
      const bounds = timelineTrackBoundsRef.current || measureTimelineTrackBounds();
      if (!bounds || bounds.width <= 0 || timelineContentWidthPx <= 0 || totalDurationMs <= 0) {
        return null;
      }
      const progress = getProgressFromPointerPosition(clientX, bounds.left, bounds.width);
      const viewportX = progress * bounds.width;
      const contentX = clamp(viewportX - timelineScrollOffsetPx, 0, timelineContentWidthPx);
      const contentProgress = clampProgress(contentX / timelineContentWidthPx);
      const rawMs = getTimeFromProgress(contentProgress, totalDurationMs);
      const snappedMs = Math.round(rawMs / scrubFrameStepMs) * scrubFrameStepMs;
      return Math.max(0, Math.min(totalDurationMs, snappedMs));
    },
    [measureTimelineTrackBounds, scrubFrameStepMs, timelineContentWidthPx, timelineScrollOffsetPx, totalDurationMs]
  );

  const commitScrubTime = useCallback(
    (targetMs: number | null) => {
      if (!Number.isFinite(targetMs as number)) return;
      const safeTargetMs = Math.max(0, Math.min(totalDurationMs, Math.round(targetMs as number)));
      if (lastScrubTargetMsRef.current === safeTargetMs) return;
      lastScrubTargetMsRef.current = safeTargetMs;
      playheadRef.current = safeTargetMs;
      setTimelinePlayheadMs(safeTargetMs);
    },
    [setTimelinePlayheadMs, totalDurationMs]
  );

  const flushPendingScrub = useCallback(() => {
    const pendingClientX = pendingScrubClientXRef.current;
    pendingScrubClientXRef.current = null;
    if (pendingClientX === null) return;
    commitScrubTime(getScrubTimeFromPointer(pendingClientX));
  }, [commitScrubTime, getScrubTimeFromPointer]);

  const requestScrubUpdate = useCallback(
    (clientX: number) => {
      pendingScrubClientXRef.current = clientX;
      if (scrubRafRef.current !== null) return;
      // Batch pointer move work to one timeline update per frame to keep scrubbing smooth.
      scrubRafRef.current = window.requestAnimationFrame(() => {
        scrubRafRef.current = null;
        flushPendingScrub();
      });
    },
    [flushPendingScrub]
  );

  const startScrubbing = useCallback(
    (clientX: number, pointerId: number | null) => {
      if (totalDurationMs <= 0) return;
      scrubSessionRef.current = {
        wasPlaying: timelineIsPlaying,
        pointerId,
      };
      isScrubbingRef.current = true;
      setTimelineIsScrubbing(true);
      setTimelinePlaying(false);
      measureTimelineTrackBounds();
      requestScrubUpdate(clientX);
    },
    [measureTimelineTrackBounds, requestScrubUpdate, setTimelinePlaying, timelineIsPlaying, totalDurationMs]
  );

  const updateScrubbing = useCallback(
    (clientX: number) => {
      if (!isScrubbingRef.current) return;
      requestScrubUpdate(clientX);
    },
    [requestScrubUpdate]
  );

  const endScrubbing = useCallback(() => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    setTimelineIsScrubbing(false);
    if (scrubRafRef.current !== null) {
      window.cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    flushPendingScrub();
    const shouldResumePlayback = scrubSessionRef.current?.wasPlaying === true;
    scrubSessionRef.current = null;
    lastScrubTargetMsRef.current = null;
    setTimelinePlaying(shouldResumePlayback);
  }, [flushPendingScrub, setTimelinePlaying]);

  useEffect(() => {
    if (!timelineIsScrubbing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const activePointerId = scrubSessionRef.current?.pointerId;
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
      updateScrubbing(event.clientX);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const activePointerId = scrubSessionRef.current?.pointerId;
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
  }, [endScrubbing, timelineIsScrubbing, updateScrubbing]);

  const handleTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement)?.closest("[data-trim-handle], [data-trim-bar]")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startScrubbing(event.clientX, event.pointerId);
    },
    [startScrubbing]
  );

  const startTrimDrag = useCallback(
    (mode: TrimDragMode, event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectedElement) return;
      event.preventDefault();
      event.stopPropagation();
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
    [selectedElement, selectedWindow.endMs, selectedWindow.startMs]
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
  const filmstripFrameCount = useMemo(
    () => Math.max(12, Math.min(48, Math.ceil(timelineContentWidthPx / 40))),
    [timelineContentWidthPx]
  );

  const selectedBarStyle = useMemo(() => {
    if (!selectedElement || totalDurationMs <= 0 || timelineContentWidthPx <= 0) return null;
    const startRatio = selectedWindow.startMs / totalDurationMs;
    const widthRatio = (selectedWindow.endMs - selectedWindow.startMs) / totalDurationMs;
    return {
      left: `${startRatio * timelineContentWidthPx}px`,
      width: `${Math.max(widthRatio * timelineContentWidthPx, 92)}px`,
      minWidth: "92px",
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
                <div ref={trimTrackRef} className="relative h-14 overflow-hidden">
                  {selectedElement && selectedBarStyle ? (
                    <div className="absolute left-0 top-0 h-full" style={timelineContentStyle}>
                      <div
                        data-trim-bar
                        className="absolute top-0 z-20 h-14 rounded-[18px] bg-[#ff5b78] px-7 shadow-[0_10px_22px_rgba(255,91,120,0.32)]"
                        style={selectedBarStyle}
                        onMouseDown={(event) => startTrimDrag("move", event)}
                      >
                        <div className="absolute inset-y-1.5 left-7 right-7 overflow-hidden rounded-[12px]">
                          <FilmstripFrames
                            count={Math.max(8, Math.ceil(((selectedWindow.endMs - selectedWindow.startMs) / totalDurationMs) * filmstripFrameCount))}
                            imageSrc={selectedPreviewSrc || undefined}
                            tone="selected"
                          />
                        </div>
                        <div
                          data-trim-handle
                          className="absolute inset-y-0 left-0 flex w-7 cursor-ew-resize items-center justify-center text-white"
                          onMouseDown={(event) => startTrimDrag("start", event)}
                        >
                          <ChevronLeft size={18} />
                        </div>
                        <div
                          data-trim-handle
                          className="absolute inset-y-0 right-0 flex w-7 cursor-ew-resize items-center justify-center text-white"
                          onMouseDown={(event) => startTrimDrag("end", event)}
                        >
                          <ChevronRight size={18} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-14 items-center justify-center rounded-[18px] border border-dashed border-[#d7dde7] bg-white/80 text-[13px] text-[#8b94a3]">
                      Select one layer to trim when it appears in the animation.
                    </div>
                  )}
                </div>

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
                      imageSrc={templatePreviewSrc || undefined}
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
