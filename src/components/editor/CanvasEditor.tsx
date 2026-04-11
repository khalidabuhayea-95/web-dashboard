"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import useImage from "use-image";
import { Copy, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Shape,
  Stage,
  Star,
  Text,
  Transformer,
} from "react-konva";

import {
  createElementFromAsset,
  useEditorStore,
  type EditorElement,
  type ShapeType,
} from "@/store/editorStore";
import {
  DEFAULT_FRAME_CONTENT_TRANSFORM,
  pointIntersectsFrameBounds,
  resolveFrameContentLayout,
  resolveFramePreset,
  type FrameContent,
  type FramePreset,
} from "@/lib/editor/frames";
import {
  normalizeRasterColorMap,
  recolorRasterSourceToDataUrl,
  serializeRasterColorMap,
} from "@/lib/editor/imagePalette";
import { rasterizeSvgDataUrlToPngDataUrl } from "@/lib/editor/imageCrop";
import { dataUrlToFile, uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { resolveCssFontFamily } from "@/lib/templates/fontCatalog";
import {
  getAnimationPreset,
  getPageDurationMs,
  getTimelinePageEntries,
  isElementVisibleAtPlayhead,
  normalizeAnimationDelayMs,
  normalizeAnimationDirection,
  normalizeAnimationDurationMs,
  normalizeAnimationEasing,
  normalizeAnimationInfinite,
  normalizeAnimationIntensity,
  normalizeAnimationMode,
  normalizeAnimationType,
  resolveTimelineWindow,
  type EditorAnimationDirection,
  type EditorAnimationEasing,
  type EditorAnimationPreset,
} from "@/lib/editor/animationTimeline";

interface ElementRenderPose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

interface ImageNodeProps {
  element: EditorElement;
  pose: ElementRenderPose;
  canTransform: boolean;
  playheadMs?: number;
  pageDurationMs?: number;
  forceTimelineSync?: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (event: Konva.KonvaEventObject<Event>) => void;
  registerRef: (id: string, node: Konva.Node | null) => void;
  onImageMetadata?: (meta: { width: number; height: number }) => void;
  onVideoMetadata?: (meta: { duration: number }) => void;
}

function isGifSource(src: unknown) {
  const value = String(src || "").trim().toLowerCase();
  if (!value) return false;
  if (value.startsWith("data:image/gif")) return true;
  try {
    const parsed = new URL(value);
    return /\.gif$/i.test(parsed.pathname || "");
  } catch {
    return /\.gif(?:$|[?#])/i.test(value);
  }
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function resolveLoopingVideoTargetTime({
  playheadMs,
  layerStartMs,
  sourceStart,
  sourceEnd,
}: {
  playheadMs: number;
  layerStartMs: number;
  sourceStart: number;
  sourceEnd: number;
}) {
  const sourceSpan = Math.max(0.01, sourceEnd - sourceStart);
  const localSeconds = Math.max(0, (playheadMs - layerStartMs) / 1000);
  const loopSeconds = localSeconds % sourceSpan;
  return clamp(sourceStart + loopSeconds, sourceStart, Math.max(sourceStart, sourceEnd - 0.01));
}

function getPreviewRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const preferred = [
    "video/mp4;codecs=h264,aac",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return preferred.find((value) => MediaRecorder.isTypeSupported?.(value)) || "";
}

function resolveKonvaImageCrop(
  element: EditorElement,
  sourceImage: HTMLImageElement | null | undefined
) {
  const sourceWidth = Math.max(
    1,
    Number(element.sourceWidth) || Number(sourceImage?.naturalWidth) || Number(element.width) || 1
  );
  const sourceHeight = Math.max(
    1,
    Number(element.sourceHeight) || Number(sourceImage?.naturalHeight) || Number(element.height) || 1
  );
  const cropX = clamp(Number(element.cropX) || 0, 0, sourceWidth - 1);
  const cropY = clamp(Number(element.cropY) || 0, 0, sourceHeight - 1);
  const cropWidth = clamp(Number(element.cropWidth) || sourceWidth, 1, sourceWidth - cropX);
  const cropHeight = clamp(Number(element.cropHeight) || sourceHeight, 1, sourceHeight - cropY);

  const hasCustomCrop =
    Math.abs(cropX) > 0.0001 ||
    Math.abs(cropY) > 0.0001 ||
    Math.abs(cropWidth - sourceWidth) > 0.0001 ||
    Math.abs(cropHeight - sourceHeight) > 0.0001;

  return hasCustomCrop
    ? {
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
      }
    : undefined;
}

function resolveBackgroundCoverLayout(
  sourceImage: HTMLImageElement | null | undefined,
  targetWidth: number,
  targetHeight: number
) {
  const sourceWidth = Number(sourceImage?.naturalWidth || sourceImage?.width || 0);
  const sourceHeight = Number(sourceImage?.naturalHeight || sourceImage?.height || 0);
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) return null;

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function CanvasBackgroundImage({
  src,
  pageWidth,
  pageHeight,
}: {
  src: string;
  pageWidth: number;
  pageHeight: number;
}) {
  const [image] = useImage(src, "anonymous");
  const layout = useMemo(
    () => resolveBackgroundCoverLayout(image, pageWidth, pageHeight),
    [image, pageHeight, pageWidth]
  );

  if (!image || !layout) return null;

  return (
    <KonvaImage
      image={image}
      x={layout.x}
      y={layout.y}
      width={layout.width}
      height={layout.height}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

function CanvasImageNode({
  element,
  pose,
  canTransform,
  onSelect,
  onContextMenu,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  registerRef,
  onImageMetadata,
}: ImageNodeProps) {
  const baseRasterSource = useMemo(() => {
    const source = String(element.rasterOriginalSrc || element.src || "").trim();
    return source || "";
  }, [element.rasterOriginalSrc, element.src]);
  const normalizedRasterColorMap = useMemo(
    () => normalizeRasterColorMap(element.rasterColorMap),
    [element.rasterColorMap]
  );
  const normalizedRasterPalette = useMemo(
    () =>
      Array.isArray(element.rasterPalette)
        ? element.rasterPalette.map((value) => String(value || "").trim()).filter(Boolean)
        : [],
    [element.rasterPalette]
  );
  const rasterColorMapKey = useMemo(
    () => serializeRasterColorMap(normalizedRasterColorMap),
    [normalizedRasterColorMap]
  );
  const shouldRecolorRaster = Boolean(baseRasterSource && rasterColorMapKey !== "{}");
  const recolorRequestKey = useMemo(
    () => `${baseRasterSource}::${rasterColorMapKey}::${normalizedRasterPalette.join(",")}`,
    [
      baseRasterSource,
      normalizedRasterPalette,
      rasterColorMapKey,
    ]
  );
  const [recoloredEntry, setRecoloredEntry] = useState<{ key: string; src: string }>({
    key: "",
    src: "",
  });
  const resolvedSource = useMemo(() => {
    if (shouldRecolorRaster) {
      if (recoloredEntry.key === recolorRequestKey && recoloredEntry.src) {
        return recoloredEntry.src;
      }
      return baseRasterSource || String(element.src || "");
    }
    return String(element.src || "");
  }, [
    baseRasterSource,
    element.src,
    recolorRequestKey,
    recoloredEntry,
    shouldRecolorRaster,
  ]);
  const [image] = useImage(resolvedSource, "anonymous");
  const imageRef = useRef<Konva.Image | null>(null);
  const onImageMetadataRef = useRef(onImageMetadata);
  const isGif = useMemo(() => isGifSource(resolvedSource), [resolvedSource]);

  useEffect(() => {
    if (!shouldRecolorRaster) return;
    let cancelled = false;
    const requestKey = recolorRequestKey;
    void recolorRasterSourceToDataUrl(
      baseRasterSource,
      normalizedRasterPalette,
      normalizedRasterColorMap
    )
      .then((nextSource) => {
        if (cancelled) return;
        setRecoloredEntry({
          key: requestKey,
          src: String(nextSource || baseRasterSource || ""),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRecoloredEntry({
          key: requestKey,
          src: String(baseRasterSource || ""),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    baseRasterSource,
    normalizedRasterColorMap,
    normalizedRasterPalette,
    recolorRequestKey,
    shouldRecolorRaster,
  ]);

  useEffect(() => {
    onImageMetadataRef.current = onImageMetadata;
  }, [onImageMetadata]);

  useEffect(() => {
    const naturalWidth = Number(image?.naturalWidth || 0);
    const naturalHeight = Number(image?.naturalHeight || 0);
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    onImageMetadataRef.current?.({ width: naturalWidth, height: naturalHeight });
  }, [image]);

  useEffect(() => {
    if (!isGif || !image) return;
    let frame = 0;
    const redraw = () => {
      imageRef.current?.getLayer()?.batchDraw();
      frame = window.requestAnimationFrame(redraw);
    };
    frame = window.requestAnimationFrame(redraw);
    return () => window.cancelAnimationFrame(frame);
  }, [isGif, image]);

  const crop = useMemo(() => resolveKonvaImageCrop(element, image || undefined), [element, image]);

  return (
    <KonvaImage
      ref={(node) => {
        imageRef.current = node;
        registerRef(element.id, node);
      }}
      id={element.id}
      image={image || undefined}
      x={pose.x}
      y={pose.y}
      width={element.width}
      height={element.height}
      rotation={pose.rotation}
      scaleX={pose.scaleX}
      scaleY={pose.scaleY}
      opacity={pose.opacity}
      visible={element.visible}
      draggable={canTransform}
      listening={canTransform}
      globalCompositeOperation={element.blendMode}
      cornerRadius={element.cornerRadius || 0}
      shadowColor={element.shadowColor}
      shadowBlur={element.shadowBlur}
      shadowOffsetX={element.shadowOffsetX}
      shadowOffsetY={element.shadowOffsetY}
      crop={crop}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={onContextMenu}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

function CanvasVideoNode({
  element,
  pose,
  canTransform,
  playheadMs = 0,
  pageDurationMs = 0,
  forceTimelineSync = false,
  onSelect,
  onContextMenu,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  registerRef,
  onVideoMetadata,
}: ImageNodeProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRef = useRef<Konva.Shape | null>(null);
  const onMetadataRef = useRef(onVideoMetadata);

  useEffect(() => {
    onMetadataRef.current = onVideoMetadata;
  }, [onVideoMetadata]);

  useEffect(() => {
    if (!element.src) {
      return;
    }

    let mounted = true;
    const htmlVideo = document.createElement("video");
    htmlVideo.src = element.src;
    htmlVideo.crossOrigin = "anonymous";
    htmlVideo.muted = true;
    htmlVideo.defaultMuted = true;
    htmlVideo.autoplay = true;
    htmlVideo.controls = false;
    htmlVideo.loop = true;
    htmlVideo.preload = "auto";
    htmlVideo.playsInline = true;
    htmlVideo.setAttribute("playsinline", "true");

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(htmlVideo.duration) ? Math.max(0, htmlVideo.duration) : 0;
      const start = Math.max(0, Number(element.videoStart) || 0);
      onMetadataRef.current?.({ duration });
      try {
        htmlVideo.currentTime = Math.min(start, Math.max(0, duration - 0.01));
      } catch {
        // Ignore initial seek failures while metadata is settling.
      }
    };

    const handleCanPlay = () => {
      if (!mounted) return;
      videoRef.current = htmlVideo;
      setVideo(htmlVideo);
      void htmlVideo.play().catch(() => undefined);
    };

    htmlVideo.addEventListener("loadedmetadata", handleLoadedMetadata);
    htmlVideo.addEventListener("canplay", handleCanPlay);
    htmlVideo.load();

    return () => {
      mounted = false;
      htmlVideo.pause();
      if (videoRef.current === htmlVideo) {
        videoRef.current = null;
      }
      htmlVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
      htmlVideo.removeEventListener("canplay", handleCanPlay);
      setVideo((current) => (current === htmlVideo ? null : current));
    };
  }, [element.src, element.videoEnd, element.videoStart]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media || !forceTimelineSync) return;
    const duration = Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
    const sourceStart = Math.max(0, Number(element.videoStart) || 0);
    const fallbackEnd = duration > 0 ? duration : sourceStart + 0.25;
    const rawVideoEnd = Number(element.videoEnd);
    const sourceEnd = Math.max(
      sourceStart + 0.01,
      duration > 0
        ? Math.min(Number.isFinite(rawVideoEnd) && rawVideoEnd > 0 ? rawVideoEnd : fallbackEnd, duration)
        : Number.isFinite(rawVideoEnd) && rawVideoEnd > 0
          ? rawVideoEnd
          : fallbackEnd
    );
    const layerWindow = resolveTimelineWindow(element, pageDurationMs);
    const targetTime = resolveLoopingVideoTargetTime({
      playheadMs,
      layerStartMs: layerWindow.startMs,
      sourceStart,
      sourceEnd,
    });

    if (Math.abs(media.currentTime - targetTime) <= 0.02) {
      media.pause();
      return;
    }

    try {
      media.pause();
      media.currentTime = targetTime;
    } catch {
      // Ignore sync failures until metadata and keyframes are ready.
    }
  }, [element, forceTimelineSync, pageDurationMs, playheadMs, video]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media || forceTimelineSync) return;
    media.loop = true;
    void media.play().catch(() => undefined);
  }, [forceTimelineSync, video]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    const redraw = () => mediaRef.current?.getLayer()?.batchDraw();
    media.addEventListener("seeked", redraw);
    media.addEventListener("loadeddata", redraw);
    media.addEventListener("canplay", redraw);
    redraw();
    return () => {
      media.removeEventListener("seeked", redraw);
      media.removeEventListener("loadeddata", redraw);
      media.removeEventListener("canplay", redraw);
    };
  }, [video]);

  return (
    <Shape
      ref={(node) => {
        mediaRef.current = node;
        registerRef(element.id, node);
      }}
      id={element.id}
      x={pose.x}
      y={pose.y}
      width={element.width}
      height={element.height}
      rotation={pose.rotation}
      scaleX={pose.scaleX}
      scaleY={pose.scaleY}
      opacity={pose.opacity}
      visible={element.visible}
      draggable={canTransform}
      listening={canTransform}
      globalCompositeOperation={element.blendMode}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={onContextMenu}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      shadowColor={element.shadowColor}
      shadowBlur={element.shadowBlur}
      shadowOffsetX={element.shadowOffsetX}
      shadowOffsetY={element.shadowOffsetY}
      sceneFunc={(context, shape) => {
        const radius = Math.max(0, Number(element.cornerRadius || 0));
        context.beginPath();
        if (radius > 0) {
          context.moveTo(radius, 0);
          context.lineTo(element.width - radius, 0);
          context.quadraticCurveTo(element.width, 0, element.width, radius);
          context.lineTo(element.width, element.height - radius);
          context.quadraticCurveTo(element.width, element.height, element.width - radius, element.height);
          context.lineTo(radius, element.height);
          context.quadraticCurveTo(0, element.height, 0, element.height - radius);
          context.lineTo(0, radius);
          context.quadraticCurveTo(0, 0, radius, 0);
        } else {
          context.rect(0, 0, element.width, element.height);
        }
        context.closePath();
        context.clip();
        if (video) {
          context.drawImage(video, 0, 0, element.width, element.height);
        } else {
          context.fillStyle = "rgba(255,255,255,0.001)";
          context.fillRect(0, 0, element.width, element.height);
        }
        context.fillStrokeShape(shape);
      }}
    />
  );
}

interface FrameNodeProps {
  element: EditorElement;
  pose: ElementRenderPose;
  canTransform: boolean;
  isDropTarget: boolean;
  isContentEditing: boolean;
  playheadMs: number;
  pageDurationMs: number;
  forceTimelineSync: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (event: Konva.KonvaEventObject<Event>) => void;
  onEnterContentEdit: () => void;
  onContentTransform: (patch: { scale?: number; offsetX?: number; offsetY?: number }) => void;
  onContentMetadata: (patch: Partial<FrameContent>) => void;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

function drawFramePath(
  context: CanvasRenderingContext2D | Konva.Context,
  preset: FramePreset,
  width: number,
  height: number
) {
  const canvasContext =
    "_context" in context && context._context
      ? (context._context as CanvasRenderingContext2D)
      : (context as CanvasRenderingContext2D);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  canvasContext.beginPath();

  if (preset.kind === "circle") {
    canvasContext.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    canvasContext.closePath();
    return;
  }

  if (preset.kind === "rect") {
    const radius = Math.min(w / 2, h / 2, Math.max(0, Number(preset.cornerRadius || 0)));
    if (radius <= 0) {
      canvasContext.rect(0, 0, w, h);
      canvasContext.closePath();
      return;
    }
    canvasContext.moveTo(radius, 0);
    canvasContext.lineTo(w - radius, 0);
    canvasContext.quadraticCurveTo(w, 0, w, radius);
    canvasContext.lineTo(w, h - radius);
    canvasContext.quadraticCurveTo(w, h, w - radius, h);
    canvasContext.lineTo(radius, h);
    canvasContext.quadraticCurveTo(0, h, 0, h - radius);
    canvasContext.lineTo(0, radius);
    canvasContext.quadraticCurveTo(0, 0, radius, 0);
    canvasContext.closePath();
    return;
  }

  const points = Array.isArray(preset.points) && preset.points.length >= 6 ? preset.points : [0, 0, 100, 0, 100, 100, 0, 100];
  points.forEach((value, index) => {
    if (index % 2 !== 0) return;
    const x = (Number(value || 0) / 100) * w;
    const y = (Number(points[index + 1] || 0) / 100) * h;
    if (index === 0) {
      canvasContext.moveTo(x, y);
    } else {
      canvasContext.lineTo(x, y);
    }
  });
  canvasContext.closePath();
}

function getFrameBoundsClientRect(
  node: Konva.Node,
  width: number,
  height: number,
  config?: Parameters<Konva.Node["getClientRect"]>[0]
) {
  // Konva's transformer sometimes asks for the untransformed local bounds.
  // Returning absolute bounds in that case makes the overlay apply transforms twice.
  if (config?.skipTransform) {
    return { x: 0, y: 0, width, height };
  }

  let transform = node.getAbsoluteTransform().copy();
  if (config?.relativeTo) {
    const relativeTransform = config.relativeTo.getAbsoluteTransform().copy().invert();
    relativeTransform.multiply(transform);
    transform = relativeTransform;
  }

  const points = [
    transform.point({ x: 0, y: 0 }),
    transform.point({ x: width, y: 0 }),
    transform.point({ x: width, y: height }),
    transform.point({ x: 0, y: height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function CanvasFrameNode({
  element,
  pose,
  canTransform,
  isDropTarget,
  isContentEditing,
  playheadMs,
  pageDurationMs,
  forceTimelineSync,
  onSelect,
  onContextMenu,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onEnterContentEdit,
  onContentTransform,
  onContentMetadata,
  registerRef,
}: FrameNodeProps) {
  const frameContent = element.frameContent || null;
  const preset = useMemo(
    () => resolveFramePreset(element.frameShape?.presetId),
    [element.frameShape?.presetId]
  );
  const transform = element.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM;
  const [image] = useImage(frameContent?.kind === "image" ? frameContent.src : "", "anonymous");
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameGroupRef = useRef<Konva.Group | null>(null);
  const mediaRef = useRef<Konva.Image | null>(null);
  const dropFeedbackRef = useRef<Konva.Group | null>(null);
  const metadataRef = useRef(onContentMetadata);

  useEffect(() => {
    metadataRef.current = onContentMetadata;
  }, [onContentMetadata]);

  useEffect(() => {
    const node = frameGroupRef.current;
    if (!node) return;
    node.getClientRect = (config) =>
      getFrameBoundsClientRect(node, element.width, element.height, config);
    node.getLayer()?.batchDraw();
  }, [element.height, element.width]);

  useEffect(() => {
    if (transform.fit === "manual") return;
    if (!image || frameContent?.kind !== "image") return;
    const width = Number(image.naturalWidth || image.width || 0);
    const height = Number(image.naturalHeight || image.height || 0);
    if (width <= 0 || height <= 0) return;
    metadataRef.current?.({ sourceWidth: width, sourceHeight: height });
  }, [frameContent?.kind, image, transform.fit]);

  useEffect(() => {
    if (frameContent?.kind !== "video" || !frameContent.src) {
      return;
    }

    let mounted = true;
    const htmlVideo = document.createElement("video");
    htmlVideo.src = frameContent.src;
    htmlVideo.crossOrigin = "anonymous";
    htmlVideo.muted = true;
    htmlVideo.defaultMuted = true;
    htmlVideo.autoplay = true;
    htmlVideo.controls = false;
    htmlVideo.loop = true;
    htmlVideo.preload = "auto";
    htmlVideo.playsInline = true;
    htmlVideo.setAttribute("playsinline", "true");

    const handleLoadedMetadata = () => {
      if (!mounted) return;
      const duration = Number.isFinite(htmlVideo.duration) ? Math.max(0, htmlVideo.duration) : 0;
      const start = Math.max(0, Number(frameContent.videoStart) || 0);
      try {
        htmlVideo.currentTime = Math.min(start, Math.max(0, duration - 0.01));
      } catch {
        // Ignore initial seek failures while metadata is settling.
      }
      if (transform.fit === "manual") return;
      const width = Number(htmlVideo.videoWidth || 0);
      const height = Number(htmlVideo.videoHeight || 0);
      metadataRef.current?.({
        sourceWidth: width > 0 ? width : undefined,
        sourceHeight: height > 0 ? height : undefined,
        videoDuration: duration,
        videoEnd: frameContent.videoEnd && frameContent.videoEnd > 0 ? frameContent.videoEnd : duration,
      });
    };

    const handleCanPlay = () => {
      if (!mounted) return;
      videoRef.current = htmlVideo;
      setVideo(htmlVideo);
      void htmlVideo.play().catch(() => undefined);
    };

    htmlVideo.addEventListener("loadedmetadata", handleLoadedMetadata);
    htmlVideo.addEventListener("canplay", handleCanPlay);
    htmlVideo.load();

    return () => {
      mounted = false;
      htmlVideo.pause();
      if (videoRef.current === htmlVideo) {
        videoRef.current = null;
      }
      htmlVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
      htmlVideo.removeEventListener("canplay", handleCanPlay);
      setVideo((current) => (current === htmlVideo ? null : current));
    };
  }, [frameContent?.kind, frameContent?.src, frameContent?.videoEnd, frameContent?.videoStart, transform.fit]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media || frameContent?.kind !== "video" || !forceTimelineSync) return;
    const duration = Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
    const sourceStart = Math.max(0, Number(frameContent.videoStart) || 0);
    const fallbackEnd = duration > 0 ? duration : sourceStart + 0.25;
    const rawVideoEnd = Number(frameContent.videoEnd);
    const sourceEnd = Math.max(
      sourceStart + 0.01,
      duration > 0
        ? Math.min(Number.isFinite(rawVideoEnd) && rawVideoEnd > 0 ? rawVideoEnd : fallbackEnd, duration)
        : Number.isFinite(rawVideoEnd) && rawVideoEnd > 0
          ? rawVideoEnd
          : fallbackEnd
    );
    const layerWindow = resolveTimelineWindow(element, pageDurationMs);
    const targetTime = resolveLoopingVideoTargetTime({
      playheadMs,
      layerStartMs: layerWindow.startMs,
      sourceStart,
      sourceEnd,
    });

    if (Math.abs(media.currentTime - targetTime) <= 0.02) {
      media.pause();
      return;
    }

    try {
      media.pause();
      media.currentTime = targetTime;
    } catch {
      // Ignore sync failures until metadata and keyframes are ready.
    }
  }, [element, forceTimelineSync, frameContent, pageDurationMs, playheadMs, video]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media || frameContent?.kind !== "video" || forceTimelineSync) return;
    media.loop = true;
    void media.play().catch(() => undefined);
  }, [forceTimelineSync, frameContent?.kind, video]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    const redraw = () => mediaRef.current?.getLayer()?.batchDraw();
    media.addEventListener("seeked", redraw);
    media.addEventListener("loadeddata", redraw);
    media.addEventListener("canplay", redraw);
    redraw();
    return () => {
      media.removeEventListener("seeked", redraw);
      media.removeEventListener("loadeddata", redraw);
      media.removeEventListener("canplay", redraw);
    };
  }, [video]);

  useEffect(() => {
    const node = dropFeedbackRef.current;
    if (!node || !isDropTarget) {
      if (node) {
        node.opacity(0);
        node.scale({ x: 1, y: 1 });
        node.rotation(0);
        node.getLayer()?.batchDraw();
      }
      return;
    }

    const layer = node.getLayer();
    const animation = new Konva.Animation((frame) => {
      const time = frame?.time || 0;
      const pulse = 1 + Math.sin(time / 115) * 0.018;
      const wobble = Math.sin(time / 42) * 1.1;
      const glow = 0.58 + Math.sin(time / 95) * 0.22;
      node.opacity(glow);
      node.scale({ x: pulse, y: pulse });
      node.rotation(wobble);
    }, layer);

    animation.start();
    return () => {
      animation.stop();
      node.opacity(0);
      node.scale({ x: 1, y: 1 });
      node.rotation(0);
      node.getLayer()?.batchDraw();
    };
  }, [isDropTarget]);

  const mediaSource = frameContent?.kind === "video" ? video : image;
  const mediaLayout = useMemo(
    () =>
      resolveFrameContentLayout(
        element.width,
        element.height,
        frameContent?.sourceWidth,
        frameContent?.sourceHeight,
        transform
      ),
    [
      element.height,
      element.width,
      frameContent?.sourceHeight,
      frameContent?.sourceWidth,
      transform,
    ]
  );
  const baseLayout = useMemo(
    () =>
      resolveFrameContentLayout(
        element.width,
        element.height,
        frameContent?.sourceWidth,
        frameContent?.sourceHeight,
        { ...transform, offsetX: 0, offsetY: 0 }
      ),
    [
      element.height,
      element.width,
      frameContent?.sourceHeight,
      frameContent?.sourceWidth,
      transform,
    ]
  );

  return (
    <Group
      ref={(node) => {
        frameGroupRef.current = node;
        registerRef(element.id, node);
      }}
      id={element.id}
      x={pose.x}
      y={pose.y}
      rotation={pose.rotation}
      scaleX={pose.scaleX}
      scaleY={pose.scaleY}
      opacity={pose.opacity}
      draggable={canTransform && !isContentEditing}
      listening={canTransform || isContentEditing}
      globalCompositeOperation={element.blendMode}
      shadowColor={element.shadowColor}
      shadowBlur={element.shadowBlur}
      shadowOffsetX={element.shadowOffsetX}
      shadowOffsetY={element.shadowOffsetY}
      clipFunc={(context) => drawFramePath(context, preset, element.width, element.height)}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={onContextMenu}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      onDblClick={(event) => {
        event.cancelBubble = true;
        onEnterContentEdit();
      }}
      onDblTap={(event) => {
        event.cancelBubble = true;
        onEnterContentEdit();
      }}
      onWheel={(event) => {
        if (!isContentEditing || !frameContent) return;
        event.cancelBubble = true;
        event.evt.preventDefault();
        const direction = event.evt.deltaY > 0 ? -1 : 1;
        const nextScale = clamp(Number(transform.scale || 1) * (direction > 0 ? 1.06 : 1 / 1.06), 0.1, 8);
        onContentTransform({ scale: nextScale });
      }}
    >
      <Shape
        width={element.width}
        height={element.height}
        fill={frameContent ? "#f8fafc" : "#eaf6ff"}
        sceneFunc={(context, shape) => {
          drawFramePath(context, preset, element.width, element.height);
          context.fillStrokeShape(shape);
        }}
        // The frame group itself has no hit area, so this masked fill is the click/drag target.
        listening={canTransform || isContentEditing}
      />
      {mediaSource ? (
        <KonvaImage
          ref={mediaRef}
          image={mediaSource}
          x={mediaLayout.x}
          y={mediaLayout.y}
          width={mediaLayout.width}
          height={mediaLayout.height}
          draggable={isContentEditing}
          listening={isContentEditing}
          perfectDrawEnabled={false}
          onDragEnd={(event) => {
            event.cancelBubble = true;
            onContentTransform({
              offsetX: event.target.x() - baseLayout.x,
              offsetY: event.target.y() - baseLayout.y,
            });
          }}
        />
      ) : (
        <Group listening={false}>
          <Rect x={0} y={0} width={element.width} height={element.height} fill="#e6f5ff" />
          <Circle x={element.width * 0.44} y={element.height * 0.42} radius={Math.min(element.width, element.height) * 0.14} fill="#ffffff" opacity={0.9} />
          <Line
            points={[
              element.width * 0.04,
              element.height * 0.88,
              element.width * 0.38,
              element.height * 0.54,
              element.width * 0.62,
              element.height * 0.76,
              element.width * 0.96,
              element.height * 0.48,
              element.width * 0.96,
              element.height * 0.96,
              element.width * 0.04,
              element.height * 0.96,
            ]}
            closed
            fill="#9abf44"
            opacity={0.75}
          />
        </Group>
      )}
      <Shape
        width={element.width}
        height={element.height}
        stroke={isContentEditing ? "#ff5c7a" : isDropTarget ? "#2c68be" : element.stroke || "#94a3b8"}
        strokeWidth={isContentEditing || isDropTarget ? Math.max(3, element.strokeWidth || 2) : element.strokeWidth || 2}
        dash={isContentEditing ? [8, 6] : undefined}
        fillEnabled={false}
        sceneFunc={(context, shape) => {
          drawFramePath(context, preset, element.width, element.height);
          context.fillStrokeShape(shape);
        }}
        listening={false}
      />
      <Group
        ref={dropFeedbackRef}
        x={element.width / 2}
        y={element.height / 2}
        offsetX={element.width / 2}
        offsetY={element.height / 2}
        opacity={0}
        listening={false}
      >
        <Shape
          width={element.width}
          height={element.height}
          stroke="#ff5c7a"
          strokeWidth={Math.max(5, (element.strokeWidth || 2) + 3)}
          shadowColor="#ff5c7a"
          shadowBlur={14}
          shadowOpacity={0.55}
          fillEnabled={false}
          sceneFunc={(context, shape) => {
            drawFramePath(context, preset, element.width, element.height);
            context.fillStrokeShape(shape);
          }}
          listening={false}
        />
      </Group>
    </Group>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveTextDirection(text: string) {
  return /[\u0590-\u08FF]/.test(String(text || "")) ? "rtl" : "ltr";
}

function toKonvaFontStyle(fontStyle: EditorElement["fontStyle"], fontWeight: EditorElement["fontWeight"]) {
  const numericWeight = Number.parseInt(String(fontWeight || "").replace(/[^\d]/g, ""), 10);
  const isBold = Number.isFinite(numericWeight) ? numericWeight >= 600 : /bold/i.test(String(fontWeight || ""));
  const isItalic = fontStyle === "italic";
  if (isBold && isItalic) return "bold italic";
  if (isBold) return "bold";
  if (isItalic) return "italic";
  return "normal";
}

function resolveEffectiveAnimationType(element: EditorElement) {
  const normalizedType = normalizeAnimationType(element.mediaAnimationType);
  return normalizedType === "RANDOM"
    ? (["FADE", "PAN", "POP", "BASELINE", "WIGGLE", "PULSE"][
        Array.from(String(element.id || "random")).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
      ] as ReturnType<typeof normalizeAnimationType>)
    : normalizedType;
}

function applyAnimationEasing(progress: number, easing: EditorAnimationEasing) {
  const value = clamp(progress, 0, 1);
  switch (easing) {
    case "LINEAR":
      return value;
    case "EASE_OUT":
      return 1 - Math.pow(1 - value, 3);
    case "EASE_IN_OUT":
      return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
    case "SOFT_OUT":
      return 1 - Math.pow(1 - value, 4);
    case "SOFT_IN_OUT":
      return 0.5 - Math.cos(Math.PI * value) / 2;
    default:
      return value;
  }
}

function getDirectionalVector(direction: EditorAnimationDirection) {
  switch (direction) {
    case "LEFT":
      return { x: -1, y: 0, spin: -1 };
    case "RIGHT":
      return { x: 1, y: 0, spin: 1 };
    case "UP":
      return { x: 0, y: -1, spin: -1 };
    case "DOWN":
      return { x: 0, y: 1, spin: 1 };
    case "COUNTERCLOCKWISE":
      return { x: 0, y: 0, spin: -1 };
    case "CLOCKWISE":
      return { x: 0, y: 0, spin: 1 };
    default:
      return { x: 0, y: 0, spin: 1 };
  }
}

function pingPong(progress: number) {
  const normalized = ((progress % 1) + 1) % 1;
  return 0.5 - Math.cos(normalized * Math.PI * 2) / 2;
}

interface AnimationState {
  preset: EditorAnimationPreset;
  progress: number;
  cycleProgress: number;
  cycleWave: number;
  direction: EditorAnimationDirection;
  intensity: number;
  isInfinite: boolean;
}

function resolveAnimationState(
  element: EditorElement,
  playheadMs: number,
  pageDurationMs: number
): AnimationState | null {
  const type = resolveEffectiveAnimationType(element);
  const preset = getAnimationPreset(type);
  if (type === "NONE") return null;

  const legacyMode = normalizeAnimationMode(element.mediaAnimationMode);
  const direction = normalizeAnimationDirection(element.mediaAnimationDirection, type);
  const easing = normalizeAnimationEasing(element.mediaAnimationEasing, type);
  const intensity = normalizeAnimationIntensity(element.mediaAnimationIntensity);
  const timelineWindow = resolveTimelineWindow(element, pageDurationMs);
  const layerDurationMs = Math.max(1, timelineWindow.endMs - timelineWindow.startMs);
  const delayMs = Math.min(layerDurationMs - 1, normalizeAnimationDelayMs(element.mediaAnimationDelayMs));
  const durationMs = Math.max(
    1,
    Math.min(
      layerDurationMs,
      normalizeAnimationInfinite(element.mediaAnimationInfinite, element.mediaAnimationMode) && preset.supportsInfinite
        ? preset.defaultDurationMs
        : normalizeAnimationDurationMs(element.mediaAnimationDurationMs || preset.defaultDurationMs)
    )
  );
  const localMs = playheadMs - timelineWindow.startMs;
  const activeMs = Math.max(0, localMs - delayMs);
  const isInfinite =
    normalizeAnimationInfinite(element.mediaAnimationInfinite, element.mediaAnimationMode) &&
    preset.supportsInfinite;
  const cycleProgress =
    activeMs <= 0
      ? 0
      : isInfinite
        ? (activeMs % durationMs) / durationMs
        : clamp(activeMs / durationMs, 0, 1);
  const cycleWave = applyAnimationEasing(pingPong(cycleProgress), easing);

  if (preset.category === "loop") {
    const oneShot = applyAnimationEasing(clamp(activeMs / durationMs, 0, 1), easing);
    return {
      preset,
      progress: isInfinite ? cycleWave : oneShot,
      cycleProgress,
      cycleWave,
      direction,
      intensity,
      isInfinite,
    };
  }

  if (isInfinite || legacyMode === "LOOP") {
    return {
      preset,
      progress: cycleWave,
      cycleProgress,
      cycleWave,
      direction,
      intensity,
      isInfinite: true,
    };
  }

  const introProgress = applyAnimationEasing(clamp(activeMs / durationMs, 0, 1), easing);
  const outroStartMs = Math.max(0, layerDurationMs - durationMs - delayMs);
  const outroProgress = applyAnimationEasing(
    clamp((timelineWindow.endMs - playheadMs - delayMs) / durationMs, 0, 1),
    easing
  );
  const progress =
    legacyMode === "OUT"
      ? outroProgress
      : localMs >= outroStartMs + delayMs
        ? outroProgress
        : introProgress;

  return {
    preset,
    progress,
    cycleProgress,
    cycleWave,
    direction,
    intensity,
    isInfinite: false,
  };
}

function resolveAnimatedElementPose(
  element: EditorElement,
  playheadMs: number,
  pageDurationMs: number
): ElementRenderPose {
  const base: ElementRenderPose = {
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    scaleX: element.scaleX,
    scaleY: element.scaleY,
    opacity: element.opacity,
  };

  const state = resolveAnimationState(element, playheadMs, pageDurationMs);
  const type = resolveEffectiveAnimationType(element);
  if (!state) return base;

  const vector = getDirectionalVector(state.direction);
  const progress = clamp(state.progress, 0, 1);
  const intensity = state.intensity;
  const amplitudeX = Math.max(12, element.width * 0.18) * intensity;
  const amplitudeY = Math.max(12, element.height * 0.18) * intensity;

  let opacityFactor = 1;
  let scaleXFactor = 1;
  let scaleYFactor = 1;
  let offsetX = 0;
  let offsetY = 0;
  let rotationOffset = 0;

  switch (type) {
    case "FADE":
      opacityFactor = 0.04 + progress * 0.96;
      break;
    case "BLUR":
      opacityFactor = 0.05 + progress * 0.95;
      scaleXFactor = 0.92 + progress * 0.08;
      scaleYFactor = 0.92 + progress * 0.08;
      break;
    case "RISE":
      offsetY = Math.max(16, element.height * 0.22) * (1 - progress) * intensity;
      opacityFactor = 0.12 + progress * 0.88;
      break;
    case "PAN":
      offsetX = vector.x * (1 - progress) * Math.max(22, element.width * 0.28) * intensity;
      opacityFactor = 0.16 + progress * 0.84;
      break;
    case "DRIFT":
      offsetX = vector.x * (1 - progress) * Math.max(14, element.width * 0.18) * intensity;
      offsetY = vector.y * (1 - progress) * Math.max(8, element.height * 0.12) * intensity;
      opacityFactor = 0.1 + progress * 0.9;
      break;
    case "TECTONIC":
      offsetX = vector.x * (1 - progress) * Math.max(28, element.width * 0.34) * intensity;
      scaleXFactor = 0.9 + progress * 0.1;
      opacityFactor = 0.08 + progress * 0.92;
      break;
    case "WIPE":
      if (Math.abs(vector.x) > 0) {
        scaleXFactor = Math.max(0.001, progress);
        offsetX = vector.x < 0 ? element.width * (1 - progress) : 0;
      } else {
        scaleYFactor = Math.max(0.001, progress);
        offsetY = vector.y < 0 ? element.height * (1 - progress) : 0;
      }
      break;
    case "POP":
      scaleXFactor = 0.7 + progress * 0.3;
      scaleYFactor = 0.7 + progress * 0.3;
      opacityFactor = 0.12 + progress * 0.88;
      break;
    case "SUCCESSION":
      scaleXFactor = 0.82 + progress * 0.18;
      scaleYFactor = 0.82 + progress * 0.18;
      opacityFactor = 0.06 + progress * 0.94;
      break;
    case "STOMP":
      scaleXFactor = 0.78 + progress * 0.22;
      scaleYFactor = 0.78 + progress * 0.22;
      rotationOffset = (1 - progress) * 18 * vector.spin * intensity;
      opacityFactor = 0.1 + progress * 0.9;
      break;
    case "BREATHE": {
      const breathWave = pingPong(state.cycleProgress);
      scaleXFactor = 1 + breathWave * 0.06 * intensity;
      scaleYFactor = 1 + breathWave * 0.06 * intensity;
      opacityFactor = 0.86 + breathWave * 0.14;
      break;
    }
    case "BASELINE": {
      const bounceWave = Math.abs(Math.sin(state.cycleProgress * Math.PI * 2));
      offsetY = -bounceWave * Math.max(10, element.height * 0.1) * intensity;
      scaleYFactor = 1 - bounceWave * 0.06 * intensity;
      scaleXFactor = 1 + bounceWave * 0.04 * intensity;
      break;
    }
    case "TUMBLE":
      rotationOffset = (1 - progress) * 26 * vector.spin * intensity;
      offsetX = vector.spin * (1 - progress) * Math.max(18, element.width * 0.18) * intensity;
      offsetY = -(1 - progress) * Math.max(18, element.height * 0.22) * intensity;
      opacityFactor = 0.08 + progress * 0.92;
      break;
    case "NEON": {
      const pulseWave = pingPong(state.cycleProgress);
      scaleXFactor = 1 + pulseWave * 0.05 * intensity;
      scaleYFactor = 1 + pulseWave * 0.05 * intensity;
      opacityFactor = clamp(0.8 + pulseWave * 0.2 + Math.sin(state.cycleProgress * Math.PI * 6) * 0.04, 0.72, 1);
      break;
    }
    case "SCRAPBOOK": {
      const scrapbookWave = Math.sin(state.cycleProgress * Math.PI * 2);
      rotationOffset = scrapbookWave * 6.5 * intensity;
      offsetX = scrapbookWave * Math.max(5, element.width * 0.024) * intensity;
      offsetY = Math.cos(state.cycleProgress * Math.PI * 2) * Math.max(3, element.height * 0.018) * intensity;
      break;
    }
    case "ROTATE":
      rotationOffset = state.cycleProgress * 360 * vector.spin * intensity;
      break;
    case "FLICKER": {
      const irregular =
        0.4 +
        0.34 * Math.abs(Math.sin(state.cycleProgress * Math.PI * 9.2)) +
        0.22 * Math.abs(Math.sin(state.cycleProgress * Math.PI * 23.6));
      opacityFactor = clamp(
        state.isInfinite ? irregular : 1 - state.progress + irregular * state.progress,
        0.16,
        1
      );
      break;
    }
    case "PULSE": {
      const pulseWave = pingPong(state.cycleProgress);
      scaleXFactor = 1 + pulseWave * 0.12 * intensity;
      scaleYFactor = 1 + pulseWave * 0.12 * intensity;
      break;
    }
    case "WIGGLE": {
      const wiggleWave = Math.sin(state.cycleProgress * Math.PI * 2);
      rotationOffset = wiggleWave * 4.5 * intensity;
      offsetX = wiggleWave * Math.max(3, element.width * 0.018) * intensity;
      break;
    }
    default:
      break;
  }

  return {
    x: base.x + offsetX,
    y: base.y + offsetY,
    rotation: base.rotation + rotationOffset,
    scaleX: base.scaleX * scaleXFactor,
    scaleY: base.scaleY * scaleYFactor,
    opacity: clamp(base.opacity * opacityFactor, 0, 1),
  };
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function normalizeRect(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

export default function CanvasEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Record<string, Konva.Node | null>>({});

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const toolMode = useEditorStore((state) => state.toolMode);
  const drawTool = useEditorStore((state) => state.drawTool);
  const drawStrokeWidth = useEditorStore((state) => state.drawStrokeWidth);
  const drawColor = useEditorStore((state) => state.drawColor);
  const drawOpacity = useEditorStore((state) => state.drawOpacity);
  const availableFontFamilies = useEditorStore((state) => state.availableFontFamilies);
  const timelinePlayheadMs = useEditorStore((state) => state.timelinePlayheadMs);
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const previewGenerationActive = useEditorStore((state) => state.previewGenerationActive);

  const setStageApi = useEditorStore((state) => state.setStageApi);
  const setZoomPercent = useEditorStore((state) => state.setZoomPercent);
  const setTimelinePlayheadMs = useEditorStore((state) => state.setTimelinePlayheadMs);
  const setTimelinePlaying = useEditorStore((state) => state.setTimelinePlaying);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
  const setShowRightSidebar = useEditorStore((state) => state.setShowRightSidebar);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const addTextElement = useEditorStore((state) => state.addTextElement);
  const addShapeElement = useEditorStore((state) => state.addShapeElement);
  const addImageElement = useEditorStore((state) => state.addImageElement);
  const addVideoElement = useEditorStore((state) => state.addVideoElement);
  const addFrameElement = useEditorStore((state) => state.addFrameElement);
  const addFreehandLine = useEditorStore((state) => state.addFreehandLine);
  const updateElement = useEditorStore((state) => state.updateElement);
  const setFrameContent = useEditorStore((state) => state.setFrameContent);
  const updateFrameContentTransform = useEditorStore((state) => state.updateFrameContentTransform);
  const deleteElement = useEditorStore((state) => state.deleteElement);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const moveLayer = useEditorStore((state) => state.moveLayer);
  const replaceSelectedWithImageLayer = useEditorStore((state) => state.replaceSelectedWithImageLayer);

  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const [drawPoints, setDrawPoints] = useState<number[] | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null);
  const [frameDropTargetId, setFrameDropTargetId] = useState("");
  const [frameContentEditId, setFrameContentEditId] = useState("");
  const [capturePlayheadOverrideMs, setCapturePlayheadOverrideMs] = useState<number | null>(null);

  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const frameDropTargetTimeoutRef = useRef<number | null>(null);
  const expiredFrameDropTargetRef = useRef("");
  const timelinePlayheadRef = useRef(0);
  const activePagePlayheadRef = useRef(0);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );

  const elements = useMemo(() => activePage?.elements ?? [], [activePage]);
  const activePageDurationMs = useMemo(() => getPageDurationMs(activePage), [activePage]);
  const activePageTimelineStartMs = useMemo(() => {
    const entry = getTimelinePageEntries(pages).find((item) => item.page.id === activePage?.id);
    return entry?.startMs || 0;
  }, [activePage?.id, pages]);
  const activePagePlayheadMs = useMemo(
    () => Math.max(0, Math.min(activePageDurationMs, timelinePlayheadMs - activePageTimelineStartMs)),
    [activePageDurationMs, activePageTimelineStartMs, timelinePlayheadMs]
  );
  const effectiveActivePagePlayheadMs =
    capturePlayheadOverrideMs === null ? activePagePlayheadMs : capturePlayheadOverrideMs;
  const forceTimelineMediaSync = capturePlayheadOverrideMs !== null || previewGenerationActive;

  useEffect(() => {
    timelinePlayheadRef.current = timelinePlayheadMs;
  }, [timelinePlayheadMs]);

  useEffect(() => {
    activePagePlayheadRef.current = activePagePlayheadMs;
  }, [activePagePlayheadMs]);

  useEffect(() => {
    if (!frameContentEditId) return;
    if (selectedIds.includes(frameContentEditId)) return;
    setFrameContentEditId("");
  }, [frameContentEditId, selectedIds]);

  const updateViewport = useCallback(
    (next: { x: number; y: number; scale: number }) => {
      setViewport(next);
      setZoomPercent(next.scale * 100);
    },
    [setZoomPercent]
  );

  const fitToScreen = useCallback(() => {
    if (!activePage || !containerSize.width || !containerSize.height) return;

    const padding = 120;
    const scale = clamp(
      Math.min(
        (containerSize.width - padding) / Math.max(1, activePage.width),
        (containerSize.height - padding) / Math.max(1, activePage.height)
      ),
      MIN_SCALE,
      MAX_SCALE
    );

    const x = (containerSize.width - activePage.width * scale) / 2;
    const y = (containerSize.height - activePage.height * scale) / 2;

    updateViewport({ x, y, scale });
  }, [activePage, containerSize.height, containerSize.width, updateViewport]);

  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = viewport.scale;
      const pointer = stage.getPointerPosition() || {
        x: containerSize.width / 2,
        y: containerSize.height / 2,
      };

      const nextScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
      const mousePoint = {
        x: (pointer.x - viewport.x) / oldScale,
        y: (pointer.y - viewport.y) / oldScale,
      };

      const nextPos = {
        x: pointer.x - mousePoint.x * nextScale,
        y: pointer.y - mousePoint.y * nextScale,
      };

      updateViewport({ x: nextPos.x, y: nextPos.y, scale: nextScale });
    },
    [containerSize.height, containerSize.width, updateViewport, viewport.scale, viewport.x, viewport.y]
  );

  const exportPng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !activePage) return;

    const x = viewport.x;
    const y = viewport.y;
    const width = activePage.width * viewport.scale;
    const height = activePage.height * viewport.scale;

    const dataUrl = stage.toDataURL({
      pixelRatio: Math.max(2, 2 / viewport.scale),
      x,
      y,
      width,
      height,
      mimeType: "image/png",
    });

    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `design-${Date.now()}.png`;
    anchor.click();
  }, [activePage, viewport.scale, viewport.x, viewport.y]);

  const captureThumbnailDataUrl = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !activePage) return "";

    const x = viewport.x;
    const y = viewport.y;
    const width = activePage.width * viewport.scale;
    const height = activePage.height * viewport.scale;

    try {
      return stage.toDataURL({
        // Capture at canvas resolution; server-side pipeline then applies the 0.5 thumbnail scale.
        pixelRatio: Math.max(0.1, 1 / Math.max(viewport.scale, 0.1)),
        x,
        y,
        width,
        height,
        mimeType: "image/png",
      });
    } catch {
      return "";
    }
  }, [activePage, viewport.scale, viewport.x, viewport.y]);

  const renderCurrentPageToCanvas = useCallback(
    (maxDimension = 720) => {
      const stage = stageRef.current;
      if (!stage || !activePage) return null;

      const x = viewport.x;
      const y = viewport.y;
      const width = activePage.width * viewport.scale;
      const height = activePage.height * viewport.scale;
      const safeMaxDimension = Math.max(240, Math.round(Number(maxDimension) || 720));
      const previewScale = Math.min(1, safeMaxDimension / Math.max(activePage.width, activePage.height));
      const pixelRatio = Math.max(0.1, previewScale / Math.max(viewport.scale, 0.1));

      try {
        const canvas = stage.toCanvas({
          x,
          y,
          width,
          height,
          pixelRatio,
        });
        return {
          canvas,
          width: Math.max(1, Math.round(activePage.width * previewScale)),
          height: Math.max(1, Math.round(activePage.height * previewScale)),
        };
      } catch {
        return null;
      }
    },
    [activePage, viewport.scale, viewport.x, viewport.y]
  );

  const recordTimelinePreviewVideo = useCallback(
    async (options?: { fps?: number; maxDimension?: number; durationMs?: number }) => {
      const stage = stageRef.current;
      const transformer = transformerRef.current;
      if (!stage || !activePage) return null;
      if (typeof MediaRecorder === "undefined") {
        throw new Error("Preview recording is not supported in this browser.");
      }

      const mimeType = getPreviewRecorderMimeType();
      if (!mimeType) {
        throw new Error("No supported video recorder format is available in this browser.");
      }

      const output = renderCurrentPageToCanvas(options?.maxDimension ?? 720);
      if (!output) {
        throw new Error("Unable to capture the current template preview.");
      }

      const fps = clamp(
        Math.round(Number(options?.fps) || designTimeline.fps || 20),
        12,
        24
      );
      const durationMs = Math.max(
        300,
        Math.round(
          Number(options?.durationMs) ||
            Number(designTimeline.totalDurationMs) ||
            Number(activePageDurationMs) ||
            0
        )
      );
      const recordingCanvas = document.createElement("canvas");
      recordingCanvas.width = output.width;
      recordingCanvas.height = output.height;
      const recordingContext = recordingCanvas.getContext("2d");
      if (!recordingContext) {
        throw new Error("Preview recorder canvas is unavailable.");
      }

      let stream = recordingCanvas.captureStream(fps);
      let canvasTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      const supportsManualFrameCapture = Boolean(
        canvasTrack && typeof canvasTrack.requestFrame === "function"
      );
      if (supportsManualFrameCapture) {
        stream.getTracks().forEach((track) => track.stop());
        stream = recordingCanvas.captureStream(0);
        canvasTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      }
      const tracks = stream.getTracks();
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Math.max(6_000_000, Math.round(output.width * output.height * 5)),
      });
      const chunks: Blob[] = [];
      const previousNodes = transformer?.nodes() || [];
      let recorderStopResolve: ((blob: Blob) => void) | null = null;
      let recorderStopReject: ((error: Error) => void) | null = null;
      const recorderStopped = new Promise<Blob>((resolve, reject) => {
        recorderStopResolve = resolve;
        recorderStopReject = reject;
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        recorderStopResolve?.(new Blob(chunks, { type: mimeType }));
      });
      recorder.addEventListener("error", () => {
        recorderStopReject?.(new Error("Preview recorder failed while encoding the video."));
      });

      let posterDataUrl = "";
      const previousAbsolutePlayheadMs = timelinePlayheadRef.current;
      const captureCurrentFrame = async () => {
        stage.batchDraw();
        await waitForAnimationFrame();
        const captured = renderCurrentPageToCanvas(options?.maxDimension ?? 720);
        if (!captured) return;
        recordingContext.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
        recordingContext.drawImage(captured.canvas, 0, 0, recordingCanvas.width, recordingCanvas.height);

        if (!posterDataUrl) {
          try {
            posterDataUrl = recordingCanvas.toDataURL("image/png");
          } catch {
            posterDataUrl = "";
          }
        }

        if (supportsManualFrameCapture && canvasTrack && typeof canvasTrack.requestFrame === "function") {
          canvasTrack.requestFrame();
        }
      };

      try {
        transformer?.nodes([]);
        transformer?.forceUpdate();
        transformer?.getLayer()?.batchDraw();

        setTimelinePlaying(false);
        setTimelinePlayheadMs(activePageTimelineStartMs);
        await waitForAnimationFrame();
        await captureCurrentFrame();

        recorder.start();

        // Start the same shared timeline playback the user sees from the play button,
        // then sample the canvas from the actual playhead progression instead of a
        // separate recording timer. That keeps recording aligned with visible playback.
        setTimelinePlaying(true);

        const startedAt = performance.now();
        const frameStepMs = Math.max(1, Math.round(1000 / fps));
        let nextCapturePlayheadMs = frameStepMs;

        while (true) {
          await waitForAnimationFrame();
          const now = performance.now();
          const currentPlayheadMs = activePagePlayheadRef.current;
          const reachedEnd = currentPlayheadMs >= durationMs || now - startedAt >= durationMs + 500;

          while (currentPlayheadMs >= nextCapturePlayheadMs && nextCapturePlayheadMs <= durationMs) {
            await captureCurrentFrame();
            nextCapturePlayheadMs += frameStepMs;
          }

          if (reachedEnd) {
            if (currentPlayheadMs < nextCapturePlayheadMs) {
              await captureCurrentFrame();
            }
            break;
          }
        }

        setTimelinePlaying(false);
        setTimelinePlayheadMs(activePageTimelineStartMs + durationMs);
        await waitForAnimationFrame();
        await captureCurrentFrame();
      } finally {
        setTimelinePlaying(false);
        setTimelinePlayheadMs(previousAbsolutePlayheadMs);
        transformer?.nodes(previousNodes);
        transformer?.forceUpdate();
        transformer?.getLayer()?.batchDraw();
        stage.batchDraw();
      }

      recorder.stop();
      const blob = await recorderStopped;
      tracks.forEach((track) => track.stop());

      return {
        blob,
        mimeType,
        durationMs,
        posterDataUrl,
        width: recordingCanvas.width,
        height: recordingCanvas.height,
      };
    },
    [
      activePage,
      activePageDurationMs,
      activePageTimelineStartMs,
      designTimeline.fps,
      designTimeline.totalDurationMs,
      renderCurrentPageToCanvas,
      setTimelinePlayheadMs,
      setTimelinePlaying,
    ]
  );

  const captureTimelineStripDataUrls = useCallback(
    async (playheadsMs: number[]) => {
      const stage = stageRef.current;
      if (!stage || !activePage || !Array.isArray(playheadsMs) || playheadsMs.length === 0) {
        return [];
      }

      const pageContainsVideo = activePage.elements.some((element) => {
        const type = String(element.type || "").trim().toLowerCase();
        if (type === "video") return true;
        if (type !== "frame") return false;
        return String(element.frameContent?.kind || "").trim().toLowerCase() === "video";
      });
      if (pageContainsVideo) {
        return [];
      }

      const waitForCanvasFrame = async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      };

      const captures: string[] = [];
      try {
        for (const playhead of playheadsMs) {
          setCapturePlayheadOverrideMs(clamp(Number(playhead) || 0, 0, activePageDurationMs));
          await waitForCanvasFrame();
          stage.batchDraw();
          await waitForCanvasFrame();
          const captured = String(captureThumbnailDataUrl() || "").trim();
          if (captured) {
            captures.push(captured);
          }
        }
      } finally {
        setCapturePlayheadOverrideMs(null);
      }

      return captures;
    },
    [activePage, activePageDurationMs, captureThumbnailDataUrl]
  );

  const mergeSelectedLayers = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || !activePage) {
      return { merged: false, message: "Canvas is still loading. Try again in a moment." };
    }

    if (selectedIds.length < 2) {
      return { merged: false, message: "Select at least 2 layers to merge." };
    }

    const selectedSet = new Set(selectedIds);
    const selectedElements = elements.filter((element) => selectedSet.has(element.id));
    if (selectedElements.length < 2) {
      return { merged: false, message: "Select at least 2 layers to merge." };
    }

    if (selectedElements.some((element) => element.type === "video")) {
      return { merged: false, message: "Video layers are not supported in merge yet." };
    }

    const selectedEntries = elements
      .filter((element) => selectedSet.has(element.id))
      .map((element) => ({
        element,
        node: nodeRefs.current[element.id],
      }))
      .filter(
        (entry): entry is { element: EditorElement; node: Konva.Node } =>
          Boolean(entry.node) && entry.element.visible
      );

    if (selectedEntries.length < 2) {
      return { merged: false, message: "Unable to read selected layers for merge." };
    }

    const bounds = selectedEntries.reduce<{ x: number; y: number; width: number; height: number } | null>(
      (acc, { node }) => {
        const rect = node.getClientRect({
          relativeTo: stage,
          skipShadow: false,
          skipStroke: false,
        });
        if (
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height)
        ) {
          return acc;
        }
        if (!acc) {
          return { ...rect };
        }
        const minX = Math.min(acc.x, rect.x);
        const minY = Math.min(acc.y, rect.y);
        const maxX = Math.max(acc.x + acc.width, rect.x + rect.width);
        const maxY = Math.max(acc.y + acc.height, rect.y + rect.height);
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };
      },
      null
    );

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { merged: false, message: "Unable to compute selected area for merge." };
    }

    const cropX = clamp(bounds.x, 0, activePage.width);
    const cropY = clamp(bounds.y, 0, activePage.height);
    const cropRight = clamp(bounds.x + bounds.width, 0, activePage.width);
    const cropBottom = clamp(bounds.y + bounds.height, 0, activePage.height);
    const cropWidth = Math.max(0, cropRight - cropX);
    const cropHeight = Math.max(0, cropBottom - cropY);
    if (cropWidth < 2 || cropHeight < 2) {
      return { merged: false, message: "Selected layers are outside the canvas bounds." };
    }

    const tempContainer = document.createElement("div");
    const tempStage = new Konva.Stage({
      container: tempContainer,
      width: Math.ceil(cropWidth),
      height: Math.ceil(cropHeight),
    });
    const tempLayer = new Konva.Layer();
    tempStage.add(tempLayer);

    try {
      selectedEntries.forEach(({ node }) => {
        const clone = node.clone({
          listening: false,
          draggable: false,
          id: "",
        });
        const absolutePosition = node.getAbsolutePosition(stage);
        clone.position({
          x: absolutePosition.x - cropX,
          y: absolutePosition.y - cropY,
        });
        tempLayer.add(clone);
      });

      tempLayer.draw();
      const dataUrl = tempStage.toDataURL({
        pixelRatio: 2,
        mimeType: "image/png",
      });
      if (!dataUrl) {
        return { merged: false, message: "Failed to rasterize selected layers." };
      }

      const imageFile = dataUrlToFile(dataUrl, `merged-layer-${Date.now()}.png`);
      const uploaded = await uploadEditorMediaFile(imageFile, "image");
      const nextId = replaceSelectedWithImageLayer({
        src: uploaded.url,
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
      });

      if (!nextId) {
        return { merged: false, message: "Failed to replace layers after merge." };
      }

      return { merged: true };
    } catch (error) {
      return {
        merged: false,
        message: error instanceof Error ? error.message : "Failed to merge selected layers.",
      };
    } finally {
      tempStage.destroy();
    }
  }, [activePage, elements, replaceSelectedWithImageLayer, selectedIds]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: Math.max(320, Math.round(entry.contentRect.width)),
          height: Math.max(260, Math.round(entry.contentRect.height)),
        });
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activePage) return;
    const frame = requestAnimationFrame(() => {
      fitToScreen();
    });
    return () => cancelAnimationFrame(frame);
  }, [activePage, fitToScreen]);

  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const nodes = selectedIds
      .filter((id) => id !== frameContentEditId)
      .map((id) => nodeRefs.current[id])
      .filter((node): node is Konva.Node => Boolean(node));

    transformer.nodes(nodes);
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, elements, frameContentEditId]);

  const syncTransformerVisuals = useCallback(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (typeof document === "undefined") return;

    const textFamilies = Array.from(
      new Set(
        elements
          .filter((element) => element.type === "text")
          .map((element) => String(element.fontFamily || "").trim())
          .filter(Boolean)
      )
    );
    if (textFamilies.length === 0) return;

    let cancelled = false;
    const loadFontsAndRedraw = async () => {
      if (document.fonts?.load) {
        await Promise.allSettled(
          textFamilies.map((family) => document.fonts.load(`16px "${family.replace(/"/g, '\\"')}"`))
        );
      }
      if (!cancelled) {
        stage.batchDraw();
      }
    };

    void loadFontsAndRedraw();

    const handleLoadingDone = () => stage.batchDraw();
    if (document.fonts?.addEventListener) {
      document.fonts.addEventListener("loadingdone", handleLoadingDone);
    }
    return () => {
      cancelled = true;
      if (document.fonts?.removeEventListener) {
        document.fonts.removeEventListener("loadingdone", handleLoadingDone);
      }
    };
  }, [availableFontFamilies, elements]);

  const selectionMenuPos = useMemo(() => {
    if (capturePlayheadOverrideMs !== null || previewGenerationActive) return null;
    if (selectedIds.length === 0) return null;

    const active = elements.find((element) => element.id === selectedIds[0]);
    if (!active) return null;
    if (!isElementVisibleAtPlayhead(active, effectiveActivePagePlayheadMs, activePageDurationMs)) return null;

    return {
      x: viewport.x + (active.x + active.width * 0.5) * viewport.scale,
      y: viewport.y + active.y * viewport.scale - 40,
    };
  }, [
    capturePlayheadOverrideMs,
    previewGenerationActive,
    activePageDurationMs,
    effectiveActivePagePlayheadMs,
    elements,
    selectedIds,
    viewport.scale,
    viewport.x,
    viewport.y,
  ]);

  useEffect(() => {
    setStageApi({
      zoomIn: () => zoomBy(1.12),
      zoomOut: () => zoomBy(1 / 1.12),
      fitToScreen,
      exportPng,
      captureThumbnailDataUrl,
      captureTimelineStripDataUrls,
      recordTimelinePreviewVideo,
      mergeSelectedLayers,
    });

    return () => setStageApi(null);
  }, [
    captureThumbnailDataUrl,
    captureTimelineStripDataUrls,
    recordTimelinePreviewVideo,
    exportPng,
    fitToScreen,
    mergeSelectedLayers,
    setStageApi,
    zoomBy,
  ]);

  const screenToPage = useCallback(
    (point: { x: number; y: number }) => ({
      x: (point.x - viewport.x) / viewport.scale,
      y: (point.y - viewport.y) / viewport.scale,
    }),
    [viewport.scale, viewport.x, viewport.y]
  );

  const findFrameDropTarget = useCallback(
    (point: { x: number; y: number }) => {
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = elements[index];
        if (element.type !== "frame" || element.locked || !element.visible) continue;
        if (pointIntersectsFrameBounds(element, point)) return element.id;
      }
      return "";
    },
    [elements]
  );

  const selectedFrameTargetId = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return elements.find((element) => selectedSet.has(element.id) && element.type === "frame")?.id || "";
  }, [elements, selectedIds]);

  const clearFrameDropTargetTimeout = useCallback(() => {
    if (frameDropTargetTimeoutRef.current === null) return;
    window.clearTimeout(frameDropTargetTimeoutRef.current);
    frameDropTargetTimeoutRef.current = null;
  }, []);

  const clearFrameDropTarget = useCallback(
    (resetExpired = true) => {
      clearFrameDropTargetTimeout();
      if (resetExpired) {
        expiredFrameDropTargetRef.current = "";
      }
      setFrameDropTargetId("");
    },
    [clearFrameDropTargetTimeout]
  );

  const activateFrameDropTarget = useCallback(
    (candidateId: string) => {
      const nextId = String(candidateId || "").trim();
      if (!nextId) {
        clearFrameDropTarget(true);
        return "";
      }
      if (expiredFrameDropTargetRef.current === nextId) {
        return "";
      }

      setFrameDropTargetId((currentId) => {
        if (currentId === nextId) return currentId;
        clearFrameDropTargetTimeout();
        frameDropTargetTimeoutRef.current = window.setTimeout(() => {
          expiredFrameDropTargetRef.current = nextId;
          setFrameDropTargetId((latestId) => (latestId === nextId ? "" : latestId));
          frameDropTargetTimeoutRef.current = null;
        }, 3000);
        return nextId;
      });
      return nextId;
    },
    [clearFrameDropTarget, clearFrameDropTargetTimeout]
  );

  useEffect(() => () => clearFrameDropTargetTimeout(), [clearFrameDropTargetTimeout]);

  const findFrameDropTargetForNode = useCallback(
    (element: EditorElement, node: Konva.Node) => {
      const width = Math.max(1, element.width * Math.abs(node.scaleX()));
      const height = Math.max(1, element.height * Math.abs(node.scaleY()));
      const x = node.x();
      const y = node.y();
      const testPoints = [
        { x: x + width / 2, y: y + height / 2 },
        { x, y },
        { x: x + width, y },
        { x, y: y + height },
        { x: x + width, y: y + height },
      ];
      return testPoints.map((point) => findFrameDropTarget(point)).find(Boolean) || "";
    },
    [findFrameDropTarget]
  );

  const startSelection = useCallback(
    (point: { x: number; y: number }) => {
      selectionStartRef.current = point;
      setSelectionRect({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    []
  );

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const direction = event.evt.deltaY > 0 ? -1 : 1;
      const factor = direction > 0 ? 1.08 : 1 / 1.08;
      const oldScale = viewport.scale;
      const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);

      const pointTo = {
        x: (pointer.x - viewport.x) / oldScale,
        y: (pointer.y - viewport.y) / oldScale,
      };

      updateViewport({
        x: pointer.x - pointTo.x * newScale,
        y: pointer.y - pointTo.y * newScale,
        scale: newScale,
      });
    },
    [updateViewport, viewport.scale, viewport.x, viewport.y]
  );

  const applySnapping = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>, element: EditorElement) => {
      if (!activePage) return;

      const node = event.target;
      let x = node.x();
      let y = node.y();

      const width = Math.max(2, element.width * Math.abs(node.scaleX()));
      const height = Math.max(2, element.height * Math.abs(node.scaleY()));

      const threshold = 6;
      let guideX: number | null = null;
      let guideY: number | null = null;

      const centerX = x + width / 2;
      const centerY = y + height / 2;

      if (Math.abs(centerX - activePage.width / 2) < threshold) {
        x = activePage.width / 2 - width / 2;
        guideX = activePage.width / 2;
      }
      if (Math.abs(centerY - activePage.height / 2) < threshold) {
        y = activePage.height / 2 - height / 2;
        guideY = activePage.height / 2;
      }

      if (Math.abs(x) < threshold) {
        x = 0;
        guideX = 0;
      }
      if (Math.abs(y) < threshold) {
        y = 0;
        guideY = 0;
      }

      if (Math.abs(x + width - activePage.width) < threshold) {
        x = activePage.width - width;
        guideX = activePage.width;
      }
      if (Math.abs(y + height - activePage.height) < threshold) {
        y = activePage.height - height;
        guideY = activePage.height;
      }

      node.position({ x, y });
      setSnapGuides({ x: guideX, y: guideY });
    },
    [activePage]
  );

  const updateNodeTransform = useCallback(
    (event: Konva.KonvaEventObject<Event>, element: EditorElement) => {
      const node = event.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      const nextWidth = Math.max(2, element.width * Math.abs(scaleX));
      const nextHeight = Math.max(2, element.height * Math.abs(scaleY));

      updateElement(element.id, {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: nextWidth,
        height: nextHeight,
        scaleX: scaleX < 0 ? -1 : 1,
        scaleY: scaleY < 0 ? -1 : 1,
      });

      node.scaleX(scaleX < 0 ? -1 : 1);
      node.scaleY(scaleY < 0 ? -1 : 1);
      setSnapGuides({ x: null, y: null });
    },
    [updateElement]
  );

  const updateNodeDrag = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>, element: EditorElement) => {
      applySnapping(event, element);
      if (element.type === "image" || element.type === "video") {
        activateFrameDropTarget(findFrameDropTargetForNode(element, event.target));
      }
    },
    [activateFrameDropTarget, applySnapping, findFrameDropTargetForNode]
  );

  const finishNodeDrag = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>, element: EditorElement) => {
      if (element.type === "image" || element.type === "video") {
        const candidateFrameTargetId = findFrameDropTargetForNode(element, event.target);
        const frameTargetId =
          candidateFrameTargetId && expiredFrameDropTargetRef.current !== candidateFrameTargetId
            ? candidateFrameTargetId
            : "";
        clearFrameDropTarget(true);
        if (frameTargetId) {
          const frameElement = elements.find((item) => item.id === frameTargetId && item.type === "frame");
          const renderedWidth = Math.max(1, element.width * Math.abs(event.target.scaleX()));
          const renderedHeight = Math.max(1, element.height * Math.abs(event.target.scaleY()));
          const localX = event.target.x() - (frameElement?.x || 0);
          const localY = event.target.y() - (frameElement?.y || 0);
          const offsetX = localX - (Math.max(1, frameElement?.width || 1) - renderedWidth) / 2;
          const offsetY = localY - (Math.max(1, frameElement?.height || 1) - renderedHeight) / 2;
          setFrameContent(
            frameTargetId,
            element.type === "video"
              ? {
                  kind: "video",
                  src: element.src,
                  sourceWidth: renderedWidth,
                  sourceHeight: renderedHeight,
                  videoStart: element.videoStart,
                  videoEnd: element.videoEnd,
                  videoDuration: element.videoDuration,
                }
              : {
                  kind: "image",
                  src: element.src,
                  sourceWidth: renderedWidth,
                  sourceHeight: renderedHeight,
                },
            { recordHistory: false }
          );
          updateFrameContentTransform(
            frameTargetId,
            {
              fit: "manual",
              scale: 1,
              offsetX,
              offsetY,
            },
            { recordHistory: false }
          );
          deleteElement(element.id);
          setSelectedIds([frameTargetId]);
          setSnapGuides({ x: null, y: null });
          return;
        }
      }
      updateElement(element.id, {
        x: event.target.x(),
        y: event.target.y(),
      });
      clearFrameDropTarget(true);
      setSnapGuides({ x: null, y: null });
    },
    [
      clearFrameDropTarget,
      deleteElement,
      elements,
      findFrameDropTargetForNode,
      setFrameContent,
      setSelectedIds,
      updateElement,
      updateFrameContentTransform,
    ]
  );

  const selectNode = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) => {
      event.cancelBubble = true;

      const additiveSelectionPressed = Boolean(
        ("shiftKey" in event.evt && event.evt.shiftKey) ||
          ("ctrlKey" in event.evt && event.evt.ctrlKey) ||
          ("metaKey" in event.evt && event.evt.metaKey)
      );
      if (additiveSelectionPressed) {
        if (selectedIds.includes(id)) {
          setSelectedIds(selectedIds.filter((item) => item !== id));
        } else {
          setSelectedIds([...selectedIds, id]);
        }
        return;
      }

      if (selectedIds.length === 1 && selectedIds[0] === id) return;
      setSelectedIds([id]);
    },
    [selectedIds, setSelectedIds]
  );

  const openContextMenu = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>, id: string) => {
      event.evt.preventDefault();
      if (!selectedIds.includes(id)) {
        setSelectedIds([id]);
      }
      setContextMenu({ x: event.evt.clientX, y: event.evt.clientY, targetId: id });
    },
    [selectedIds, setSelectedIds]
  );

  const beginInlineTextEdit = useCallback(
    (node: Konva.Text, element: EditorElement) => {
      const stage = stageRef.current;
      if (!stage || !containerRef.current) return;

      const textPosition = node.absolutePosition();
      const containerRect = stage.container().getBoundingClientRect();

      const areaPosition = {
        x: containerRect.left + textPosition.x,
        y: containerRect.top + textPosition.y,
      };

      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);

      textarea.value = element.text;
      textarea.style.position = "absolute";
      textarea.style.top = `${areaPosition.y}px`;
      textarea.style.left = `${areaPosition.x}px`;
      textarea.style.width = `${Math.max(80, element.width * viewport.scale)}px`;
      textarea.style.height = `${Math.max(40, element.height * viewport.scale)}px`;
      textarea.style.fontSize = `${Math.max(12, element.fontSize * viewport.scale)}px`;
      textarea.style.fontFamily = resolveCssFontFamily(element.fontFamily);
      textarea.style.fontWeight = String(element.fontWeight);
      textarea.style.fontStyle = element.fontStyle;
      textarea.style.color = element.color || element.fill;
      textarea.style.lineHeight = String(element.lineHeight);
      textarea.style.letterSpacing = `${element.letterSpacing}px`;
      textarea.style.padding = "0";
      textarea.style.margin = "0";
      textarea.style.border = "1px solid #3b82f6";
      textarea.style.background = "rgba(255,255,255,0.95)";
      textarea.style.outline = "none";
      textarea.style.resize = "none";
      textarea.style.zIndex = "9999";
      textarea.style.transformOrigin = "left top";
      textarea.style.transform = `rotate(${element.rotation}deg)`;
      textarea.style.textAlign = element.align;
      textarea.style.direction = resolveTextDirection(element.text);
      textarea.dir = resolveTextDirection(element.text);

      textarea.focus();

      let finalized = false;
      const cleanup = () => {
        textarea.removeEventListener("keydown", handleKeyDown);
        textarea.removeEventListener("blur", handleBlur);
        if (textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
      };

      const commit = () => {
        if (finalized) return;
        finalized = true;
        const next = textarea.value;
        updateElement(element.id, { text: next });
        cleanup();
      };

      const destroy = () => {
        if (finalized) return;
        finalized = true;
        cleanup();
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          destroy();
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commit();
        }
      };

      const handleBlur = () => commit();

      textarea.addEventListener("keydown", handleKeyDown);
      textarea.addEventListener("blur", handleBlur);
    },
    [updateElement, viewport.scale]
  );

  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      setContextMenu(null);

      const stage = stageRef.current;
      if (!stage) return;

      const clickedOnEmpty = event.target === stage;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const pagePoint = screenToPage(pointer);

      if (toolMode === "draw" && drawTool !== "selection") {
        setDrawPoints([pagePoint.x, pagePoint.y]);
        clearSelection();
        return;
      }

      if (!clickedOnEmpty) return;

      if (toolMode === "select") {
        startSelection(pagePoint);
      }

      const additiveSelectionPressed = Boolean(
        ("shiftKey" in event.evt && event.evt.shiftKey) ||
          ("ctrlKey" in event.evt && event.evt.ctrlKey) ||
          ("metaKey" in event.evt && event.evt.metaKey)
      );
      if (!additiveSelectionPressed) {
        clearSelection();
        setFrameContentEditId("");
      }
    },
    [clearSelection, drawTool, screenToPage, startSelection, toolMode]
  );

  const handleStageMouseMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const pagePoint = screenToPage(pointer);

    if (toolMode === "draw" && drawTool !== "selection" && drawPoints) {
      setDrawPoints((prev) => {
        if (!prev) return prev;
        return [...prev, pagePoint.x, pagePoint.y];
      });
      return;
    }

    if (!selectionRect || !selectionStartRef.current) return;

    setSelectionRect({
      x: selectionStartRef.current.x,
      y: selectionStartRef.current.y,
      width: pagePoint.x - selectionStartRef.current.x,
      height: pagePoint.y - selectionStartRef.current.y,
    });
  }, [drawPoints, drawTool, screenToPage, selectionRect, toolMode]);

  const handleStageMouseUp = useCallback(() => {
    if (toolMode === "draw" && drawTool !== "selection") {
      if (drawPoints && drawPoints.length > 4) {
        addFreehandLine(drawPoints, {
          name: drawTool === "highlighter" ? "Highlighter" : "Brush",
          type: "line",
          stroke: drawColor,
          fill: drawColor,
          strokeWidth: drawStrokeWidth,
          opacity: drawTool === "highlighter" ? Math.min(drawOpacity, 0.45) : drawOpacity,
        });
      }
      setDrawPoints(null);
      return;
    }

    if (!selectionRect) return;

    const normalized = normalizeRect(selectionRect);

    if (normalized.width < 3 || normalized.height < 3) {
      setSelectionRect(null);
      selectionStartRef.current = null;
      return;
    }

    const ids = elements
      .filter((element) => {
        const rect = {
          x: element.x,
          y: element.y,
          width: Math.max(1, element.width * Math.abs(element.scaleX)),
          height: Math.max(1, element.height * Math.abs(element.scaleY)),
        };
        return rectsIntersect(normalized, rect);
      })
      .map((item) => item.id);

    setSelectedIds(ids);
    setSelectionRect(null);
    selectionStartRef.current = null;
  }, [
    addFreehandLine,
    drawColor,
    drawOpacity,
    drawPoints,
    drawStrokeWidth,
    drawTool,
    elements,
    selectionRect,
    setSelectedIds,
    toolMode,
  ]);

  const handleDroppedAssetPayload = useCallback(
    async (raw: string, clientX: number, clientY: number) => {
      const payload = String(raw || "").trim();
      if (!payload) return;
      const stage = stageRef.current;
      if (!stage || !activePage) return;

      const rect = stage.container().getBoundingClientRect();
      const pointer = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
      const pagePoint = screenToPage(pointer);
      const candidateFrameTargetId = findFrameDropTarget(pagePoint) || selectedFrameTargetId;
      const frameTargetId =
        candidateFrameTargetId && expiredFrameDropTargetRef.current !== candidateFrameTargetId
          ? candidateFrameTargetId
          : "";

      const dropIntoFrame = (kind: "image" | "video", src: string, patch: Partial<FrameContent> = {}) => {
        const resolvedSrc = String(src || "").trim();
        if (!frameTargetId || !resolvedSrc) return false;
        setFrameContent(
          frameTargetId,
          {
            kind,
            src: resolvedSrc,
            ...patch,
          },
          { recordHistory: true }
        );
        setSelectedIds([frameTargetId]);
        return true;
      };

      try {
        const parsed = JSON.parse(payload) as {
          kind?: string;
          src?: string;
          framePresetId?: string;
          payload?: Partial<EditorElement>;
        };

        if (parsed.kind === "photo" && parsed.src) {
          if (dropIntoFrame("image", parsed.src)) return;
          addImageElement(parsed.src, {
            x: pagePoint.x - 170,
            y: pagePoint.y - 110,
            width: Math.min(activePage.width * 0.5, 420),
            height: Math.min(activePage.height * 0.45, 360),
          });
          return;
        }

        if (parsed.kind === "video" && parsed.src) {
          if (dropIntoFrame("video", parsed.src)) return;
          addVideoElement(parsed.src, {
            x: pagePoint.x - 170,
            y: pagePoint.y - 110,
            width: Math.min(activePage.width * 0.7, 960),
            height: Math.min(activePage.height * 0.5, 540),
          });
          return;
        }

        if (parsed.kind === "frame") {
          addFrameElement(parsed.framePresetId || "frame-circle", {
            x: pagePoint.x - 90,
            y: pagePoint.y - 90,
          });
          return;
        }

        if (parsed.kind === "text") {
          addTextElement(parsed.payload?.text || "Text", {
            ...(parsed.payload || {}),
            x: pagePoint.x,
            y: pagePoint.y,
          });
          return;
        }

        if (parsed.kind === "shape") {
          const payload = parsed.payload || {};
          const shapeType = (payload.type as ShapeType) || "rect";
          addShapeElement(shapeType, {
            ...payload,
            x: pagePoint.x,
            y: pagePoint.y,
          });
          return;
        }

        if (parsed.payload) {
          const next = createElementFromAsset(activePage.id, {
            ...parsed.payload,
            x: pagePoint.x,
            y: pagePoint.y,
          });

          if (next.type === "text") {
            addTextElement(next.text || "Text", next);
          } else if (next.type === "image") {
            let resolvedSrc = next.src;
            try {
              resolvedSrc = await rasterizeSvgDataUrlToPngDataUrl(next.src);
            } catch {
              // Keep the original image source if rasterization fails.
            }
            if (dropIntoFrame("image", resolvedSrc, {
              sourceWidth: next.sourceWidth,
              sourceHeight: next.sourceHeight,
            })) {
              return;
            }
            addImageElement(resolvedSrc, {
              ...next,
              src: resolvedSrc,
              rasterOriginalSrc: next.rasterOriginalSrc || resolvedSrc,
            });
          } else if (next.type === "video") {
            if (dropIntoFrame("video", next.src, {
              videoStart: next.videoStart,
              videoEnd: next.videoEnd,
              videoDuration: next.videoDuration,
              sourceWidth: next.sourceWidth,
              sourceHeight: next.sourceHeight,
            })) {
              return;
            }
            addVideoElement(next.src, next);
          } else if (next.type === "frame") {
            addFrameElement(next.frameShape?.presetId || parsed.framePresetId || "frame-circle", next);
          } else {
            addShapeElement(next.type as ShapeType, next);
          }
        }
      } catch {
        // Ignore invalid drag payloads.
      }
    },
    [
      activePage,
      addFrameElement,
      addImageElement,
      addShapeElement,
      addTextElement,
      addVideoElement,
      findFrameDropTarget,
      screenToPage,
      selectedFrameTargetId,
      setFrameContent,
      setSelectedIds,
    ]
  );

  const onDropAsset = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const raw =
        event.dataTransfer.getData("application/x-editor-asset") ||
        event.dataTransfer.getData("text/plain");
      void handleDroppedAssetPayload(raw, event.clientX, event.clientY).finally(() =>
        clearFrameDropTarget(true)
      );
    },
    [clearFrameDropTarget, handleDroppedAssetPayload]
  );

  const handleCanvasDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.container().getBoundingClientRect();
      const pagePoint = screenToPage({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      activateFrameDropTarget(findFrameDropTarget(pagePoint) || selectedFrameTargetId);
    },
    [activateFrameDropTarget, findFrameDropTarget, screenToPage, selectedFrameTargetId]
  );

  useEffect(() => {
    const stage = stageRef.current;
    const container = stage?.container();
    if (!container) return;

    const handleNativeDragOver = (event: DragEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const pagePoint = screenToPage({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      activateFrameDropTarget(findFrameDropTarget(pagePoint) || selectedFrameTargetId);
    };

    const handleNativeDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const raw =
        event.dataTransfer?.getData("application/x-editor-asset") ||
        event.dataTransfer?.getData("text/plain") ||
        "";
      void handleDroppedAssetPayload(raw, event.clientX, event.clientY).finally(() =>
        clearFrameDropTarget(true)
      );
    };

    container.addEventListener("dragover", handleNativeDragOver);
    container.addEventListener("drop", handleNativeDrop);
    return () => {
      container.removeEventListener("dragover", handleNativeDragOver);
      container.removeEventListener("drop", handleNativeDrop);
    };
  }, [
    activateFrameDropTarget,
    clearFrameDropTarget,
    findFrameDropTarget,
    handleDroppedAssetPayload,
    screenToPage,
    selectedFrameTargetId,
  ]);

  const setNodeRef = (id: string, node: Konva.Node | null) => {
    nodeRefs.current[id] = node;
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#d7d7d9]"
      onDragOver={handleCanvasDragOver}
      onDragLeave={() => clearFrameDropTarget(true)}
      onDrop={onDropAsset}
    >
      <Stage
        ref={(node) => {
          stageRef.current = node;
        }}
        width={containerSize.width}
        height={containerSize.height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={toolMode === "pan"}
        onDragEnd={(event) => {
          if (toolMode !== "pan") return;
          updateViewport({ x: event.target.x(), y: event.target.y(), scale: viewport.scale });
        }}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onTouchMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchEnd={handleStageMouseUp}
      >
        <Layer>
          <Group
            clipX={0}
            clipY={0}
            clipWidth={activePage.width}
            clipHeight={activePage.height}
            listening={false}
          >
            <Rect
              x={0}
              y={0}
              width={activePage.width}
              height={activePage.height}
              fill={
                activePage.background.type === "gradient"
                  ? undefined
                  : activePage.background.color
              }
              fillLinearGradientStartPoint={
                activePage.background.type === "gradient" ? { x: 0, y: 0 } : undefined
              }
              fillLinearGradientEndPoint={
                activePage.background.type === "gradient"
                  ? { x: activePage.width, y: activePage.height }
                  : undefined
              }
              fillLinearGradientColorStops={
                activePage.background.type === "gradient"
                  ? [0, activePage.background.gradientFrom, 1, activePage.background.gradientTo]
                  : undefined
              }
              listening={false}
            />
            {activePage.background.type === "image" && String(activePage.background.imageUri || "").trim() ? (
              <CanvasBackgroundImage
                src={String(activePage.background.imageUri || "").trim()}
                pageWidth={activePage.width}
                pageHeight={activePage.height}
              />
            ) : null}
          </Group>
          <Rect
            x={0}
            y={0}
            width={activePage.width}
            height={activePage.height}
            stroke="#d8dde5"
            strokeWidth={1}
            fillEnabled={false}
            listening={false}
          />

          <Group
            clipX={0}
            clipY={0}
            clipWidth={activePage.width}
            clipHeight={activePage.height}
          >
            {elements.map((element) => {
              if (!isElementVisibleAtPlayhead(element, effectiveActivePagePlayheadMs, activePageDurationMs)) {
                return null;
              }
              const pose = resolveAnimatedElementPose(
                element,
                effectiveActivePagePlayheadMs,
                activePageDurationMs
              );
              const isEditingFrameContent = frameContentEditId === element.id;
              const canTransform = !element.locked && toolMode !== "draw" && !isEditingFrameContent;

              const commonProps = {
                ref: (node: Konva.Node | null) => setNodeRef(element.id, node),
                id: element.id,
                x: pose.x,
                y: pose.y,
                rotation: pose.rotation,
                scaleX: pose.scaleX,
                scaleY: pose.scaleY,
                opacity: pose.opacity,
                draggable: canTransform,
                listening: canTransform,
                globalCompositeOperation: element.blendMode,
                shadowColor: element.shadowColor,
                shadowBlur: element.shadowBlur,
                shadowOffsetX: element.shadowOffsetX,
                shadowOffsetY: element.shadowOffsetY,
                onClick: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) =>
                  selectNode(event, element.id),
                onContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => openContextMenu(event, element.id),
                onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => updateNodeDrag(event, element),
                onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => finishNodeDrag(event, element),
                onTransform: syncTransformerVisuals,
                onTransformEnd: (event: Konva.KonvaEventObject<Event>) => updateNodeTransform(event, element),
              };

              if (element.type === "frame") {
                return (
                  <CanvasFrameNode
                    key={element.id}
                    element={element}
                    pose={pose}
                    canTransform={canTransform}
                    isDropTarget={frameDropTargetId === element.id}
                    isContentEditing={isEditingFrameContent}
                    playheadMs={effectiveActivePagePlayheadMs}
                    pageDurationMs={activePageDurationMs}
                    forceTimelineSync={forceTimelineMediaSync}
                    registerRef={setNodeRef}
                    onSelect={(event) => selectNode(event, element.id)}
                    onContextMenu={(event) => openContextMenu(event, element.id)}
                    onDragMove={(event) => updateNodeDrag(event, element)}
                    onDragEnd={(event) => finishNodeDrag(event, element)}
                    onTransformEnd={(event) => updateNodeTransform(event, element)}
                    onEnterContentEdit={() => {
                      if (!element.frameContent) return;
                      setSelectedIds([element.id]);
                      setFrameContentEditId(element.id);
                    }}
                    onContentTransform={(patch) =>
                      updateFrameContentTransform(element.id, patch, { recordHistory: true })
                    }
                    onContentMetadata={(patch) => {
                      if (!element.frameContent) return;
                      const nextContent = {
                        ...element.frameContent,
                        ...patch,
                      };
                      const sameSourceSize =
                        Math.round(Number(element.frameContent.sourceWidth || 0)) ===
                          Math.round(Number(nextContent.sourceWidth || 0)) &&
                        Math.round(Number(element.frameContent.sourceHeight || 0)) ===
                          Math.round(Number(nextContent.sourceHeight || 0));
                      const sameVideoDuration =
                        Math.round(Number(element.frameContent.videoDuration || 0) * 1000) ===
                        Math.round(Number(nextContent.videoDuration || 0) * 1000);
                      if (sameSourceSize && sameVideoDuration) return;
                      setFrameContent(element.id, nextContent, { recordHistory: false });
                    }}
                  />
                );
              }

              if (element.type === "image") {
                return (
                  <CanvasImageNode
                    key={element.id}
                    element={element}
                    pose={pose}
                    canTransform={canTransform}
                    playheadMs={effectiveActivePagePlayheadMs}
                    pageDurationMs={activePageDurationMs}
                    forceTimelineSync={forceTimelineMediaSync}
                    registerRef={setNodeRef}
                    onSelect={(event) => selectNode(event, element.id)}
                    onContextMenu={(event) => openContextMenu(event, element.id)}
                    onDragMove={(event) => updateNodeDrag(event, element)}
                    onDragEnd={(event) => finishNodeDrag(event, element)}
                    onTransformEnd={(event) => updateNodeTransform(event, element)}
                    onImageMetadata={({ width, height }) => {
                      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
                      const nextWidth = Math.max(1, Math.round(width));
                      const nextHeight = Math.max(1, Math.round(height));
                      const currentWidth = Math.max(0, Math.round(Number(element.sourceWidth || 0)));
                      const currentHeight = Math.max(0, Math.round(Number(element.sourceHeight || 0)));
                      if (currentWidth === nextWidth && currentHeight === nextHeight) return;
                      updateElement(
                        element.id,
                        {
                          sourceWidth: nextWidth,
                          sourceHeight: nextHeight,
                          cropX: Number.isFinite(Number(element.cropX)) ? element.cropX : 0,
                          cropY: Number.isFinite(Number(element.cropY)) ? element.cropY : 0,
                          cropWidth:
                            Number.isFinite(Number(element.cropWidth)) && Number(element.cropWidth) > 0
                              ? element.cropWidth
                              : nextWidth,
                          cropHeight:
                            Number.isFinite(Number(element.cropHeight)) && Number(element.cropHeight) > 0
                              ? element.cropHeight
                              : nextHeight,
                        },
                        { recordHistory: false }
                      );
                    }}
                  />
                );
              }

              if (element.type === "video") {
                return (
                  <CanvasVideoNode
                    key={element.id}
                    element={element}
                    pose={pose}
                    canTransform={canTransform}
                    playheadMs={effectiveActivePagePlayheadMs}
                    pageDurationMs={activePageDurationMs}
                    forceTimelineSync={forceTimelineMediaSync}
                    registerRef={setNodeRef}
                    onSelect={(event) => selectNode(event, element.id)}
                    onContextMenu={(event) => openContextMenu(event, element.id)}
                    onDragMove={(event) => updateNodeDrag(event, element)}
                    onDragEnd={(event) => finishNodeDrag(event, element)}
                    onTransformEnd={(event) => updateNodeTransform(event, element)}
                    onVideoMetadata={({ duration }) => {
                      if (!Number.isFinite(duration) || duration <= 0) return;
                      const nextDuration = Math.round(duration * 1000) / 1000;
                      const currentDuration = Math.round((element.videoDuration || 0) * 1000) / 1000;
                      if (currentDuration === nextDuration) return;
                      const rawVideoEnd = Number(element.videoEnd);
                      updateElement(
                        element.id,
                        {
                          videoDuration: nextDuration,
                          videoEnd:
                            Number.isFinite(rawVideoEnd) && rawVideoEnd > 0
                              ? Math.min(rawVideoEnd, nextDuration)
                              : nextDuration,
                        },
                        { recordHistory: false }
                      );
                    }}
                  />
                );
              }

              if (element.type === "text") {
                const konvaFontStyle = toKonvaFontStyle(element.fontStyle, element.fontWeight);
                const direction = resolveTextDirection(element.text);
                return (
                  <Text
                    key={element.id}
                    {...commonProps}
                    width={element.width}
                    height={element.height}
                    text={element.text}
                    fill={element.color || element.fill}
                    fontSize={element.fontSize}
                    fontFamily={resolveCssFontFamily(element.fontFamily)}
                    fontStyle={konvaFontStyle}
                    fontVariant="normal"
                    lineHeight={element.lineHeight}
                    align={element.align}
                    direction={direction}
                    letterSpacing={element.letterSpacing}
                    textDecoration={element.textDecoration}
                    onDblClick={(event) => beginInlineTextEdit(event.target as Konva.Text, element)}
                    onDblTap={(event) => beginInlineTextEdit(event.target as Konva.Text, element)}
                  />
                );
              }

              if (element.type === "circle") {
                return (
                  <Circle
                    key={element.id}
                    {...commonProps}
                    radius={Math.max(4, Math.min(element.width, element.height) / 2)}
                    fill={element.fill}
                    stroke={element.stroke}
                    strokeWidth={element.strokeWidth}
                  />
                );
              }

              if (element.type === "line") {
                return (
                  <Line
                    key={element.id}
                    {...commonProps}
                    points={element.points.length > 2 ? element.points : [0, 0, element.width, element.height]}
                    stroke={element.stroke || element.fill}
                    strokeWidth={Math.max(1, element.strokeWidth || 4)}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.2}
                  />
                );
              }

              if (element.type === "arrow") {
                return (
                  <Arrow
                    key={element.id}
                    {...commonProps}
                    points={element.points.length > 2 ? element.points : [0, 0, element.width, element.height]}
                    fill={element.fill}
                    stroke={element.stroke || element.fill}
                    strokeWidth={Math.max(1, element.strokeWidth || 5)}
                    pointerLength={14}
                    pointerWidth={14}
                  />
                );
              }

              if (element.type === "star") {
                return (
                  <Star
                    key={element.id}
                    {...commonProps}
                    numPoints={5}
                    innerRadius={Math.max(6, Math.min(element.width, element.height) * 0.2)}
                    outerRadius={Math.max(12, Math.min(element.width, element.height) * 0.5)}
                    fill={element.fill}
                    stroke={element.stroke}
                    strokeWidth={element.strokeWidth}
                  />
                );
              }

              return (
                <Rect
                  key={element.id}
                  {...commonProps}
                  width={element.width}
                  height={element.height}
                  fill={element.fill}
                  stroke={element.stroke}
                  strokeWidth={element.strokeWidth}
                  cornerRadius={element.cornerRadius || 0}
                />
              );
            })}

            {drawPoints && drawPoints.length > 2 ? (
              <Line
                points={drawPoints}
                stroke={drawColor}
                opacity={drawTool === "highlighter" ? Math.min(drawOpacity, 0.45) : drawOpacity}
                strokeWidth={drawStrokeWidth}
                lineCap="round"
                lineJoin="round"
                tension={0.2}
              />
            ) : null}
          </Group>

          {selectionRect ? (
            <Rect
              x={selectionRect.x}
              y={selectionRect.y}
              width={selectionRect.width}
              height={selectionRect.height}
              fill="rgba(59, 130, 246, 0.15)"
              stroke="#3b82f6"
              strokeWidth={1 / viewport.scale}
              dash={[6 / viewport.scale, 6 / viewport.scale]}
              listening={false}
            />
          ) : null}

          {snapGuides.x !== null ? (
            <Line
              points={[snapGuides.x, 0, snapGuides.x, activePage.height]}
              stroke="#3b82f6"
              strokeWidth={1 / viewport.scale}
              dash={[6 / viewport.scale, 6 / viewport.scale]}
              listening={false}
            />
          ) : null}

          {snapGuides.y !== null ? (
            <Line
              points={[0, snapGuides.y, activePage.width, snapGuides.y]}
              stroke="#3b82f6"
              strokeWidth={1 / viewport.scale}
              dash={[6 / viewport.scale, 6 / viewport.scale]}
              listening={false}
            />
          ) : null}

          <Transformer
            ref={(node) => {
              transformerRef.current = node;
            }}
            rotateEnabled
            flipEnabled={false}
            enabledAnchors={[
              "top-left",
              "top-center",
              "top-right",
              "middle-left",
              "middle-right",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ]}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox;
              }
              return newBox;
            }}
          />
        </Layer>
      </Stage>

      {previewGenerationActive || capturePlayheadOverrideMs !== null ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#d7d7d9]/78 backdrop-blur-[1px]">
          <div className="rounded-2xl border border-white/80 bg-white/92 px-5 py-3 text-center shadow-lg">
            <div className="text-sm font-semibold text-[#111827]">Generating preview</div>
            <div className="mt-1 text-xs text-[#6b7280]">Please wait while the template preview is rendered.</div>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="absolute z-30 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              if (!selectedIds.includes(contextMenu.targetId)) {
                setSelectedIds([contextMenu.targetId]);
              }
              requestAnimationFrame(() => duplicateSelected());
              setContextMenu(null);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              moveLayer(contextMenu.targetId, "front");
              setContextMenu(null);
            }}
          >
            Bring to front
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              moveLayer(contextMenu.targetId, "back");
              setContextMenu(null);
            }}
          >
            Send to back
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => {
              if (!selectedIds.includes(contextMenu.targetId)) {
                setSelectedIds([contextMenu.targetId]);
              }
              requestAnimationFrame(() => deleteSelected());
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
      {selectionMenuPos ? (
        <div
          className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-[#d0d7e1] bg-white px-2 py-1 text-[#304055] shadow"
          style={{ left: selectionMenuPos.x, top: selectionMenuPos.y }}
        >
          <button type="button" className="rounded p-1 hover:bg-[#eef3f8]" onClick={duplicateSelected}>
            <Copy size={14} />
          </button>
          <button type="button" className="rounded p-1 hover:bg-[#eef3f8]" onClick={deleteSelected}>
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-[13px] hover:bg-[#eef3f8]"
            onClick={() => setShowRightSidebar(true)}
          >
            <SlidersHorizontal size={14} /> Properties
          </button>
        </div>
      ) : null}
    </div>
  );
}
