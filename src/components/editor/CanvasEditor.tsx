"use client";

import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Konva from "konva";
import useImage from "use-image";
import { Minus, Plus } from "lucide-react";
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
  TextPath,
  Transformer,
} from "react-konva";

import {
  createElementFromAsset,
  resolveCornerRadiusList,
  useEditorStore,
  type EditorElement,
  type EditorPage,
  type ShapeType,
  type ToolMode,
} from "@/store/editorStore";
import {
  DEFAULT_FRAME_CONTENT_TRANSFORM,
  pointIntersectsFrameBounds,
  resolveFrameContentLayout,
  resolveFramePreset,
  type FrameContent,
  type FrameContentTransform,
  type FramePreset,
} from "@/lib/editor/frames";
import {
  normalizeRasterColorMap,
  recolorRasterSourceToDataUrl,
  recolorSvgSource,
  serializeRasterColorMap,
} from "@/lib/editor/imagePalette";
import {
  buildTrimmedShapeSvgDataUrl,
  isSvgDataUrlSource,
  rasterizeSvgDataUrlToPngDataUrl,
  SVG_SHAPE_RASTER_SCALE,
} from "@/lib/editor/imageCrop";
import { dataUrlToFile, uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import {
  frameToSampleTimeMs,
  getDurationFrames,
  getFrameAlignedPlayheadFrame,
  getPlayheadMsForFrame,
  resolveAnimatedElementPoseAtFrame,
  resolveAnimatedElementEffectsAtFrame,
  resolvePreviewRenderFps,
  resolveVideoSourceTimeAtFrame,
  type ElementRenderPose,
} from "@/lib/editor/previewRuntime";
import { drawRevealClip, type ClipMask } from "@/lib/editor/animationClip";
import { resolveTextStrokeWidthPx } from "@/lib/editor/textStroke";
import {
  clearTextBoxMeasurementCache,
  resolveSnugTextBox,
  textBoxAnchorDeltaX,
  type TextBoxInput,
} from "@/lib/editor/textBox";
import {
  revealFraction,
  glyphVisual,
  splitWordsForMotion,
  layoutWordsSingleLine,
} from "@/lib/editor/animationGlyph";
import { resolveCssFontFamily } from "@/lib/templates/fontCatalog";
import {
  getPageDurationMs,
  getTimelinePageEntries,
  isElementVisibleAtPlayhead,
  resolveTimelineWindow,
} from "@/lib/editor/animationTimeline";

interface PreviewMediaController {
  syncToFrame: (frame: number, fps: number) => Promise<void>;
}

interface ImageNodeProps {
  element: EditorElement;
  pose: ElementRenderPose;
  interactive: boolean;
  canTransform: boolean;
  playheadFrame?: number;
  previewFps?: number;
  pageDurationMs?: number;
  forceTimelineSync?: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (event: Konva.KonvaEventObject<Event>) => void;
  registerRef: (id: string, node: Konva.Node | null) => void;
  registerPreviewMediaController?: (id: string, controller: PreviewMediaController | null) => void;
  onImageMetadata?: (meta: { width: number; height: number }) => void;
  /**
   * Fired once the node's bitmap is decoded and drawable. A blurred layer is rendered through a
   * Konva cache, and an image finishing loading does NOT re-render the parent scene (metadata
   * updates early-return when the dimensions already match), so without this the cache would be
   * taken while the node was still empty and stay blank.
   */
  onContentReady?: () => void;
  onVideoMetadata?: (meta: { duration: number }) => void;
}

/**
 * Measures each word's advance width with an offscreen 2D context, so the per-word ASCEND /
 * ONE_WORD renderer can lay words out (layoutWordsSingleLine). Konva applies letterSpacing
 * between characters, which measureText doesn't, so it's added back approximately. One shared
 * canvas — measurement is synchronous and cheap.
 */
let sharedMeasureCtx: CanvasRenderingContext2D | null = null;
function measureWordAdvances(
  words: string[],
  fontCss: string,
  letterSpacing: number
): { widths: number[]; spaceWidth: number } {
  if (!sharedMeasureCtx && typeof document !== "undefined") {
    sharedMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  const ctx = sharedMeasureCtx;
  if (!ctx) {
    // SSR / no canvas: fall back to a rough per-char estimate so layout is still finite.
    const est = (w: string) => w.length * 0.55 * (Number(fontCss.match(/(\d+)px/)?.[1]) || 16);
    return { widths: words.map(est), spaceWidth: 0.3 * (Number(fontCss.match(/(\d+)px/)?.[1]) || 16) };
  }
  ctx.font = fontCss;
  const ls = Number.isFinite(letterSpacing) ? letterSpacing : 0;
  const widths = words.map((w) => ctx.measureText(w).width + ls * Math.max(0, w.length - 1));
  return { widths, spaceWidth: ctx.measureText(" ").width + ls };
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

function getPreviewRenderSpec(page: EditorPage | null | undefined, maxDimension = 720) {
  const pageWidth = Math.max(1, Number(page?.width) || 1);
  const pageHeight = Math.max(1, Number(page?.height) || 1);
  const safeMaxDimension = Math.max(120, Math.round(Number(maxDimension) || 720));
  const scale = Math.min(1, safeMaxDimension / Math.max(pageWidth, pageHeight));
  return {
    width: Math.max(1, Math.round(pageWidth * scale)),
    height: Math.max(1, Math.round(pageHeight * scale)),
    scale,
  };
}

function getSupportedPreviewRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function createAbortError(message: string) {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isDrawableMediaReady(media: unknown) {
  if (typeof HTMLImageElement !== "undefined" && media instanceof HTMLImageElement) {
    return media.complete && media.naturalWidth > 0 && media.naturalHeight > 0;
  }
  if (typeof HTMLVideoElement !== "undefined" && media instanceof HTMLVideoElement) {
    return media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && media.videoWidth > 0 && media.videoHeight > 0;
  }
  if (typeof HTMLCanvasElement !== "undefined" && media instanceof HTMLCanvasElement) {
    return media.width > 0 && media.height > 0;
  }
  return Boolean(media);
}

async function waitForStageDrawableMedia(stage: Konva.Stage, timeoutMs = 3000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const media = stage
      .find("Image")
      .map((node) => {
        const imageGetter = (node as { image?: () => unknown }).image;
        return typeof imageGetter === "function" ? imageGetter.call(node) : null;
      });

    if (media.length === 0 || media.every(isDrawableMediaReady)) {
      const drawableMedia = media.filter(Boolean);
      await Promise.all(
        drawableMedia.map((item) =>
          typeof HTMLImageElement !== "undefined" &&
          item instanceof HTMLImageElement &&
          typeof item.decode === "function"
            ? item.decode().catch(() => undefined)
            : Promise.resolve()
        )
      );
      return;
    }

    await waitForAnimationFrame();
  }
}

async function syncVideoElementToTime(
  media: HTMLVideoElement,
  targetTime: number,
  tolerance = 0.02
) {
  const safeTargetTime = Math.max(0, Number(targetTime) || 0);
  if (Math.abs(media.currentTime - safeTargetTime) <= tolerance) {
    media.pause();
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId = 0;
    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      media.removeEventListener("seeked", handleSettled);
      media.removeEventListener("canplay", handleSettled);
      media.removeEventListener("loadeddata", handleSettled);
      media.removeEventListener("error", handleSettled);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const handleSettled = () => finish();

    timeoutId = window.setTimeout(finish, 180);
    media.addEventListener("seeked", handleSettled);
    media.addEventListener("canplay", handleSettled);
    media.addEventListener("loadeddata", handleSettled);
    media.addEventListener("error", handleSettled);

    try {
      media.pause();
      media.currentTime = safeTargetTime;
      if (Math.abs(media.currentTime - safeTargetTime) <= tolerance) {
        finish();
      }
    } catch {
      finish();
    }
  });
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

// Builds a hit-area mask that follows the image's non-transparent pixels, as a
// list of local-space rects ([x, y, w, h]) — one per run of opaque pixels on
// each scanned row. Used so that clicking a visible part of a layer always
// selects it, while clicks on genuinely transparent gaps fall through to the
// layers behind. Returns null when the image is essentially solid (use the full
// bounding box) or when pixels can't be read (CORS-tainted) — both fall back to
// the bounding box so the layer is never un-clickable.
function computeAlphaHitRects(
  element: EditorElement,
  sourceImage: HTMLImageElement | null | undefined,
  crop: { x: number; y: number; width: number; height: number } | undefined
): number[][] | null {
  if (!sourceImage || typeof document === "undefined") return null;
  const renderedWidth = Math.max(1, Number(element.width) || 1);
  const renderedHeight = Math.max(1, Number(element.height) || 1);
  const sourceWidth = Math.max(1, Number(sourceImage.naturalWidth || sourceImage.width || renderedWidth));
  const sourceHeight = Math.max(1, Number(sourceImage.naturalHeight || sourceImage.height || renderedHeight));
  const cropX = Math.max(0, Number(crop?.x) || 0);
  const cropY = Math.max(0, Number(crop?.y) || 0);
  const cropWidth = Math.max(1, Number(crop?.width) || sourceWidth);
  const cropHeight = Math.max(1, Number(crop?.height) || sourceHeight);
  const scanScale = Math.min(1, 220 / Math.max(cropWidth, cropHeight));
  const scanWidth = Math.max(8, Math.round(cropWidth * scanScale));
  const scanHeight = Math.max(8, Math.round(cropHeight * scanScale));
  const canvas = document.createElement("canvas");
  canvas.width = scanWidth;
  canvas.height = scanHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    context.clearRect(0, 0, scanWidth, scanHeight);
    context.drawImage(sourceImage, cropX, cropY, cropWidth, cropHeight, 0, 0, scanWidth, scanHeight);
    const pixels = context.getImageData(0, 0, scanWidth, scanHeight).data;

    const cellW = renderedWidth / scanWidth;
    const cellH = renderedHeight / scanHeight;
    // Dilate the hit mask outward from the opaque pixels so sparse/thin art
    // (calligraphy, line art, scattered glyphs) is selectable by clicking on OR
    // near a stroke — not only on the exact 1–2px the stroke occupies. Without
    // this, the wide transparent gaps between strokes make the layer feel
    // unclickable (clicks fall through to whatever is behind). Empty margins of
    // the bounding box, further than `pad` from any stroke, still fall through.
    const antiAliasPad = Math.max(cellW, cellH) * 0.75; // cover antialiased seams
    const dilatePad = Math.min(30, Math.max(8, Math.max(renderedWidth, renderedHeight) * 0.05));
    const pad = Math.max(antiAliasPad, dilatePad);

    const rects: number[][] = [];
    let opaquePixels = 0;
    let opaqueRows = 0;

    for (let y = 0; y < scanHeight; y += 1) {
      let runStart = -1;
      let rowHadOpaque = false;
      for (let x = 0; x < scanWidth; x += 1) {
        const opaque = pixels[(y * scanWidth + x) * 4 + 3] >= 16;
        if (opaque) {
          opaquePixels += 1;
          rowHadOpaque = true;
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          rects.push([runStart * cellW - pad, y * cellH - pad, (x - runStart) * cellW + pad * 2, cellH + pad * 2]);
          runStart = -1;
        }
      }
      if (runStart >= 0) {
        rects.push([runStart * cellW - pad, y * cellH - pad, (scanWidth - runStart) * cellW + pad * 2, cellH + pad * 2]);
      }
      if (rowHadOpaque) opaqueRows += 1;
    }

    if (opaqueRows < 4 || rects.length === 0) return null;
    // Essentially solid → the bounding box is the same hit area and far cheaper.
    if (opaquePixels / (scanWidth * scanHeight) >= 0.92) return null;

    return rects;
  } catch {
    return null;
  }
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

function CanvasBackgroundImageImpl({
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

function CanvasImageNodeImpl({
  element,
  pose,
  interactive,
  canTransform,
  onSelect,
  onContextMenu,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  registerRef,
  onImageMetadata,
  onContentReady,
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
  // Built-in shapes carry their original SVG in `vectorSrc` (cropped to content). Render that SVG
  // live so Konva re-rasterizes it crisply at any zoom/scale instead of upscaling the fixed-
  // resolution baked PNG. A recolor is applied to the SVG's colors (same palette maths as the
  // raster path) rather than falling back to the raster PNG, so recolored shapes stay crisp too.
  const vectorShapeSource = useMemo(() => {
    const source = String(element.vectorSrc || "").trim();
    if (!source || !isSvgDataUrlSource(source)) return "";
    // Derive a content-cropped, high-resolution vector from the RAW shape SVG + the layer's crop.
    // An SVG <img> rasterizes at its intrinsic width/height, so the raw ~120px shape would blur
    // when enlarged; this rewrites it to a large intrinsic (crisp) and crops the viewBox to the
    // shape's content (fills the trimmed box with no distortion). Works for any stored shape.
    const trimmed = buildTrimmedShapeSvgDataUrl(source, {
      cropX: element.cropX,
      cropY: element.cropY,
      cropWidth: element.cropWidth,
      cropHeight: element.cropHeight,
      sourceWidth: element.sourceWidth,
      sourceHeight: element.sourceHeight,
    });
    if (!trimmed) return "";
    // Apply an active palette recolor directly to the SVG's fills (identical distance/HSL maths as
    // the raster recolor, so it looks the same) — a no-op when nothing is remapped.
    return recolorSvgSource(trimmed, normalizedRasterPalette, normalizedRasterColorMap);
  }, [
    element.vectorSrc,
    element.cropX,
    element.cropY,
    element.cropWidth,
    element.cropHeight,
    element.sourceWidth,
    element.sourceHeight,
    normalizedRasterPalette,
    normalizedRasterColorMap,
  ]);
  // Any shape carrying a `vectorSrc` renders as a live vector — including recolored ones, whose
  // recolor is baked into `vectorShapeSource` above. The raster recolor path below is only for
  // non-shape images (photos) that have no vector source.
  const canRenderVectorShape = Boolean(vectorShapeSource);
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
    if (canRenderVectorShape) return vectorShapeSource;
    if (shouldRecolorRaster) {
      if (recoloredEntry.key === recolorRequestKey && recoloredEntry.src) {
        return recoloredEntry.src;
      }
      return baseRasterSource || String(element.src || "");
    }
    return String(element.src || "");
  }, [
    baseRasterSource,
    canRenderVectorShape,
    element.src,
    recolorRequestKey,
    recoloredEntry,
    shouldRecolorRaster,
    vectorShapeSource,
  ]);
  const [image] = useImage(resolvedSource, "anonymous");
  const imageRef = useRef<Konva.Image | null>(null);
  const onImageMetadataRef = useRef(onImageMetadata);
  const isGif = useMemo(() => isGifSource(resolvedSource), [resolvedSource]);

  useEffect(() => {
    // Vector shapes recolor their SVG directly (see `vectorShapeSource`); skip the PNG remap.
    if (!shouldRecolorRaster || canRenderVectorShape) return;
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
    canRenderVectorShape,
    normalizedRasterColorMap,
    normalizedRasterPalette,
    recolorRequestKey,
    shouldRecolorRaster,
  ]);

  useEffect(() => {
    onImageMetadataRef.current = onImageMetadata;
  }, [onImageMetadata]);

  useEffect(() => {
    // A vector shape renders from its SVG, whose intrinsic size is tiny and unrelated to the baked
    // raster's sourceWidth/Height (which the recolor crop depends on) — don't let it clobber that.
    if (canRenderVectorShape) return;
    const naturalWidth = Number(image?.naturalWidth || 0);
    const naturalHeight = Number(image?.naturalHeight || 0);
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    onImageMetadataRef.current?.({ width: naturalWidth, height: naturalHeight });
  }, [image, canRenderVectorShape]);

  const onContentReadyRef = useRef(onContentReady);
  useEffect(() => {
    onContentReadyRef.current = onContentReady;
  }, [onContentReady]);
  useEffect(() => {
    // Tell the scene the bitmap is drawable so a blurred layer re-takes its Konva cache; without
    // this the cache can be captured while the image is still loading and stay blank.
    if (!image) return;
    onContentReadyRef.current?.();
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

  const crop = useMemo(
    () => (canRenderVectorShape ? undefined : resolveKonvaImageCrop(element, image || undefined)),
    [canRenderVectorShape, element, image]
  );
  const alphaHitRects = useMemo(
    () => computeAlphaHitRects(element, image || undefined, crop),
    [crop, element, image]
  );

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
      listening={interactive}
      globalCompositeOperation={element.blendMode}
      cornerRadius={resolveCornerRadiusList(element.cornerRadius, element.cornerRadiusCorners)}
      stroke={Number(element.strokeWidth) > 0 ? element.stroke : undefined}
      strokeWidth={Number(element.strokeWidth) > 0 ? Number(element.strokeWidth) : 0}
      strokeScaleEnabled={false}
      shadowColor={element.shadowColor}
      shadowBlur={element.shadowBlur}
      shadowOffsetX={element.shadowOffsetX}
      shadowOffsetY={element.shadowOffsetY}
      crop={crop}
      hitFunc={(context, shape) => {
        // Hit only the non-transparent pixels (alpha mask) so any visible part of
        // the layer is directly selectable, while clicks on genuinely transparent
        // gaps fall through to the layer visible behind. This holds whether or not
        // the layer is selected, so a selected (e.g. full-canvas) layer never traps
        // clicks meant for the layers showing through its transparent regions.
        if (alphaHitRects) {
          context.beginPath();
          for (const [rx, ry, rw, rh] of alphaHitRects) {
            context.rect(rx, ry, rw, rh);
          }
          context.closePath();
          context.fillStrokeShape(shape);
          return;
        }
        context.beginPath();
        context.rect(0, 0, Math.max(1, Number(element.width) || 1), Math.max(1, Number(element.height) || 1));
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={onContextMenu}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

function CanvasVideoNodeImpl({
  element,
  pose,
  interactive,
  canTransform,
  playheadFrame = 0,
  previewFps = 60,
  pageDurationMs = 0,
  forceTimelineSync = false,
  onSelect,
  onContextMenu,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  registerRef,
  registerPreviewMediaController,
  onVideoMetadata,
}: ImageNodeProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRef = useRef<Konva.Shape | null>(null);
  const onMetadataRef = useRef(onVideoMetadata);
  const forceTimelineSyncRef = useRef(forceTimelineSync);

  useEffect(() => {
    forceTimelineSyncRef.current = forceTimelineSync;
  }, [forceTimelineSync]);

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
      if (!forceTimelineSyncRef.current) {
        void htmlVideo.play().catch(() => undefined);
      }
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

  const syncVideoToFrame = useCallback(
    async (frame: number, fps: number) => {
      const media = videoRef.current;
      if (!media) return;
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
      const targetTime = resolveVideoSourceTimeAtFrame({
        frame,
        fps,
        layerStartMs: layerWindow.startMs,
        sourceStart,
        sourceEnd,
      });
      await syncVideoElementToTime(media, targetTime, Math.max(0.012, 1 / Math.max(12, fps)));
      media.pause();
      mediaRef.current?.getLayer()?.batchDraw();
    },
    [element, pageDurationMs]
  );

  useEffect(() => {
    if (!registerPreviewMediaController) return undefined;
    registerPreviewMediaController(element.id, {
      syncToFrame: syncVideoToFrame,
    });
    return () => registerPreviewMediaController(element.id, null);
  }, [element.id, registerPreviewMediaController, syncVideoToFrame]);

  useEffect(() => {
    if (!forceTimelineSync) return;
    void syncVideoToFrame(playheadFrame, previewFps);
  }, [forceTimelineSync, playheadFrame, previewFps, syncVideoToFrame]);

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
      listening={interactive}
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
      stroke={Number(element.strokeWidth) > 0 ? element.stroke : undefined}
      strokeWidth={Number(element.strokeWidth) > 0 ? Number(element.strokeWidth) : 0}
      strokeScaleEnabled={false}
      sceneFunc={(context, shape) => {
        const resolved = resolveCornerRadiusList(element.cornerRadius, element.cornerRadiusCorners);
        const [rTL, rTR, rBR, rBL] = Array.isArray(resolved)
          ? resolved
          : [resolved, resolved, resolved, resolved];
        const hasRadius = rTL > 0 || rTR > 0 || rBR > 0 || rBL > 0;
        const buildPath = () => {
          context.beginPath();
          if (hasRadius) {
            context.moveTo(rTL, 0);
            context.lineTo(element.width - rTR, 0);
            context.quadraticCurveTo(element.width, 0, element.width, rTR);
            context.lineTo(element.width, element.height - rBR);
            context.quadraticCurveTo(element.width, element.height, element.width - rBR, element.height);
            context.lineTo(rBL, element.height);
            context.quadraticCurveTo(0, element.height, 0, element.height - rBL);
            context.lineTo(0, rTL);
            context.quadraticCurveTo(0, 0, rTL, 0);
          } else {
            context.rect(0, 0, element.width, element.height);
          }
          context.closePath();
        };
        // Border first (on the rounded-rect path), then clip + draw the media on top — matches
        // Konva.Image's native cornerRadius+stroke ordering so image and video borders look identical.
        buildPath();
        context.fillStrokeShape(shape);
        buildPath();
        context.clip();
        if (video) {
          context.drawImage(video, 0, 0, element.width, element.height);
        } else {
          context.fillStyle = "rgba(255,255,255,0.001)";
          context.fillRect(0, 0, element.width, element.height);
        }
      }}
    />
  );
}

interface FrameNodeProps {
  element: EditorElement;
  pose: ElementRenderPose;
  interactive: boolean;
  canTransform: boolean;
  isDropTarget: boolean;
  isContentEditing: boolean;
  playheadFrame: number;
  previewFps: number;
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
  registerPreviewMediaController: (id: string, controller: PreviewMediaController | null) => void;
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

function CanvasFrameNodeImpl({
  element,
  pose,
  interactive,
  canTransform,
  isDropTarget,
  isContentEditing,
  playheadFrame,
  previewFps,
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
  registerPreviewMediaController,
}: FrameNodeProps) {
  const frameContent = element.frameContent || null;
  const preset = useMemo(() => {
    const basePreset = resolveFramePreset(element.frameShape?.presetId);
    const shape = element.frameShape;
    if (!shape) return basePreset;
    return {
      ...basePreset,
      kind: shape.kind || basePreset.kind,
      ...(Array.isArray(shape.points) && shape.points.length >= 6
        ? { points: [...shape.points] }
        : {}),
      ...(Number.isFinite(Number(shape.cornerRadius))
        ? { cornerRadius: Number(shape.cornerRadius) }
        : {}),
    };
  }, [element.frameShape]);
  const transform = element.frameContentTransform || DEFAULT_FRAME_CONTENT_TRANSFORM;
  const [image] = useImage(frameContent?.kind === "image" ? frameContent.src : "", "anonymous");
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameGroupRef = useRef<Konva.Group | null>(null);
  const mediaRef = useRef<Konva.Image | null>(null);
  const dropFeedbackRef = useRef<Konva.Group | null>(null);
  const metadataRef = useRef(onContentMetadata);
  const forceTimelineSyncRef = useRef(forceTimelineSync);

  useEffect(() => {
    forceTimelineSyncRef.current = forceTimelineSync;
  }, [forceTimelineSync]);

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
      if (!forceTimelineSyncRef.current) {
        void htmlVideo.play().catch(() => undefined);
      }
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

  const syncFrameContentVideoToFrame = useCallback(
    async (frame: number, fps: number) => {
      const media = videoRef.current;
      if (!media || frameContent?.kind !== "video") return;
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
      const targetTime = resolveVideoSourceTimeAtFrame({
        frame,
        fps,
        layerStartMs: layerWindow.startMs,
        sourceStart,
        sourceEnd,
      });
      await syncVideoElementToTime(media, targetTime, Math.max(0.012, 1 / Math.max(12, fps)));
      media.pause();
      mediaRef.current?.getLayer()?.batchDraw();
    },
    [element, frameContent, pageDurationMs]
  );

  useEffect(() => {
    if (!registerPreviewMediaController) return undefined;
    if (frameContent?.kind !== "video") {
      registerPreviewMediaController(element.id, null);
      return undefined;
    }
    registerPreviewMediaController(element.id, {
      syncToFrame: syncFrameContentVideoToFrame,
    });
    return () => registerPreviewMediaController(element.id, null);
  }, [
    element.id,
    frameContent?.kind,
    registerPreviewMediaController,
    syncFrameContentVideoToFrame,
  ]);

  useEffect(() => {
    if (!forceTimelineSync || frameContent?.kind !== "video") return;
    void syncFrameContentVideoToFrame(playheadFrame, previewFps);
  }, [
    forceTimelineSync,
    frameContent?.kind,
    playheadFrame,
    previewFps,
    syncFrameContentVideoToFrame,
  ]);

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
      listening={interactive || isContentEditing}
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
        fill={frameContent ? "rgba(255,255,255,0.001)" : element.fill || "#eaf6ff"}
        sceneFunc={(context, shape) => {
          drawFramePath(context, preset, element.width, element.height);
          context.fillStrokeShape(shape);
        }}
        // The frame group itself has no hit area, so this masked fill is the click/drag target.
        listening={interactive || isContentEditing}
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

interface CanvasPageSceneProps {
  page: EditorPage;
  elements: EditorElement[];
  selectedIds?: string[];
  pageDurationMs: number;
  playheadMs: number;
  playheadFrame: number;
  previewFps: number;
  forceTimelineSync: boolean;
  interactive: boolean;
  toolMode: ToolMode;
  frameDropTargetId?: string;
  frameContentEditId?: string;
  includePageOutline?: boolean;
  registerRef?: (id: string, node: Konva.Node | null) => void;
  registerPreviewMediaController?: (id: string, controller: PreviewMediaController | null) => void;
  onSelectNode?: (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
    id: string
  ) => void;
  onOpenContextMenu?: (
    event: Konva.KonvaEventObject<PointerEvent>,
    id: string
  ) => void;
  onNodeDragMove?: (
    event: Konva.KonvaEventObject<DragEvent>,
    element: EditorElement
  ) => void;
  onNodeDragEnd?: (
    event: Konva.KonvaEventObject<DragEvent>,
    element: EditorElement
  ) => void;
  onNodeTransform?: () => void;
  onNodeTransformEnd?: (
    event: Konva.KonvaEventObject<Event>,
    element: EditorElement
  ) => void;
  onEnterFrameContentEdit?: (element: EditorElement) => void;
  onUpdateFrameContentTransform?: (
    element: EditorElement,
    patch: { scale?: number; offsetX?: number; offsetY?: number }
  ) => void;
  onUpdateFrameContentMetadata?: (element: EditorElement, patch: Partial<FrameContent>) => void;
  onUpdateImageMetadata?: (element: EditorElement, meta: { width: number; height: number }) => void;
  onUpdateVideoMetadata?: (element: EditorElement, meta: { duration: number }) => void;
  onBeginInlineTextEdit?: (node: Konva.Node, element: EditorElement) => void;
}

/** Stable per-element handler bundle handed to the memoized canvas node components. */
interface ElementSceneHandlers {
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (event: Konva.KonvaEventObject<Event>) => void;
  onEnterContentEdit: () => void;
  onContentTransform: (patch: { scale?: number; offsetX?: number; offsetY?: number }) => void;
  onContentMetadata: (patch: Partial<FrameContent>) => void;
  onImageMetadata: (meta: { width: number; height: number }) => void;
  onVideoMetadata: (meta: { duration: number }) => void;
}

/** A page background is transparent when its color is explicitly "transparent" (or blank). */
function isTransparentBackground(background: { type?: string; color?: string } | null | undefined) {
  if (!background || background.type !== "color") return false;
  const color = String(background.color || "").trim().toLowerCase();
  return color === "transparent" || color === "" || color === "rgba(0, 0, 0, 0)" || color === "rgba(0,0,0,0)";
}

// Small light/grey checkerboard, lazily built once — used ONLY as the editor's on-canvas
// indicator that the background is transparent. Never rendered into exports (see the Rect below),
// so downloads/thumbnails keep genuinely transparent pixels.
let checkerboardPatternCanvas: HTMLCanvasElement | null = null;
function getCheckerboardPattern(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (checkerboardPatternCanvas) return checkerboardPatternCanvas;
  const cell = 12;
  const canvas = document.createElement("canvas");
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cell * 2, cell * 2);
  ctx.fillStyle = "#d5dbe4";
  ctx.fillRect(0, 0, cell, cell);
  ctx.fillRect(cell, cell, cell, cell);
  checkerboardPatternCanvas = canvas;
  return checkerboardPatternCanvas;
}

function CanvasPageSceneImpl({
  page,
  elements,
  selectedIds = [],
  pageDurationMs,
  playheadMs,
  playheadFrame,
  previewFps,
  forceTimelineSync,
  interactive,
  toolMode,
  frameDropTargetId = "",
  frameContentEditId = "",
  includePageOutline = true,
  registerRef,
  registerPreviewMediaController,
  onSelectNode,
  onOpenContextMenu,
  onNodeDragMove,
  onNodeDragEnd,
  onNodeTransform,
  onNodeTransformEnd,
  onEnterFrameContentEdit,
  onUpdateFrameContentTransform,
  onUpdateFrameContentMetadata,
  onUpdateImageMetadata,
  onUpdateVideoMetadata,
  onBeginInlineTextEdit,
}: CanvasPageSceneProps) {
  const sceneNodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const safeRegisterRef = useCallback(
    (id: string, node: Konva.Node | null) => {
      if (node) sceneNodeRefs.current.set(id, node);
      else sceneNodeRefs.current.delete(id);
      registerRef?.(id, node);
    },
    [registerRef]
  );
  const safeRegisterPreviewMediaController = useCallback(
    (id: string, controller: PreviewMediaController | null) => {
      registerPreviewMediaController?.(id, controller);
    },
    [registerPreviewMediaController]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Per-element event handlers, cached by element id and stable for the lifetime
  // of that element. The node components are memoized, and passing freshly
  // created arrows here would defeat that memo for every layer on every render
  // (including each animation frame during playback).
  //
  // Staleness is impossible by construction: the handlers never close over
  // `elements` or the callback props directly — they read them through refs that
  // are re-pointed at the latest values on every render, so a cached handler
  // always invokes the current callback with the current element.
  const latestElementsRef = useRef(elements);
  latestElementsRef.current = elements;
  const latestSceneCallbacksRef = useRef({
    onSelectNode,
    onOpenContextMenu,
    onNodeDragMove,
    onNodeDragEnd,
    onNodeTransformEnd,
    onEnterFrameContentEdit,
    onUpdateFrameContentTransform,
    onUpdateFrameContentMetadata,
    onUpdateImageMetadata,
    onUpdateVideoMetadata,
  });
  latestSceneCallbacksRef.current = {
    onSelectNode,
    onOpenContextMenu,
    onNodeDragMove,
    onNodeDragEnd,
    onNodeTransformEnd,
    onEnterFrameContentEdit,
    onUpdateFrameContentTransform,
    onUpdateFrameContentMetadata,
    onUpdateImageMetadata,
    onUpdateVideoMetadata,
  };

  const elementHandlerCacheRef = useRef<Map<string, ElementSceneHandlers>>(new Map());
  const getElementHandlers = useCallback((elementId: string): ElementSceneHandlers => {
    const cache = elementHandlerCacheRef.current;
    const cached = cache.get(elementId);
    if (cached) return cached;

    const currentElement = () =>
      latestElementsRef.current.find((candidate) => candidate.id === elementId) || null;

    const handlers: ElementSceneHandlers = {
      onSelect: (event) => latestSceneCallbacksRef.current.onSelectNode?.(event, elementId),
      onContextMenu: (event) =>
        latestSceneCallbacksRef.current.onOpenContextMenu?.(event, elementId),
      onDragMove: (event) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onNodeDragMove?.(event, element);
      },
      onDragEnd: (event) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onNodeDragEnd?.(event, element);
      },
      onTransformEnd: (event) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onNodeTransformEnd?.(event, element);
      },
      onEnterContentEdit: () => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onEnterFrameContentEdit?.(element);
      },
      onContentTransform: (patch) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onUpdateFrameContentTransform?.(element, patch);
      },
      onContentMetadata: (patch) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onUpdateFrameContentMetadata?.(element, patch);
      },
      onImageMetadata: (meta) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onUpdateImageMetadata?.(element, meta);
      },
      onVideoMetadata: (meta) => {
        const element = currentElement();
        if (element) latestSceneCallbacksRef.current.onUpdateVideoMetadata?.(element, meta);
      },
    };

    cache.set(elementId, handlers);
    return handlers;
  }, []);

  // Drop handlers for elements that no longer exist so the cache cannot grow
  // without bound across a long editing session.
  useEffect(() => {
    const liveIds = new Set(elements.map((element) => element.id));
    const cache = elementHandlerCacheRef.current;
    for (const cachedId of Array.from(cache.keys())) {
      if (!liveIds.has(cachedId)) cache.delete(cachedId);
    }
  }, [elements]);

  // Gaussian blur — both the layer's own static blur (the Blur control) and the animated
  // pose.blurRadius (e.g. the BLUR/تمويه entrance): Konva filters need node.cache(), so blur is
  // applied imperatively AFTER each commit to whatever nodes the render pass flagged. Nodes are
  // re-cached while their radius changes (playhead moves / content edits) and un-cached the moment
  // the blur ends so normal editing/rendering is untouched.
  const blurRadiiThisRenderRef = useRef<Map<string, number>>(new Map());
  const blurCachedIdsRef = useRef<Set<string>>(new Set());
  blurRadiiThisRenderRef.current = new Map();
  // An image finishing loading doesn't otherwise re-render this scene, so a statically-blurred
  // layer would keep the blank cache taken before its bitmap arrived. Bumping this re-runs the
  // caching effect below once the node actually has pixels.
  const [, refreshBlurCaches] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    const radii = blurRadiiThisRenderRef.current;
    const cached = blurCachedIdsRef.current;
    let needsDraw = false;
    let layer: Konva.Layer | null = null;
    for (const [id, radius] of radii) {
      const node = sceneNodeRefs.current.get(id);
      if (!node) continue;
      try {
        node.filters([Konva.Filters.Blur]);
        node.blurRadius(Math.round(radius * 10) / 10);
        // offset pads the cached region so the gaussian halo isn't clipped at the node bounds
        node.cache({ pixelRatio: 1, offset: Math.ceil(radius) + 4 });
        cached.add(id);
        layer = layer || node.getLayer();
        needsDraw = true;
      } catch {
        /* nodes mid-unmount can throw — skip */
      }
    }
    for (const id of [...cached]) {
      if (radii.has(id)) continue;
      cached.delete(id);
      const node = sceneNodeRefs.current.get(id);
      if (!node) continue;
      try {
        node.filters([]);
        node.blurRadius(0);
        node.clearCache();
        layer = layer || node.getLayer();
        needsDraw = true;
      } catch {
        /* ignore */
      }
    }
    if (needsDraw && layer) layer.batchDraw();
  });

  return (
    <>
      <Group clipX={0} clipY={0} clipWidth={page.width} clipHeight={page.height} listening={false}>
        <Rect
          x={0}
          y={0}
          width={page.width}
          height={page.height}
          // Transparent background renders no solid fill. In the editor (includePageOutline) we
          // paint a checkerboard so the user can SEE it's transparent; in exports/thumbnails
          // (includePageOutline=false) we paint nothing, leaving genuinely transparent pixels.
          fill={
            page.background.type === "gradient" || isTransparentBackground(page.background)
              ? undefined
              : page.background.color
          }
          fillPatternImage={
            isTransparentBackground(page.background) && includePageOutline
              ? // Konva accepts any CanvasImageSource; react-konva's prop type only names HTMLImageElement.
                ((getCheckerboardPattern() ?? undefined) as HTMLImageElement | undefined)
              : undefined
          }
          fillPatternRepeat={
            isTransparentBackground(page.background) && includePageOutline ? "repeat" : undefined
          }
          fillLinearGradientStartPoint={page.background.type === "gradient" ? { x: 0, y: 0 } : undefined}
          fillLinearGradientEndPoint={
            page.background.type === "gradient"
              ? { x: page.width, y: page.height }
              : undefined
          }
          fillLinearGradientColorStops={
            page.background.type === "gradient"
              ? [0, page.background.gradientFrom, 1, page.background.gradientTo]
              : undefined
          }
          listening={false}
        />
        {page.background.type === "image" && String(page.background.imageUri || "").trim() ? (
          <CanvasBackgroundImage
            src={String(page.background.imageUri || "").trim()}
            pageWidth={page.width}
            pageHeight={page.height}
          />
        ) : null}
      </Group>

      {includePageOutline ? (
        <Rect
          x={0}
          y={0}
          width={page.width}
          height={page.height}
          stroke="#d8dde5"
          strokeWidth={1}
          fillEnabled={false}
          listening={false}
        />
      ) : null}

      <Group clipX={0} clipY={0} clipWidth={page.width} clipHeight={page.height}>
        {elements.map((element) => {
          if (!isElementVisibleAtPlayhead(element, playheadMs, pageDurationMs)) {
            return null;
          }

          const pose = resolveAnimatedElementPoseAtFrame(
            element,
            playheadFrame,
            previewFps,
            pageDurationMs
          );
          // The layer's own static blur (Blur control) and any animation blur share one filter
          // pass — take the stronger of the two so a blurred layer animating a blur doesn't
          // double-cache or momentarily sharpen below its authored blur.
          const staticBlurRadius = Math.max(0, Math.min(40, Number(element.mediaBlur) || 0));
          const effectiveBlurRadius = Math.max(pose.blurRadius, staticBlurRadius);
          if (effectiveBlurRadius >= 0.5) {
            blurRadiiThisRenderRef.current.set(element.id, effectiveBlurRadius);
          }
          const elementHandlers = getElementHandlers(element.id);
          const isEditingFrameContent = interactive && frameContentEditId === element.id;
          const isSelected = interactive && selectedIdSet.has(element.id);
          const canTransform =
            interactive && isSelected && !element.locked && toolMode !== "draw" && !isEditingFrameContent;
          const commonProps = {
            ref: (node: Konva.Node | null) => safeRegisterRef(element.id, node),
            id: element.id,
            x: pose.x,
            y: pose.y,
            rotation: pose.rotation,
            scaleX: pose.scaleX,
            scaleY: pose.scaleY,
            opacity: pose.opacity,
            draggable: canTransform,
            listening: interactive,
            globalCompositeOperation: element.blendMode,
            shadowColor: element.shadowColor,
            shadowBlur: element.shadowBlur,
            shadowOffsetX: element.shadowOffsetX,
            shadowOffsetY: element.shadowOffsetY,
            onClick: interactive
              ? (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) =>
                  onSelectNode?.(event, element.id)
              : undefined,
            onContextMenu: interactive
              ? (event: Konva.KonvaEventObject<PointerEvent>) =>
                  onOpenContextMenu?.(event, element.id)
              : undefined,
            onDragMove: interactive
              ? (event: Konva.KonvaEventObject<DragEvent>) =>
                  onNodeDragMove?.(event, element)
              : undefined,
            onDragEnd: interactive
              ? (event: Konva.KonvaEventObject<DragEvent>) =>
                  onNodeDragEnd?.(event, element)
              : undefined,
            onTransform: interactive ? onNodeTransform : undefined,
            onTransformEnd: interactive
              ? (event: Konva.KonvaEventObject<Event>) =>
                  onNodeTransformEnd?.(event, element)
              : undefined,
          };

          if (element.type === "frame") {
            return (
              <CanvasFrameNode
                key={element.id}
                element={element}
                pose={pose}
                interactive={interactive}
                canTransform={canTransform}
                isDropTarget={interactive && frameDropTargetId === element.id}
                isContentEditing={isEditingFrameContent}
                playheadFrame={playheadFrame}
                previewFps={previewFps}
                pageDurationMs={pageDurationMs}
                forceTimelineSync={forceTimelineSync}
                registerRef={safeRegisterRef}
                registerPreviewMediaController={safeRegisterPreviewMediaController}
                onSelect={elementHandlers.onSelect}
                onContextMenu={elementHandlers.onContextMenu}
                onDragMove={elementHandlers.onDragMove}
                onDragEnd={elementHandlers.onDragEnd}
                onTransformEnd={elementHandlers.onTransformEnd}
                onEnterContentEdit={elementHandlers.onEnterContentEdit}
                onContentTransform={elementHandlers.onContentTransform}
                onContentMetadata={elementHandlers.onContentMetadata}
              />
            );
          }

          if (element.type === "image") {
            return (
              <CanvasImageNode
                key={element.id}
                element={element}
                pose={pose}
                interactive={interactive}
                canTransform={canTransform}
                playheadFrame={playheadFrame}
                previewFps={previewFps}
                pageDurationMs={pageDurationMs}
                forceTimelineSync={forceTimelineSync}
                registerRef={safeRegisterRef}
                onSelect={elementHandlers.onSelect}
                onContextMenu={elementHandlers.onContextMenu}
                onDragMove={elementHandlers.onDragMove}
                onDragEnd={elementHandlers.onDragEnd}
                onTransformEnd={elementHandlers.onTransformEnd}
                onImageMetadata={elementHandlers.onImageMetadata}
                // Only blurred layers need the re-cache nudge; skip the extra render otherwise.
                onContentReady={staticBlurRadius > 0 ? refreshBlurCaches : undefined}
              />
            );
          }

          if (element.type === "video") {
            return (
              <CanvasVideoNode
                key={element.id}
                element={element}
                pose={pose}
                interactive={interactive}
                canTransform={canTransform}
                playheadFrame={playheadFrame}
                previewFps={previewFps}
                pageDurationMs={pageDurationMs}
                forceTimelineSync={forceTimelineSync}
                registerRef={safeRegisterRef}
                registerPreviewMediaController={safeRegisterPreviewMediaController}
                onSelect={elementHandlers.onSelect}
                onContextMenu={elementHandlers.onContextMenu}
                onDragMove={elementHandlers.onDragMove}
                onDragEnd={elementHandlers.onDragEnd}
                onTransformEnd={elementHandlers.onTransformEnd}
                onVideoMetadata={elementHandlers.onVideoMetadata}
              />
            );
          }

          if (element.type === "text") {
            const konvaFontStyle = toKonvaFontStyle(element.fontStyle, element.fontWeight);
            const direction = resolveTextDirection(element.text);
            // Text outline. `fillAfterStrokeEnabled` paints the fill over the stroke so the stroke
            // reads as an outline hugging the glyph instead of eating half of it.
            const textStrokeWidthPx = resolveTextStrokeWidthPx(element.strokeWidth, element.fontSize);
            const textStrokeProps =
              textStrokeWidthPx > 0 && String(element.stroke || "").trim()
                ? {
                    stroke: element.stroke,
                    strokeWidth: textStrokeWidthPx,
                    fillAfterStrokeEnabled: true,
                  }
                : {};
            const hasTextCurve = isCurvedText(element);

            if (hasTextCurve) {
              return (
                <Group
                  key={element.id}
                  {...commonProps}
                  onDblClick={
                    interactive
                      ? (event) => onBeginInlineTextEdit?.(event.target, element)
                      : undefined
                  }
                  onDblTap={
                    interactive
                      ? (event) => onBeginInlineTextEdit?.(event.target, element)
                      : undefined
                  }
                >
                  <Rect width={element.width} height={element.height} fill="rgba(0,0,0,0)" />
                  <TextPath
                    {...textStrokeProps}
                    data={resolveTextCurvePath(element)}
                    text={element.text}
                    fill={element.color || element.fill}
                    fontSize={element.fontSize}
                    fontFamily={resolveCssFontFamily(element.fontFamily)}
                    fontStyle={konvaFontStyle}
                    fontVariant="normal"
                    align={element.align}
                    letterSpacing={element.letterSpacing}
                    textDecoration={element.textDecoration}
                    textBaseline="middle"
                    listening={false}
                  />
                </Group>
              );
            }

            // Phase-2 preview effects (reveal matte / typewriter / BLOCK bar). Rendered only for
            // NON-selected text — the selected element keeps the plain <Text> so the Konva
            // Transformer and inline-edit path are never wrapped. Effects are inert at rest, so
            // this only diverges from the plain node mid-animation during playback.
            const textFx = isSelected
              ? null
              : resolveAnimatedElementEffectsAtFrame(element, playheadFrame, previewFps, pageDurationMs);
            // Per-WORD motion (ASCEND rises each word in, ONE_WORD shows one at a time). Rendered
            // as one <Text> per word at a measured x — words shape correctly split (unlike
            // per-CHAR, which would break Arabic). Single line only; multi-line falls through to
            // the reveal/clip fallback below. These types also carry a WIPE mask, so this MUST
            // run before the generic clip branch or the word motion never shows.
            const perWordType = textFx?.glyphMotion?.type;
            if (
              textFx?.glyphMotion &&
              (perWordType === "ASCEND" || perWordType === "ONE_WORD") &&
              !element.text.includes("\n")
            ) {
              const words = splitWordsForMotion(element.text);
              if (words.length > 0) {
                const gm = textFx.glyphMotion;
                const rtl = direction === "rtl";
                const fontCss = `${konvaFontStyle} ${element.fontSize}px ${resolveCssFontFamily(
                  element.fontFamily
                )}`;
                const measured = measureWordAdvances(words, fontCss, element.letterSpacing || 0);
                const boxes = layoutWordsSingleLine(
                  words.map((w, i) => ({ text: w, width: measured.widths[i] })),
                  measured.spaceWidth,
                  element.width,
                  element.align === "center" ? "center" : element.align === "right" ? "right" : "left",
                  rtl
                );
                const lineHeightPx = element.fontSize * (element.lineHeight || 1);
                return (
                  <Group key={element.id} {...commonProps}>
                    {boxes.map((b) => {
                      const gv = glyphVisual(gm.type, gm.progress, gm.durationMs, 0, 1, b.wordIndex, words.length);
                      if (!gv || gv.alpha <= 0.001) return null; // ONE_WORD hides inactive words
                      return (
                        <Text
                          key={b.wordIndex}
                          {...textStrokeProps}
                          x={b.x}
                          y={gv.translateYEm * lineHeightPx}
                          text={b.text}
                          fill={element.color || element.fill}
                          fontSize={element.fontSize}
                          fontFamily={resolveCssFontFamily(element.fontFamily)}
                          fontStyle={konvaFontStyle}
                          fontVariant="normal"
                          letterSpacing={element.letterSpacing}
                          textDecoration={element.textDecoration}
                          opacity={gv.alpha}
                          listening={false}
                        />
                      );
                    })}
                  </Group>
                );
              }
            }
            if (textFx && (textFx.revealMask || textFx.textReveal || textFx.overlayBar)) {
              const rtl = direction === "rtl";
              let clip: ClipMask | null = textFx.revealMask
                ? (textFx.revealMask as ClipMask)
                : null;
              if (!clip && textFx.textReveal) {
                clip = {
                  kind: "WIPE",
                  progress: revealFraction(
                    textFx.textReveal.progress,
                    textFx.textReveal.mode,
                    textFx.textReveal.durationMs,
                    element.text
                  ),
                };
              }
              const bar = textFx.overlayBar;
              const localTextProps = {
                ...textStrokeProps,
                width: element.width,
                height: element.height,
                text: element.text,
                fill: element.color || element.fill,
                fontSize: element.fontSize,
                fontFamily: resolveCssFontFamily(element.fontFamily),
                fontStyle: konvaFontStyle,
                fontVariant: "normal" as const,
                lineHeight: element.lineHeight,
                align: element.align,
                direction,
                letterSpacing: element.letterSpacing,
                textDecoration: element.textDecoration,
                listening: false,
              };
              return (
                <Group key={element.id} {...commonProps}>
                  <Group
                    listening={false}
                    clipFunc={
                      clip
                        ? (ctx) => drawRevealClip(ctx, clip!, element.width, element.height, rtl)
                        : undefined
                    }
                  >
                    <Text {...localTextProps} />
                  </Group>
                  {bar ? (
                    // BLOCK's bar rides ON TOP of the swept text (outside the clip), in the text's
                    // own colour — the thing doing the uncovering.
                    <Rect
                      x={bar.leftFraction * element.width}
                      y={0}
                      width={bar.widthFraction * element.width}
                      height={element.height}
                      fill={element.color || element.fill}
                      listening={false}
                    />
                  ) : null}
                </Group>
              );
            }

            return (
              <Text
                key={element.id}
                {...commonProps}
                {...textStrokeProps}
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
                onDblClick={
                  interactive
                    ? (event) => onBeginInlineTextEdit?.(event.target as Konva.Text, element)
                    : undefined
                }
                onDblTap={
                  interactive
                    ? (event) => onBeginInlineTextEdit?.(event.target as Konva.Text, element)
                    : undefined
                }
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
                stroke={Number(element.strokeWidth) > 0 ? element.stroke : undefined}
                strokeWidth={Number(element.strokeWidth) > 0 ? Number(element.strokeWidth) : 0}
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
                stroke={Number(element.strokeWidth) > 0 ? element.stroke : undefined}
                strokeWidth={Number(element.strokeWidth) > 0 ? Number(element.strokeWidth) : 0}
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
              stroke={Number(element.strokeWidth) > 0 ? element.stroke : undefined}
              strokeWidth={Number(element.strokeWidth) > 0 ? Number(element.strokeWidth) : 0}
              cornerRadius={resolveCornerRadiusList(element.cornerRadius, element.cornerRadiusCorners)}
            />
          );
        })}
      </Group>
    </>
  );
}

// Memoized canvas components.
//
// The scene tree is re-rendered on every parent render — which includes every
// animation frame during timeline playback, every wheel-zoom tick, and every
// element edit. Without memo, each of those re-created every Konva node and
// forced react-konva to diff and repaint the whole scene. Props are primitives,
// stable store references, or useCallback-stabilized handlers, so the default
// shallow comparison is both correct and effective here.
// `pose` is recomputed into a fresh object on every scene render, so the default
// shallow comparison would never match. Compare it by value; every other prop is
// a primitive or a stable reference (see getElementHandlers).
function canvasNodePropsEqual(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
) {
  const keys = Object.keys(prev);
  if (keys.length !== Object.keys(next).length) return false;
  for (const key of keys) {
    if (key === "pose") {
      const a = prev.pose as Record<string, number> | undefined;
      const b = next.pose as Record<string, number> | undefined;
      if (a === b) continue;
      if (!a || !b) return false;
      const poseKeys = Object.keys(a);
      if (poseKeys.length !== Object.keys(b).length) return false;
      for (const poseKey of poseKeys) {
        if (!Object.is(a[poseKey], b[poseKey])) return false;
      }
      continue;
    }
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}

const CanvasBackgroundImage = memo(CanvasBackgroundImageImpl);
const CanvasImageNode = memo(CanvasImageNodeImpl, canvasNodePropsEqual);
const CanvasVideoNode = memo(CanvasVideoNodeImpl, canvasNodePropsEqual);
const CanvasFrameNode = memo(CanvasFrameNodeImpl, canvasNodePropsEqual);
const CanvasPageScene = memo(CanvasPageSceneImpl);

// Sentinel returned by the playhead selector while the timeline is playing, so the
// subscription yields a constant and never re-renders on playhead changes.
const PLAYBACK_FROZEN_PLAYHEAD_MS = -1;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveTextDirection(text: string) {
  return /[\u0590-\u08FF]/.test(String(text || "")) ? "rtl" : "ltr";
}

function resolveTextCurvePath(element: EditorElement) {
  const width = Math.max(2, Number(element.width) || 2);
  const height = Math.max(2, Number(element.height) || 2);
  const fontSize = Math.max(1, Number(element.fontSize) || 1);
  const amount = clamp(Number(element.textCurveAmount || 0), -100, 100);
  const middleY = height / 2;
  const maxCurveOffset = clamp(width * 0.42, Math.max(12, fontSize), Math.max(16, fontSize * 6));
  const curveOffset = (amount / 100) * maxCurveOffset;
  const controlY = middleY - curveOffset;

  return `M 0 ${middleY} Q ${width / 2} ${controlY} ${width} ${middleY}`;
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

const TRANSFORMER_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
// A text box's height is derived from the text it renders (see the snug-fit effect), so the
// top/bottom-center handles would snap straight back — don't offer them on text.
const TEXT_TRANSFORMER_ANCHORS = TRANSFORMER_ANCHORS.filter(
  (anchor) => anchor !== "top-center" && anchor !== "bottom-center"
);

/** Curved text is laid out along a path built from the box, so its box is never re-fitted. */
function isCurvedText(element: EditorElement) {
  return (
    element.type === "text" &&
    Boolean(element.textCurveEnabled) &&
    Math.abs(Number(element.textCurveAmount) || 0) > 0.5
  );
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
// Page thumbnails ship to mobile as page-strip tiles — small on purpose so a many-page save
// stays a light payload. Matches the width PageBar downscales its own captures to.
const PAGE_THUMBNAIL_MAX_WIDTH_PX = 168;

export default function CanvasEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const exportStageHostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const exportStageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  // The transformer anchor currently being dragged (e.g. "top-left",
  // "middle-right"). Captured during transform so transform-end can branch text
  // resize (corners) vs. reflow (side handles).
  const activeAnchorRef = useRef<string>("");
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
  const timelineIsPlaying = useEditorStore((state) => state.timelineIsPlaying);
  // While the timeline is playing the playhead advances ~60x/second. Subscribing
  // to it reactively would re-render this entire component (and, through it, the
  // whole Konva scene) on every frame. Instead the subscription is frozen during
  // playback and the live value is delivered through a ref that the playback
  // driver below updates; see applyImperativePlaybackFrame.
  const subscribedPlayheadMs = useEditorStore((state) =>
    state.timelineIsPlaying ? PLAYBACK_FROZEN_PLAYHEAD_MS : state.timelinePlayheadMs
  );
  const livePlaybackPlayheadMsRef = useRef(0);
  const [, forcePlaybackRender] = useReducer((tick: number) => tick + 1, 0);
  // Keep the ref tracking the store whenever playback is idle, so the first frame
  // after pressing play starts from the real playhead instead of a stale value.
  if (!timelineIsPlaying) {
    livePlaybackPlayheadMsRef.current = subscribedPlayheadMs;
  }
  // Reading the ref during render is intentional: it always holds the frame the
  // imperative driver last applied, so any render that does happen mid-playback
  // (forced by the driver, or incidental) paints the current frame rather than a
  // stale one — without the ref itself ever scheduling a render.
  const timelinePlayheadMs = timelineIsPlaying
    ? livePlaybackPlayheadMsRef.current
    : subscribedPlayheadMs;
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const previewGenerationActive = useEditorStore((state) => state.previewGenerationActive);
  const zoomPercent = useEditorStore((state) => state.zoomPercent);

  const setStageApi = useEditorStore((state) => state.setStageApi);
  const setZoomPercent = useEditorStore((state) => state.setZoomPercent);
  const setTimelinePlaying = useEditorStore((state) => state.setTimelinePlaying);
  const setTimelinePlayheadMs = useEditorStore((state) => state.setTimelinePlayheadMs);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
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

  // One-time auto-fit for single-line text. Imported text boxes (and some authored
  // ones) carry a lot of empty padding: the box is far wider than the glyph and
  // decorative fonts use a tall line-height, so the selection box dwarfs the letter.
  // Tighten the box to the rendered text and clamp the line-height, shifting x/y so the
  // glyph stays in the exact same visual spot (only the box shrinks — the design looks
  // identical, just with a snug bounding box). Multi-line text is left untouched
  // because it needs its wrapping width and line spacing.
  const fittedTextIdsRef = useRef<Set<string>>(new Set());
  const autofitDoneRef = useRef(false);
  useEffect(() => {
    if (autofitDoneRef.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const MAX_LINE_HEIGHT = 1.15;

    const measureInk = (cfg: Konva.TextConfig) => {
      const node = new Konva.Text(cfg);
      let result: { left: number; top: number; w: number; h: number } | null = null;
      try {
        const canvas = node.toCanvas({ pixelRatio: 1 });
        const ctx = canvas.getContext("2d");
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let minX = canvas.width;
          let minY = canvas.height;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < canvas.height; y += 1) {
            for (let x = 0; x < canvas.width; x += 1) {
              if (data[(y * canvas.width + x) * 4 + 3] > 20) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX >= minX && maxY >= minY) {
            result = { left: minX, top: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
          }
        }
      } catch {
        result = null;
      }
      node.destroy();
      return result;
    };

    const run = async () => {
      try {
        await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      } catch {
        /* ignore */
      }
      if (disposed) return;
      const snapshot = useEditorStore.getState().pages;

      // Preload every text font up-front so the measurement pass below is fully
      // synchronous: calling updateElement mid-pass would churn `pages` and could
      // abort us, so we measure everything first and apply all fits at the end.
      const fontShorthands = new Set<string>();
      snapshot.forEach((page) => {
        (page.elements || []).forEach((element) => {
          const fontSize = Number(element.fontSize) || 0;
          if (element.type === "text" && fontSize > 0) {
            fontShorthands.add(`${fontSize}px ${resolveCssFontFamily(element.fontFamily)}`);
          }
        });
      });
      try {
        await Promise.all([...fontShorthands].map((f) => document.fonts.load(f).catch(() => undefined)));
      } catch {
        /* ignore */
      }
      if (disposed) return;

      const fits: Array<{ id: string; patch: Partial<EditorElement> }> = [];
      snapshot.forEach((page) => {
        (page.elements || []).forEach((element) => {
          if (element.type !== "text") return;
          if (fittedTextIdsRef.current.has(element.id)) return;
          const text = String(element.text || "");
          if (!text.trim() || /[\r\n]/.test(text)) return;
          if (Math.abs((element.scaleX ?? 1) - 1) > 0.01 || Math.abs((element.scaleY ?? 1) - 1) > 0.01) return;
          const fontSize = Number(element.fontSize) || 0;
          if (fontSize <= 0) return;
          const fontFamily = resolveCssFontFamily(element.fontFamily);
          try {
            if (!document.fonts.check(`${fontSize}px ${fontFamily}`)) return; // font not ready
          } catch {
            /* proceed if check unsupported */
          }
          const fontStyle = toKonvaFontStyle(element.fontStyle, element.fontWeight);
          const letterSpacing = Number(element.letterSpacing) || 0;
          const lineHeight = Number(element.lineHeight) || 1.1;
          const direction = resolveTextDirection(text); // Arabic/Hebrew render RTL
          const baseCfg: Konva.TextConfig = {
            text, fontSize, fontFamily, fontStyle, letterSpacing, direction,
            lineHeight, align: element.align, width: element.width, height: element.height,
          };
          const cur = measureInk(baseCfg);
          if (!cur) return;

          const widthNode = new Konva.Text({ text, fontSize, fontFamily, fontStyle, letterSpacing, direction });
          const textWidth = widthNode.getTextWidth();
          widthNode.destroy();
          const newWidth = Math.max(1, Math.ceil(textWidth) + 2);
          // If the text is wider than its box, the box is intentionally WRAPPING the text
          // across multiple lines (e.g. a centered two-line heading imported from Canva).
          // Autofit only tightens genuine single-line boxes — widening this box to the full
          // one-line width would collapse the wrap onto one line and break the layout.
          // BUT Konva truncates wrapped lines that overflow a FIXED box height, so an imported
          // two-line heading in a box sized for ~1.8 lines silently loses its 2nd line. So grow
          // the box height to fit all wrapped lines, keeping the width and lineHeight.
          if (newWidth > element.width + 2) {
            fittedTextIdsRef.current.add(element.id);
            const wrapNode = new Konva.Text({
              text,
              fontSize,
              fontFamily,
              fontStyle,
              letterSpacing,
              direction,
              lineHeight,
              align: element.align,
              width: element.width,
              wrap: "word",
            });
            const wrappedHeight = Math.ceil(wrapNode.height());
            wrapNode.destroy();
            if (wrappedHeight > element.height + 1) {
              fits.push({ id: element.id, patch: { height: wrappedHeight + 2 } });
            }
            return;
          }
          const newLineHeight = Math.min(lineHeight, MAX_LINE_HEIGHT);

          const horizontallyPadded = element.width > newWidth * 1.12;
          // Padding counts on EITHER vertical side. A box far taller than its glyph but with the
          // ink sitting near the top has a small `cur.top` yet a large gap BELOW — the asymmetric
          // "big bottom padding" case. The old check only looked at the top gap, so those boxes
          // were deemed tight and left untouched. Measure the bottom gap too.
          const bottomGap = element.height - (cur.top + cur.h);
          const verticallyPadded =
            cur.top > fontSize * 0.18 ||
            bottomGap > fontSize * 0.18 ||
            lineHeight > MAX_LINE_HEIGHT + 0.05;
          if (!horizontallyPadded && !verticallyPadded) {
            fittedTextIdsRef.current.add(element.id);
            return;
          }

          let newHeight = Math.max(Math.ceil(fontSize * newLineHeight), Math.ceil(cur.h) + 2);
          let newInk = measureInk({ ...baseCfg, width: newWidth, height: newHeight, lineHeight: newLineHeight });
          if (newInk && newInk.top + newInk.h > newHeight) {
            newHeight = newInk.top + newInk.h + 2;
            newInk = measureInk({ ...baseCfg, width: newWidth, height: newHeight, lineHeight: newLineHeight });
          }
          if (!newInk) {
            fittedTextIdsRef.current.add(element.id);
            return;
          }

          // Keep the glyph's rendered position fixed; only the box changes.
          fittedTextIdsRef.current.add(element.id);
          fits.push({
            id: element.id,
            patch: {
              width: newWidth,
              height: newHeight,
              x: element.x + cur.left - newInk.left,
              y: element.y + cur.top - newInk.top,
              lineHeight: newLineHeight,
            },
          });
        });
      });

      if (disposed) return;
      autofitDoneRef.current = true;
      fits.forEach((fit) => updateElement(fit.id, fit.patch));
    };

    // Debounce until the template load settles (pages stop churning), then fit once.
    const hasElements = pages.some((page) => (page.elements || []).length > 0);
    if (hasElements) {
      timer = setTimeout(() => {
        void run();
      }, 350);
    }
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [pages, updateElement]);

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
  const [captureFrameOverride, setCaptureFrameOverride] = useState<number | null>(null);
  const [exportFrameOverride, setExportFrameOverride] = useState(0);
  const [exportMaxDimension, setExportMaxDimension] = useState(720);
  // The hidden export stage duplicates the entire scene (a second Konva node per
  // element, plus a second decoded bitmap/video per media layer). Keeping it
  // mounted at all times doubled canvas memory for every editing session, so it
  // is now mounted only while an export/capture actually needs it. Consumers go
  // through ensureExportStage() below, which mounts it and waits for the commit.
  const [exportStageRequested, setExportStageRequested] = useState(false);
  // Renders the hidden export stage against a page OTHER than the active one, so a save can
  // thumbnail pages the user never opened without disturbing the visible canvas. Empty = the
  // export stage mirrors the active page (every pre-existing export/preview path).
  const [exportPageIdOverride, setExportPageIdOverride] = useState("");

  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const frameDropTargetTimeoutRef = useRef<number | null>(null);
  const expiredFrameDropTargetRef = useRef("");
  const autoFitPageIdRef = useRef("");
  // While true, the initial-load zoom keeps re-applying 50% as the container is measured. Any
  // manual zoom/pan flips it off so the user's view is never yanked back.
  const autoFitActiveRef = useRef(false);
  const previewMediaControllersRef = useRef<Map<string, PreviewMediaController>>(new Map());
  const exportPreviewMediaControllersRef = useRef<Map<string, PreviewMediaController>>(new Map());
  const timelinePlayheadMsRef = useRef(timelinePlayheadMs);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );

  useEffect(() => {
    timelinePlayheadMsRef.current = timelinePlayheadMs;
  }, [timelinePlayheadMs]);

  const elements = useMemo(() => activePage?.elements ?? [], [activePage]);
  const activePageDurationMs = useMemo(() => getPageDurationMs(activePage), [activePage]);
  const previewRenderFps = useMemo(() => resolvePreviewRenderFps(), []);
  // The page the hidden export stage draws — the active page unless a page-thumbnail pass has
  // pointed it elsewhere.
  const exportPage = useMemo(() => {
    if (!exportPageIdOverride) return activePage;
    return pages.find((page) => page.id === exportPageIdOverride) || activePage;
  }, [activePage, exportPageIdOverride, pages]);
  const exportElements = useMemo(() => exportPage?.elements ?? [], [exportPage]);
  const exportPageDurationMs = useMemo(() => getPageDurationMs(exportPage), [exportPage]);
  const exportCanvasSpec = useMemo(
    () => getPreviewRenderSpec(exportPage, exportMaxDimension),
    [exportPage, exportMaxDimension]
  );
  const activePageTimelineStartMs = useMemo(() => {
    const entry = getTimelinePageEntries(pages).find((item) => item.page.id === activePage?.id);
    return entry?.startMs || 0;
  }, [activePage?.id, pages]);
  const activePagePlayheadMs = useMemo(
    () => Math.max(0, Math.min(activePageDurationMs, timelinePlayheadMs - activePageTimelineStartMs)),
    [activePageDurationMs, activePageTimelineStartMs, timelinePlayheadMs]
  );
  const activePagePlayheadFrame = useMemo(
    () => getFrameAlignedPlayheadFrame(activePagePlayheadMs, previewRenderFps, activePageDurationMs),
    [activePageDurationMs, activePagePlayheadMs, previewRenderFps]
  );
  const effectiveActivePageFrame =
    captureFrameOverride === null ? activePagePlayheadFrame : captureFrameOverride;
  const effectiveActivePagePlayheadMs =
    captureFrameOverride === null
      ? activePagePlayheadMs
      : Math.min(activePageDurationMs, frameToSampleTimeMs(captureFrameOverride, previewRenderFps));

  // ---------------------------------------------------------------------------
  // Imperative playback
  //
  // During playback the pose channel (position / rotation / scale / opacity) is
  // written straight onto the Konva nodes instead of being routed through React,
  // so a frame costs a handful of attribute writes and one batchDraw rather than
  // a full re-render of this component and every element in the scene.
  //
  // The fast path is only taken when it is provably equivalent to rendering. Any
  // frame that needs React to do structural work falls back to a normal render,
  // so playback output is identical either way. It bails when:
  //   - the animation has a non-pose channel this frame (reveal mask, text
  //     reveal, per-glyph motion, overlay bar) — those change what is drawn,
  //     not just where;
  //   - the pose carries a blur radius, which needs a Konva filter re-cache;
  //   - the set of visible elements differs from the last commit (an element
  //     entered or left, so nodes must mount/unmount);
  //   - the page contains video, whose frame sync is driven by a render effect;
  //   - a node has not been mounted yet.
  const lastCommittedVisibleSignatureRef = useRef("");
  // The frame React last painted, and whether the nodes have since been moved
  // out from under it imperatively. react-konva diffs new props against the props
  // it last applied — not against the live node — so a node we mutated directly
  // would keep its imperative value if the next render's prop happened to equal
  // the previously rendered one. Before handing control back to React we restore
  // the poses of that last render, so its diff starts from the state it expects.
  const lastRenderedFrameRef = useRef(0);
  const imperativePoseDirtyRef = useRef(false);
  const visibleElementSignature = useMemo(
    () =>
      elements
        .filter((element) =>
          isElementVisibleAtPlayhead(element, effectiveActivePagePlayheadMs, activePageDurationMs)
        )
        .map((element) => element.id)
        .join("|"),
    [activePageDurationMs, effectiveActivePagePlayheadMs, elements]
  );
  lastCommittedVisibleSignatureRef.current = visibleElementSignature;
  lastRenderedFrameRef.current = effectiveActivePageFrame;
  imperativePoseDirtyRef.current = false;

  const pageContainsVideoLayer = useMemo(
    () =>
      elements.some((element) => {
        const type = String(element.type || "").trim().toLowerCase();
        if (type === "video") return true;
        if (type !== "frame") return false;
        return String(element.frameContent?.kind || "").trim().toLowerCase() === "video";
      }),
    [elements]
  );

  const applyPoseToNode = useCallback((node: Konva.Node, pose: ElementRenderPose) => {
    node.x(pose.x);
    node.y(pose.y);
    node.rotation(pose.rotation);
    node.scaleX(pose.scaleX);
    node.scaleY(pose.scaleY);
    node.opacity(pose.opacity);
  }, []);

  // Hand control back to React: rewind the nodes to the poses of the last render
  // so react-konva's next diff is computed against the state it believes in.
  const releaseImperativePoses = useCallback(() => {
    if (!imperativePoseDirtyRef.current) return false;
    const restoreFrame = lastRenderedFrameRef.current;
    let layer: Konva.Layer | null = null;
    for (const element of elements) {
      const node = nodeRefs.current[element.id];
      if (!node) continue;
      applyPoseToNode(
        node,
        resolveAnimatedElementPoseAtFrame(
          element,
          restoreFrame,
          previewRenderFps,
          activePageDurationMs
        )
      );
      layer = layer || node.getLayer();
    }
    layer?.batchDraw();
    imperativePoseDirtyRef.current = false;
    return false;
  }, [activePageDurationMs, applyPoseToNode, elements, previewRenderFps]);

  const applyImperativePlaybackFrame = useCallback(
    (timelineMs: number) => {
      if (pageContainsVideoLayer) return releaseImperativePoses();

      const pageMs = Math.max(
        0,
        Math.min(activePageDurationMs, timelineMs - activePageTimelineStartMs)
      );
      const frame = getFrameAlignedPlayheadFrame(pageMs, previewRenderFps, activePageDurationMs);

      const pending: Array<{ node: Konva.Node; pose: ElementRenderPose }> = [];
      const visibleIds: string[] = [];

      for (const element of elements) {
        if (!isElementVisibleAtPlayhead(element, pageMs, activePageDurationMs)) continue;
        visibleIds.push(element.id);

        if (
          resolveAnimatedElementEffectsAtFrame(
            element,
            frame,
            previewRenderFps,
            activePageDurationMs
          )
        ) {
          return releaseImperativePoses();
        }

        const pose = resolveAnimatedElementPoseAtFrame(
          element,
          frame,
          previewRenderFps,
          activePageDurationMs
        );
        if (pose.blurRadius > 0) return releaseImperativePoses();

        const node = nodeRefs.current[element.id];
        if (!node) return releaseImperativePoses();
        pending.push({ node, pose });
      }

      if (visibleIds.join("|") !== lastCommittedVisibleSignatureRef.current) {
        return releaseImperativePoses();
      }

      let layer: Konva.Layer | null = null;
      for (const { node, pose } of pending) {
        applyPoseToNode(node, pose);
        layer = layer || node.getLayer();
      }
      imperativePoseDirtyRef.current = true;

      // Keep the selection handles glued to a moving layer.
      transformerRef.current?.forceUpdate?.();
      (layer || stageRef.current?.getLayers()?.[0])?.batchDraw();
      return true;
    },
    [
      activePageDurationMs,
      activePageTimelineStartMs,
      applyPoseToNode,
      elements,
      pageContainsVideoLayer,
      previewRenderFps,
      releaseImperativePoses,
    ]
  );

  useEffect(() => {
    if (!timelineIsPlaying) return;
    // The preview recorder steps frames itself (flushSync + draw); leave it alone.
    if (previewGenerationActive || captureFrameOverride !== null) return;

    const applyPlayheadMs = (playheadMs: number) => {
      livePlaybackPlayheadMsRef.current = playheadMs;
      // Keep the recorder's snapshot ref exact even across frames we never render.
      timelinePlayheadMsRef.current = playheadMs;
      if (!applyImperativePlaybackFrame(playheadMs)) {
        // Fall back to a real render for this frame.
        forcePlaybackRender();
      }
    };

    // Driven off the store rather than a second requestAnimationFrame loop: the
    // timeline's playback loop already runs on rAF, and subscribing means each
    // frame is applied the moment it is produced, with no extra loop and no
    // one-frame lag between the two.
    applyPlayheadMs(useEditorStore.getState().timelinePlayheadMs);
    const unsubscribe = useEditorStore.subscribe((state, prevState) => {
      if (state.timelinePlayheadMs === prevState.timelinePlayheadMs) return;
      applyPlayheadMs(state.timelinePlayheadMs);
    });

    return () => {
      unsubscribe();
      // Playback stopped. The nodes already sit at the final frame, which is also
      // what the store now reports, so the upcoming render agrees with them — just
      // clear the flag so a later bail cannot rewind to a frame from this session.
      imperativePoseDirtyRef.current = false;
    };
  }, [
    applyImperativePlaybackFrame,
    captureFrameOverride,
    previewGenerationActive,
    timelineIsPlaying,
  ]);
  const effectiveExportPlayheadMs = Math.min(
    activePageDurationMs,
    previewGenerationActive
      ? activePagePlayheadMs
      : frameToSampleTimeMs(exportFrameOverride, previewRenderFps)
  );
  const effectiveExportPlayheadFrame = previewGenerationActive
    ? activePagePlayheadFrame
    : exportFrameOverride;
  const isRenderingPreview = previewGenerationActive || captureFrameOverride !== null;
  // Mount the hidden export stage only when something needs it: an in-flight
  // preview recording, a main-stage capture, or an on-demand request from
  // ensureExportStage(). Otherwise it stays unmounted and costs nothing.
  const exportStageMounted = isRenderingPreview || exportStageRequested;
  // Blocking overlay ONLY during real preview generation (save/extract video) — editing mid-recording
  // would corrupt the recording. The timeline filmstrip renders from the hidden export stage and must
  // never block the editor (it re-runs on load and on every element change).
  const showBlockingPreviewOverlay = previewGenerationActive;
  const forceTimelineMediaSync = Boolean(designTimeline.enabled) || captureFrameOverride !== null || previewGenerationActive;

  const registerPreviewMediaController = useCallback(
    (id: string, controller: PreviewMediaController | null) => {
      const targetId = String(id || "").trim();
      if (!targetId) return;
      if (!controller) {
        previewMediaControllersRef.current.delete(targetId);
        return;
      }
      previewMediaControllersRef.current.set(targetId, controller);
    },
    []
  );

  const syncPreviewMediaControllers = useCallback(async (frame: number, fps: number) => {
    const controllers = Array.from(previewMediaControllersRef.current.values());
    if (controllers.length === 0) return;
    await Promise.all(controllers.map((controller) => controller.syncToFrame(frame, fps)));
  }, []);

  const registerExportPreviewMediaController = useCallback(
    (id: string, controller: PreviewMediaController | null) => {
      const targetId = String(id || "").trim();
      if (!targetId) return;
      if (!controller) {
        exportPreviewMediaControllersRef.current.delete(targetId);
        return;
      }
      exportPreviewMediaControllersRef.current.set(targetId, controller);
    },
    []
  );

  const syncExportPreviewMediaControllers = useCallback(async (frame: number, fps: number) => {
    const controllers = Array.from(exportPreviewMediaControllersRef.current.values());
    if (controllers.length === 0) return;
    await Promise.all(controllers.map((controller) => controller.syncToFrame(frame, fps)));
  }, []);

  const registerExportNodeRef = useCallback((_id: string, _node: Konva.Node | null) => {}, []);

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
    autoFitActiveRef.current = false;

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

  const getCenteredViewportForScale = useCallback(
    (scaleInput: number) => {
      if (!activePage) return null;
      const scale = clamp(scaleInput, MIN_SCALE, MAX_SCALE);
      return {
        x: (containerSize.width - activePage.width * scale) / 2,
        y: (containerSize.height - activePage.height * scale) / 2,
        scale,
      };
    },
    [activePage, containerSize.height, containerSize.width]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      autoFitActiveRef.current = false;
      const next = getCenteredViewportForScale(viewport.scale * factor);
      if (!next) return;
      updateViewport(next);
    },
    [getCenteredViewportForScale, updateViewport, viewport.scale]
  );

  const setZoomScale = useCallback(
    (scaleInput: number) => {
      autoFitActiveRef.current = false;
      const next = getCenteredViewportForScale(scaleInput);
      if (!next) return;
      updateViewport(next);
    },
    [getCenteredViewportForScale, updateViewport]
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
      const { scale: previewScale } = getPreviewRenderSpec(activePage, maxDimension);
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

  // Mounts the hidden export stage on demand and resolves once Konva has actually
  // committed it, so callers can use exportStageRef synchronously afterwards.
  // Returns null if the stage could not be mounted (no active page / unmounted).
  const ensureExportStage = useCallback(async () => {
    if (exportStageRef.current) return exportStageRef.current;

    flushSync(() => {
      setExportStageRequested(true);
    });
    if (exportStageRef.current) return exportStageRef.current;

    // Fallback: give React/Konva a couple of frames to attach the ref. Each wait races a timer
    // because a backgrounded tab throttles rAF to a standstill — without it, any caller that
    // awaits this (save, preview, filmstrip) would hang instead of failing fast.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        requestAnimationFrame(done);
        window.setTimeout(done, 150);
      });
      if (exportStageRef.current) return exportStageRef.current;
    }
    return null;
  }, []);

  // Release the on-demand mount. The stage stays mounted while a real preview
  // recording is in flight (previewGenerationActive drives it independently).
  const releaseExportStage = useCallback(() => {
    setExportStageRequested(false);
  }, []);

  const renderExportPageToCanvas = useCallback(
    () => {
      const stage = exportStageRef.current;
      if (!stage || !activePage) return null;

      try {
        const canvas = stage.toCanvas({
          x: 0,
          y: 0,
          width: exportCanvasSpec.width,
          height: exportCanvasSpec.height,
          pixelRatio: 1,
        });
        return {
          canvas,
          width: exportCanvasSpec.width,
          height: exportCanvasSpec.height,
        };
      } catch {
        return null;
      }
    },
    [activePage, exportCanvasSpec.height, exportCanvasSpec.width]
  );

  /**
   * Warms the browser's image cache for a page before it is drawn off-screen. `use-image`
   * resolves asynchronously, so a page whose media has never been decoded would otherwise
   * rasterize blank — capturing an empty thumbnail is worse than capturing none.
   */
  const preloadPageImageSources = useCallback(async (page: EditorPage) => {
    const sources = new Set<string>();
    const add = (value: unknown) => {
      const source = String(value || "").trim();
      if (source) sources.add(source);
    };

    if (page.background?.type === "image") {
      add(page.background.imageThumbnailUri || page.background.imageUri);
    }
    page.elements.forEach((element) => {
      if (!element.visible) return;
      if (element.type === "image") add(element.src);
      if (element.type === "frame" && element.frameContent?.kind === "image") {
        add(element.frameContent.src);
      }
    });

    const MAX_PRELOADS = 40;
    const PRELOAD_TIMEOUT_MS = 4000;
    await Promise.all(
      Array.from(sources)
        .slice(0, MAX_PRELOADS)
        .map(
          (source) =>
            new Promise<void>((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                resolve();
              };
              const timeoutId = window.setTimeout(done, PRELOAD_TIMEOUT_MS);
              const image = new window.Image();
              image.crossOrigin = "anonymous";
              // Videos and unreachable media land on error — a missing layer must not stall
              // (or fail) the whole save.
              image.onload = () => {
                window.clearTimeout(timeoutId);
                done();
              };
              image.onerror = () => {
                window.clearTimeout(timeoutId);
                done();
              };
              image.src = source;
            })
        )
    );
  }, []);

  /**
   * Thumbnails ANY page, including one the user has never opened, by pointing the hidden
   * export stage at it. The visible canvas, selection and playhead are untouched.
   */
  const captureThumbnailDataUrlForPage = useCallback(
    async (pageId: string) => {
      const targetPage = pages.find((page) => page.id === pageId);
      if (!targetPage) return "";
      // A hidden tab pauses compositing, so anything drawn now rasterizes EMPTY. Capturing
      // would silently store a blank tile — worse than storing none, since the app trusts a
      // shipped preview. Bail and let the client render that page itself.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return "";
      // The active page is already composited on the live stage — no off-screen work needed.
      if (targetPage.id === activePage?.id) return captureThumbnailDataUrl();
      // The export stage is single-tenant; a preview recording owns it while it runs.
      if (previewGenerationActive) return "";

      await preloadPageImageSources(targetPage);

      flushSync(() => {
        setExportPageIdOverride(pageId);
      });

      const stage = await ensureExportStage();
      if (!stage) {
        flushSync(() => {
          setExportPageIdOverride("");
        });
        return "";
      }

      // A BACKGROUND tab throttles requestAnimationFrame to a standstill, so a bare rAF await
      // would hang the save forever (the Save button stays "Saving..." and the template is
      // never written). Every wait here races a timer so the capture always completes.
      const waitForCanvasFrame = async () => {
        const frameOrTimeout = () =>
          new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            requestAnimationFrame(done);
            window.setTimeout(done, 150);
          });
        await frameOrTimeout();
        await frameOrTimeout();
      };

      try {
        const spec = getPreviewRenderSpec(targetPage, exportMaxDimension);
        await waitForCanvasFrame();
        // use-image resolves on its own load event even from cache, so give the scene a beat
        // to swap the decoded bitmaps in before rasterizing.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
        stage.batchDraw();
        await waitForCanvasFrame();

        const pixelRatio = Math.min(
          1,
          Math.max(0.05, PAGE_THUMBNAIL_MAX_WIDTH_PX / Math.max(spec.width, 1))
        );

        // Rasterize to a canvas first so the result can be PROVEN non-empty. A page that never
        // actually painted comes back fully transparent, which JPEG then encodes as solid
        // black — indistinguishable from real content once it is a data URL. Any opaque pixel
        // means the scene (at minimum its background) rendered.
        const canvas = stage.toCanvas({
          x: 0,
          y: 0,
          width: spec.width,
          height: spec.height,
          pixelRatio,
        }) as HTMLCanvasElement;
        const context = canvas.getContext("2d");
        if (!context) return "";
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let painted = false;
        // Sample every ~29th pixel: enough to detect a rendered page, cheap on a 168px tile.
        for (let offset = 3; offset < data.length; offset += 4 * 29) {
          if (data[offset] !== 0) {
            painted = true;
            break;
          }
        }
        if (!painted) return "";

        return String(canvas.toDataURL("image/jpeg", 0.72) || "").trim();
      } catch {
        return "";
      } finally {
        flushSync(() => {
          setExportPageIdOverride("");
        });
        releaseExportStage();
      }
    },
    [
      activePage?.id,
      captureThumbnailDataUrl,
      ensureExportStage,
      exportMaxDimension,
      pages,
      preloadPageImageSources,
      previewGenerationActive,
      releaseExportStage,
    ]
  );

  const recordTimelinePreviewVideo = useCallback(
    async (options?: { fps?: number; maxDimension?: number; durationMs?: number; signal?: AbortSignal }) => {
      if (!activePage) return null;
      const stage = await ensureExportStage();
      if (!stage) return null;
      const ensureNotAborted = () => {
        if (options?.signal?.aborted) {
          throw createAbortError("Preview generation was canceled.");
        }
      };
      ensureNotAborted();
      const fps = resolvePreviewRenderFps(options?.fps ?? designTimeline.fps);
      const durationMs = Math.max(
        300,
        Math.round(
          Number(options?.durationMs) ||
            Number(designTimeline.totalDurationMs) ||
            Number(activePageDurationMs) ||
            0
        )
      );
      const requestedMaxDimension = Math.max(120, Math.round(Number(options?.maxDimension) || 720));
      let posterDataUrl = "";
      const frameDurationMs = 1000 / Math.max(1, fps);
      const recorderMimeType = getSupportedPreviewRecorderMimeType();
      const getRecordedExtension = (mimeType: string) => {
        const normalized = String(mimeType || "").trim().toLowerCase();
        if (normalized.includes("mp4")) return "mp4";
        if (normalized.includes("ogg")) return "ogv";
        return "webm";
      };

      let recordingStream: MediaStream | null = null;
      let recorder: MediaRecorder | null = null;
      let abortListener: (() => void) | null = null;
      let restoreTimelinePlayheadMs = timelinePlayheadMsRef.current;

      try {
        restoreTimelinePlayheadMs = timelinePlayheadMsRef.current;
        setTimelinePlaying(false);
        setTimelinePlayheadMs(0);
        flushSync(() => {
          setExportMaxDimension(requestedMaxDimension);
          setExportFrameOverride(0);
        });
        await waitForAnimationFrame();
        await waitForStageDrawableMedia(stage);
        await syncExportPreviewMediaControllers(0, fps);
        stage.getLayers().forEach((layer) => layer.draw());
        await waitForAnimationFrame();
        ensureNotAborted();

        const initialCapture = renderExportPageToCanvas();
        if (!initialCapture) {
          throw new Error("Unable to capture the current template preview.");
        }

        try {
          posterDataUrl = initialCapture.canvas.toDataURL("image/png");
        } catch {
          posterDataUrl = "";
        }

        const exportLayer = stage.getLayers()[0];
        if (!exportLayer || typeof exportLayer.getNativeCanvasElement !== "function") {
          throw new Error("Preview export canvas is unavailable.");
        }
        const exportCanvas = exportLayer.getNativeCanvasElement();
        if (!exportCanvas || typeof exportCanvas.captureStream !== "function") {
          throw new Error("Canvas stream recording is not supported in this browser.");
        }

        recordingStream = exportCanvas.captureStream(0);
        let requestCapturedFrame: (() => void) | null = null;
        const initialTrack = recordingStream.getVideoTracks()[0] as MediaStreamTrack & {
          requestFrame?: () => void;
        };
        if (initialTrack && typeof initialTrack.requestFrame === "function") {
          requestCapturedFrame = () => initialTrack.requestFrame?.();
        } else {
          recordingStream.getTracks().forEach((track) => track.stop());
          recordingStream = exportCanvas.captureStream(fps);
        }
        const mediaRecorderOptions =
          recorderMimeType && recorderMimeType.length > 0
            ? ({
                mimeType: recorderMimeType,
                videoBitsPerSecond: 2_500_000,
              } satisfies MediaRecorderOptions)
            : ({
                videoBitsPerSecond: 2_500_000,
              } satisfies MediaRecorderOptions);
        recorder = new MediaRecorder(recordingStream, mediaRecorderOptions);
        const activeRecorder = recorder;

        const recordedSource = await new Promise<{ blob: Blob; mimeType: string }>((resolve, reject) => {
          const chunks: Blob[] = [];
          let settled = false;
          let aborted = false;

          const cleanup = () => {
            if (abortListener && options?.signal) {
              options.signal.removeEventListener("abort", abortListener);
            }
          };
          const rejectOnce = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error || "Preview recording failed.")));
          };
          const resolveOnce = (value: { blob: Blob; mimeType: string }) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
          };

          activeRecorder.addEventListener(
            "dataavailable",
            (event) => {
              if (event.data && event.data.size > 0) {
                chunks.push(event.data);
              }
            },
            { passive: true }
          );
          activeRecorder.addEventListener(
            "error",
            (event) => {
              const recorderError = (event as Event & { error?: Error }).error;
              rejectOnce(recorderError || new Error("Preview recorder failed."));
            },
            { once: true }
          );
          activeRecorder.addEventListener(
            "stop",
            () => {
              if (aborted) {
                rejectOnce(createAbortError("Preview generation was canceled."));
                return;
              }
              const mimeType =
                String(activeRecorder.mimeType || recorderMimeType || "video/webm").trim() || "video/webm";
              const blob = new Blob(chunks, { type: mimeType });
              if (blob.size <= 0) {
                rejectOnce(new Error("Preview recorder did not produce a video."));
                return;
              }
              resolveOnce({ blob, mimeType });
            },
            { once: true }
          );
          const started = new Promise<void>((resolveStart, rejectStart) => {
            activeRecorder.addEventListener("start", () => resolveStart(), { once: true });
            activeRecorder.addEventListener(
              "error",
              (event) => {
                const recorderError = (event as Event & { error?: Error }).error;
                rejectStart(recorderError || new Error("Preview recorder failed to start."));
              },
              { once: true }
            );
          });
          abortListener = () => {
            aborted = true;
            if (recorder && recorder.state !== "inactive") {
              try {
                recorder.stop();
              } catch {
                rejectOnce(createAbortError("Preview generation was canceled."));
              }
              return;
            }
            rejectOnce(createAbortError("Preview generation was canceled."));
          };
          if (options?.signal) {
            options.signal.addEventListener("abort", abortListener, { once: true });
          }

          const runPlayback = async () => {
            activeRecorder.start(250);
            await started;
            ensureNotAborted();

            setTimelinePlayheadMs(0);
            await syncExportPreviewMediaControllers(0, fps);
            stage.getLayers().forEach((layer) => layer.draw());
            requestCapturedFrame?.();
            await waitForAnimationFrame();
            setTimelinePlaying(true);

            const startedAt = performance.now();
            let lastCapturedFrame = 0;

            while (true) {
              ensureNotAborted();
              const elapsedMs = Math.max(0, performance.now() - startedAt);
              const playheadMs = Math.max(
                0,
                Math.min(
                  durationMs,
                  timelinePlayheadMsRef.current - activePageTimelineStartMs
                )
              );
              const livePlayheadFrame = getFrameAlignedPlayheadFrame(
                playheadMs,
                previewRenderFps,
                activePageDurationMs
              );

              if (livePlayheadFrame !== lastCapturedFrame) {
                await syncExportPreviewMediaControllers(livePlayheadFrame, fps);
                lastCapturedFrame = livePlayheadFrame;
              }

              stage.getLayers().forEach((layer) => layer.draw());
              requestCapturedFrame?.();

              if (playheadMs >= durationMs || elapsedMs >= durationMs + frameDurationMs) {
                break;
              }
              await waitForAnimationFrame();
            }

            setTimelinePlaying(false);
            await syncExportPreviewMediaControllers(
              getFrameAlignedPlayheadFrame(durationMs, previewRenderFps, activePageDurationMs),
              fps
            );
            await waitForAnimationFrame();
            stage.getLayers().forEach((layer) => layer.draw());
            requestCapturedFrame?.();
            if (activeRecorder.state === "recording") {
              try {
                activeRecorder.requestData();
              } catch {
                // Ignore browsers that do not support requestData mid-recording.
              }
              activeRecorder.stop();
            }
          };

          void runPlayback().catch((error) => {
            rejectOnce(error);
            if (recorder && recorder.state !== "inactive") {
              try {
                recorder.stop();
              } catch {
                // Ignore recorder shutdown errors after a playback failure.
              }
            }
          });
        });

        ensureNotAborted();
        const formData = new FormData();
        formData.set("fps", String(fps));
        formData.set("expectedDurationMs", String(durationMs));
        formData.set("mimeType", recordedSource.mimeType);
        formData.set(
          "sourceVideo",
          new File(
            [recordedSource.blob],
            `preview-source.${getRecordedExtension(recordedSource.mimeType)}`,
            { type: recordedSource.mimeType || "video/webm" }
          )
        );

        const response = await fetch("/api/editor/media/encode-preview", {
          method: "POST",
          body: formData,
          signal: options?.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({} as { error?: string }));
          throw new Error(payload?.error || "Preview encoder failed to create the video.");
        }
        const mimeType =
          String(response.headers.get("content-type") || "video/mp4").trim() || "video/mp4";
        const encodedBytes = await response.arrayBuffer();
        const blob = new Blob([encodedBytes], { type: mimeType });

        return {
          blob,
          mimeType,
          durationMs,
          posterDataUrl,
          width: exportCanvas.width,
          height: exportCanvas.height,
        };
      } finally {
        if (abortListener && options?.signal) {
          options.signal.removeEventListener("abort", abortListener);
        }
        if (recorder && recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // Ignore recorder shutdown errors during cleanup.
          }
        }
        recordingStream?.getTracks().forEach((track) => track.stop());
        setTimelinePlaying(false);
        setTimelinePlayheadMs(restoreTimelinePlayheadMs);
        flushSync(() => {
          setExportFrameOverride(0);
        });
        stage.getLayers().forEach((layer) => layer.draw());
        releaseExportStage();
      }
    },
    [
      activePage,
      activePageDurationMs,
      designTimeline.fps,
      designTimeline.totalDurationMs,
      activePageTimelineStartMs,
      previewRenderFps,
      renderExportPageToCanvas,
      syncExportPreviewMediaControllers,
      setTimelinePlayheadMs,
      setTimelinePlaying,
      ensureExportStage,
      releaseExportStage,
    ]
  );

  const captureTimelineStripDataUrls = useCallback(
    async (playheadsMs: number[]) => {
      // Render filmstrip frames from the HIDDEN export stage (exportFrameOverride), never the main
      // stage: hijacking the main stage (captureFrameOverride) blanked the editor behind a blocking
      // "Generating preview" overlay on every load/edit — and on long timeline imports that capture
      // takes long enough to read as a hang. The export stage mirrors the same elements offscreen.
      if (!activePage || !Array.isArray(playheadsMs) || playheadsMs.length === 0) {
        return [];
      }
      if (previewGenerationActive) {
        // The export stage is busy recording the real preview video — skip this strip pass.
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

      const stage = await ensureExportStage();
      if (!stage) return [];

      const waitForCanvasFrame = async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      };

      // Filmstrip thumbs are tiny — capture downscaled so 10-24 frames stay cheap.
      const thumbnailPixelRatio = Math.min(
        1,
        Math.max(0.05, 160 / Math.max(exportCanvasSpec.height, exportCanvasSpec.width, 1))
      );

      const captures: string[] = [];
      try {
        for (const playhead of playheadsMs) {
          flushSync(() => {
            setExportFrameOverride(
              getFrameAlignedPlayheadFrame(
                clamp(Number(playhead) || 0, 0, activePageDurationMs),
                previewRenderFps,
                activePageDurationMs
              )
            );
          });
          await waitForCanvasFrame();
          stage.batchDraw();
          await waitForCanvasFrame();
          try {
            const captured = String(
              stage.toDataURL({
                x: 0,
                y: 0,
                width: exportCanvasSpec.width,
                height: exportCanvasSpec.height,
                pixelRatio: thumbnailPixelRatio,
                mimeType: "image/png",
              }) || ""
            ).trim();
            if (captured) {
              captures.push(captured);
            }
          } catch {
            // Skip frames that fail to rasterize; the strip tolerates gaps.
          }
        }
      } finally {
        flushSync(() => {
          setExportFrameOverride(0);
        });
        releaseExportStage();
      }

      return captures;
    },
    [
      activePage,
      activePageDurationMs,
      exportCanvasSpec.height,
      exportCanvasSpec.width,
      previewGenerationActive,
      previewRenderFps,
      ensureExportStage,
      releaseExportStage,
    ]
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

  // On first load / refresh, always start the template at 50% zoom. Applied SYNCHRONOUSLY (no
  // rAF) so it can't be starved by the re-render churn during template load — an earlier rAF
  // version was cancelled on every re-render and left the default 100%. It keeps re-applying
  // (centered) as the ResizeObserver reports the real container size, and the `autoFitActiveRef`
  // flag (cleared by any manual zoom/pan below) stops it from ever overriding the user.
  useEffect(() => {
    if (!activePage) return;
    if (!containerSize.width || !containerSize.height) return;
    if (autoFitPageIdRef.current !== activePage.id) {
      autoFitPageIdRef.current = activePage.id;
      autoFitActiveRef.current = true;
    }
    if (!autoFitActiveRef.current) return;
    const next = getCenteredViewportForScale(0.5);
    if (next) updateViewport(next);
  }, [
    activePage,
    containerSize.height,
    containerSize.width,
    getCenteredViewportForScale,
    updateViewport,
  ]);

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

  // Text boxes derive their height from their text, so the vertical-only handles are dropped for
  // a selection made purely of (uncurved) text — dragging them would just snap back.
  const transformerAnchors = useMemo(() => {
    if (selectedIds.length === 0) return TRANSFORMER_ANCHORS;
    const allText = selectedIds.every((id) => {
      const element = elements.find((item) => item.id === id);
      return Boolean(element && element.type === "text" && !isCurvedText(element));
    });
    return allText ? TEXT_TRANSFORMER_ANCHORS : TRANSFORMER_ANCHORS;
  }, [elements, selectedIds]);

  const syncTransformerVisuals = useCallback(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const anchor = transformer.getActiveAnchor?.();
    if (anchor) activeAnchorRef.current = anchor;
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

    // Konva measures a text node's lines ONCE (in _setTextData, on construction and on
    // text-affecting attr changes) and caches the wrap points plus each line's width — a
    // repaint never re-measures. So when a custom font finishes loading after the nodes were
    // built, batchDraw alone paints the real glyphs over a layout measured with the FALLBACK
    // font: the wrap is off, and align is visibly wrong because Konva positions each line by
    // `totalWidth - line.width` using the stale width. Editing any text attr (align included)
    // silently repaired it, which is why it only looked broken until the toolbar was touched.
    // Force the re-measure instead.
    const remeasureText = () => {
      stage.find("Text, TextPath").forEach((node) => {
        (node as unknown as { _setTextData?: () => void })._setTextData?.();
      });
      stage.batchDraw();
    };

    let cancelled = false;
    const loadFontsAndRedraw = async () => {
      if (document.fonts?.load) {
        await Promise.allSettled(
          textFamilies.map((family) => document.fonts.load(`16px "${family.replace(/"/g, '\\"')}"`))
        );
      }
      if (!cancelled) {
        remeasureText();
      }
    };

    void loadFontsAndRedraw();

    const handleLoadingDone = () => {
      // Box measurements taken while a family was still resolving to the fallback are stale the
      // moment the real font lands — this is the browser's own "new fonts arrived" signal.
      clearTextBoxMeasurementCache();
      remeasureText();
    };
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

  useEffect(() => {
    setStageApi({
      zoomIn: () => zoomBy(1.12),
      zoomOut: () => zoomBy(1 / 1.12),
      fitToScreen,
      exportPng,
      captureThumbnailDataUrl,
      captureThumbnailDataUrlForPage,
      captureTimelineStripDataUrls,
      recordTimelinePreviewVideo,
      mergeSelectedLayers,
    });

    return () => setStageApi(null);
  }, [
    captureThumbnailDataUrl,
    captureThumbnailDataUrlForPage,
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
      autoFitActiveRef.current = false;

      const direction = event.evt.deltaY > 0 ? -1 : 1;
      const factor = direction > 0 ? 1.08 : 1 / 1.08;
      const next = getCenteredViewportForScale(viewport.scale * factor);
      if (!next) return;
      updateViewport(next);
    },
    [getCenteredViewportForScale, updateViewport, viewport.scale]
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
      const signX = scaleX < 0 ? -1 : 1;
      const signY = scaleY < 0 ? -1 : 1;

      // Text has two distinct resize behaviors, chosen by which handle is dragged:
      //   • corner handles → RESIZE the text: scale fontSize + box by one factor,
      //     so the wrapping / line breaks stay identical — just bigger or smaller.
      //   • middle-left / middle-right → change WIDTH only, which re-wraps (reflows).
      // top-center / bottom-center fall through to the default height behavior.
      if (element.type === "text") {
        const anchor =
          activeAnchorRef.current || transformerRef.current?.getActiveAnchor?.() || "";
        const isCorner =
          anchor === "top-left" ||
          anchor === "top-right" ||
          anchor === "bottom-left" ||
          anchor === "bottom-right";
        const isSideMiddle = anchor === "middle-left" || anchor === "middle-right";

        if (isCorner) {
          // One scale factor for font + box preserves wrapping (each line holds the
          // same characters because glyphs and box widen by the same ratio).
          const scale = Math.max(Math.abs(scaleX), Math.abs(scaleY)) || 1;
          updateElement(element.id, {
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            width: Math.max(2, element.width * scale),
            height: Math.max(2, element.height * scale),
            fontSize: Math.max(1, (Number(element.fontSize) || 1) * scale),
            scaleX: signX,
            scaleY: signY,
          });
          node.scaleX(signX);
          node.scaleY(signY);
          setSnapGuides({ x: null, y: null });
          return;
        }

        if (isSideMiddle) {
          // Width only → the text reflows; keep fontSize and let height auto-fit.
          updateElement(element.id, {
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            width: Math.max(2, element.width * Math.abs(scaleX)),
            scaleX: signX,
            scaleY: 1,
          });
          node.scaleX(signX);
          node.scaleY(1);
          setSnapGuides({ x: null, y: null });
          return;
        }
      }

      const nextWidth = Math.max(2, element.width * Math.abs(scaleX));
      const nextHeight = Math.max(2, element.height * Math.abs(scaleY));

      updateElement(element.id, {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: nextWidth,
        height: nextHeight,
        scaleX: signX,
        scaleY: signY,
      });

      node.scaleX(signX);
      node.scaleY(signY);
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

  const inlineEditActiveRef = useRef(false);

  const beginInlineTextEdit = useCallback(
    (node: Konva.Node, element: EditorElement) => {
      const stage = stageRef.current;
      if (!stage || !containerRef.current) return;
      if (inlineEditActiveRef.current) return; // a textarea is already open
      inlineEditActiveRef.current = true;

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
        inlineEditActiveRef.current = false;
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

  // A text layer's selection overlay IS its Konva box, so a box bigger than the text reads as
  // padding around the glyphs, and a box that ignores `fontSize` looks frozen at its old size
  // when the font size changes. Keep every text box glued to the text it renders:
  //   • height is ALWAYS the measured line stack — no dead vertical space, and it follows the
  //     font size, line height, wrapping and edits for free. Text draws from the top of the box
  //     (no verticalAlign anywhere), so shrinking it never moves a glyph.
  //   • width is only re-fitted for a box that is HUGGING its text. A narrower box is wrapping
  //     on purpose and a much wider one was widened on purpose, so both keep their width and
  //     only re-wrap. A hugging box is re-measured unconstrained, so it grows/shrinks with the
  //     font size instead of folding the line — and `x` shifts by the alignment rule so the
  //     glyphs stay in the exact same spot while the box resizes around them.
  const textBoxFitsRef = useRef<Map<string, { fontSize: number; width: number; hugging: boolean }>>(
    new Map()
  );
  const pendingFontWaitRef = useRef(false);
  const [textMetricsTick, setTextMetricsTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (inlineEditActiveRef.current) return; // mid-edit: the textarea owns the box

    let waitingOnFonts = false;

    elements.forEach((element) => {
      if (element.type !== "text" || isCurvedText(element)) return;
      const text = String(element.text || "");
      if (!text.trim()) return;
      const fontSize = Number(element.fontSize) || 0;
      if (fontSize <= 0) return;

      const fontFamily = resolveCssFontFamily(element.fontFamily);
      try {
        // Measuring against the fallback font would size the box for glyphs nobody sees.
        if (document.fonts?.check && !document.fonts.check(`${fontSize}px ${fontFamily}`)) {
          waitingOnFonts = true;
          return;
        }
      } catch {
        /* measure anyway when the check isn't supported */
      }

      const input: TextBoxInput = {
        text,
        fontSize,
        fontFamily,
        fontStyle: toKonvaFontStyle(element.fontStyle, element.fontWeight),
        letterSpacing: Number(element.letterSpacing) || 0,
        lineHeight: Number(element.lineHeight) || 1,
        align: element.align,
        direction: resolveTextDirection(text),
      };

      const currentWidth = Math.max(0, Number(element.width) || 0);
      const currentHeight = Math.max(0, Number(element.height) || 0);
      const previous = textBoxFitsRef.current.get(element.id);
      // Still hugging as long as nothing has resized the box since the last fit — a resize
      // (side handle, corner drag, imported width) hands the width back to the user.
      const hugsText = Boolean(previous?.hugging) && Math.abs((previous?.width ?? 0) - currentWidth) < 0.5;
      const fit = resolveSnugTextBox(input, hugsText ? null : currentWidth);
      if (!fit) return;

      textBoxFitsRef.current.set(element.id, {
        fontSize,
        width: fit.width,
        hugging: fit.hugging,
      });

      const widthChanged = Math.abs(fit.width - currentWidth) > 0.5;
      const heightChanged = Math.abs(fit.height - currentHeight) > 0.5;
      if (!widthChanged && !heightChanged) return;

      // The box resizes around the glyphs, so re-anchor it. A line sits inside the box by
      // `align`, so the shift runs along the box's own x axis — through the node's scale (a
      // flipped box moves the other way) and rotation, since `x`/`y` live in page space. The
      // height only ever grows/shrinks downward (text draws from the top), so `y` is untouched
      // by it.
      let nextX = Number(element.x) || 0;
      let nextY = Number(element.y) || 0;
      if (widthChanged) {
        const localShift =
          textBoxAnchorDeltaX(element.align, currentWidth, fit.width) * (Number(element.scaleX) || 1);
        const radians = ((Number(element.rotation) || 0) * Math.PI) / 180;
        nextX += localShift * Math.cos(radians);
        nextY += localShift * Math.sin(radians);
      }

      updateElement(
        element.id,
        {
          width: fit.width,
          height: fit.height,
          ...(widthChanged ? { x: nextX, y: nextY } : {}),
        },
        // An automatic box fit is not an edit the user should have to undo.
        { recordHistory: false }
      );
    });

    // Re-run once the fonts that were still loading arrive. Gated on `status === "loading"` so a
    // family that never resolves can't spin this forever.
    if (waitingOnFonts && !pendingFontWaitRef.current && document.fonts?.status === "loading") {
      pendingFontWaitRef.current = true;
      void document.fonts.ready
        .catch(() => undefined)
        .then(() => {
          pendingFontWaitRef.current = false;
          setTextMetricsTick((tick) => tick + 1);
        });
    }
  }, [elements, textMetricsTick, updateElement]);

  // The scene handlers below are hoisted out of the JSX and memoized on purpose:
  // CanvasPageScene is wrapped in React.memo, and a fresh inline arrow on every
  // render would defeat it (re-rendering every element node each frame).
  const handleEnterFrameContentEdit = useCallback(
    (element: EditorElement) => {
      if (!element.frameContent) return;
      setSelectedIds([element.id]);
      setFrameContentEditId(element.id);
    },
    [setSelectedIds]
  );

  const handleUpdateFrameContentTransform = useCallback(
    (element: EditorElement, patch: Partial<FrameContentTransform>) => {
      updateFrameContentTransform(element.id, patch, { recordHistory: true });
    },
    [updateFrameContentTransform]
  );

  const handleUpdateFrameContentMetadata = useCallback(
    (element: EditorElement, patch: Partial<NonNullable<EditorElement["frameContent"]>>) => {
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
    },
    [setFrameContent]
  );

  const handleUpdateImageMetadata = useCallback(
    (element: EditorElement, { width, height }: { width: number; height: number }) => {
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
    },
    [updateElement]
  );

  const handleUpdateVideoMetadata = useCallback(
    (element: EditorElement, { duration }: { duration: number }) => {
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
    },
    [updateElement]
  );

  // Fallback so double-clicking a selected text always opens the inline editor —
  // even if the click lands on a Transformer anchor/border rather than the text
  // node itself. The guard in beginInlineTextEdit prevents a duplicate textarea
  // when the text node's own onDblClick also fires.
  const handleStageDoubleClick = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const element = elements.find((item) => item.id === id);
    if (!element || element.type !== "text") return;
    const node = nodeRefs.current[id];
    if (node) beginInlineTextEdit(node, element);
  }, [selectedIds, elements, beginInlineTextEdit]);

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
              // Bake SVG assets (e.g. built-in shapes dragged onto the canvas) at
              // a higher resolution so they stay crisp when enlarged — matches the
              // shapes panel's click-to-add path. Non-SVG sources are unchanged.
              resolvedSrc = await rasterizeSvgDataUrlToPngDataUrl(next.src, {
                scale: SVG_SHAPE_RASTER_SCALE,
              });
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
              // Keep the raw SVG; the canvas derives a crisp, content-cropped, high-resolution
              // vector from it + the layer crop at render time (see CanvasImageNode).
              ...(isSvgDataUrlSource(next.src) ? { vectorSrc: next.src } : {}),
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

  // Must be stable: it is passed to the memoized CanvasPageScene, and a fresh
  // identity each render would defeat the memo for the entire scene tree.
  const setNodeRef = useCallback((id: string, node: Konva.Node | null) => {
    nodeRefs.current[id] = node;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#d7d7d9]"
      onDragOver={handleCanvasDragOver}
      onDragLeave={() => clearFrameDropTarget(true)}
      onDrop={onDropAsset}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-start px-4">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[#d8dde6] bg-white/94 px-3 py-2 shadow-[0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.12)}
            aria-label="Zoom out"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#5b6472] transition hover:bg-[#eef2f8]"
          >
            <Minus size={13} />
          </button>
          <span className="min-w-[42px] text-[13px] font-semibold leading-none tracking-[0.01em] text-[#2b3445]">
            {zoomPercent}%
          </span>
          <input
            type="range"
            min={10}
            max={400}
            step={1}
            value={zoomPercent}
            onChange={(event) => {
              const nextPercent = Number(event.target.value);
              if (!Number.isFinite(nextPercent)) return;
              setZoomScale(nextPercent / 100);
            }}
            aria-label="Canvas zoom"
            className="h-1.5 w-[150px] cursor-pointer accent-[#9aa5b5]"
          />
          <button
            type="button"
            onClick={() => zoomBy(1.12)}
            aria-label="Zoom in"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#5b6472] transition hover:bg-[#eef2f8]"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
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
          autoFitActiveRef.current = false;
          updateViewport({ x: event.target.x(), y: event.target.y(), scale: viewport.scale });
        }}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onTouchMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchEnd={handleStageMouseUp}
        onDblClick={handleStageDoubleClick}
        onDblTap={handleStageDoubleClick}
      >
        <Layer>
          <CanvasPageScene
            page={activePage}
            elements={elements}
            selectedIds={selectedIds}
            pageDurationMs={activePageDurationMs}
            playheadMs={effectiveActivePagePlayheadMs}
            playheadFrame={effectiveActivePageFrame}
            previewFps={previewRenderFps}
            forceTimelineSync={forceTimelineMediaSync}
            interactive
            toolMode={toolMode}
            frameDropTargetId={frameDropTargetId}
            frameContentEditId={frameContentEditId}
            includePageOutline
            registerRef={setNodeRef}
            registerPreviewMediaController={registerPreviewMediaController}
            onSelectNode={selectNode}
            onOpenContextMenu={openContextMenu}
            onNodeDragMove={updateNodeDrag}
            onNodeDragEnd={finishNodeDrag}
            onNodeTransform={syncTransformerVisuals}
            onNodeTransformEnd={updateNodeTransform}
            onEnterFrameContentEdit={handleEnterFrameContentEdit}
            onUpdateFrameContentTransform={handleUpdateFrameContentTransform}
            onUpdateFrameContentMetadata={handleUpdateFrameContentMetadata}
            onUpdateImageMetadata={handleUpdateImageMetadata}
            onUpdateVideoMetadata={handleUpdateVideoMetadata}
            onBeginInlineTextEdit={beginInlineTextEdit}
          />
          <Group
            clipX={0}
            clipY={0}
            clipWidth={activePage.width}
            clipHeight={activePage.height}
          >
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
            // Overdraw makes the Transformer capture every click inside the
            // selected layer's bounds (drawn on top of all layers). Kept OFF for
            // on-canvas layers — otherwise it traps clicks meant for other layers;
            // with it off a click always resolves to the top-most *visible* layer
            // under the cursor (see the alpha-mask hitFunc above), and a layer is
            // dragged by grabbing its visible pixels / resized via the anchors.
            // EXCEPTION: when the layer's center sits outside the page (it's been
            // moved into the pasteboard) it has no visible pixels on the canvas to
            // grab, so enable whole-area drag to let it be picked up and moved back.
            // An off-canvas layer doesn't overlap canvas layers, so it can't trap
            // their clicks.
            shouldOverdrawWholeArea={(() => {
              if (selectedIds.length !== 1) return false;
              const selected = elements.find((element) => element.id === selectedIds[0]);
              if (!selected) return false;
              const renderedWidth = (Number(selected.width) || 0) * (Number(selected.scaleX) || 1);
              const renderedHeight = (Number(selected.height) || 0) * (Number(selected.scaleY) || 1);
              const centerX = (Number(selected.x) || 0) + renderedWidth / 2;
              const centerY = (Number(selected.y) || 0) + renderedHeight / 2;
              return (
                centerX < 0 ||
                centerY < 0 ||
                centerX > activePage.width ||
                centerY > activePage.height
              );
            })()}
            enabledAnchors={transformerAnchors}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox;
              }
              return newBox;
            }}
          />
        </Layer>
      </Stage>
      {exportStageMounted ? (
        <div
          ref={exportStageHostRef}
          aria-hidden="true"
          className="pointer-events-none fixed opacity-0"
          style={{
            left: -100000,
            top: 0,
            width: exportCanvasSpec.width,
            height: exportCanvasSpec.height,
            overflow: "hidden",
          }}
        >
          <Stage
            ref={(node) => {
              exportStageRef.current = node;
            }}
            width={exportCanvasSpec.width}
            height={exportCanvasSpec.height}
          >
            <Layer listening={false}>
              <Group scaleX={exportCanvasSpec.scale} scaleY={exportCanvasSpec.scale}>
                <CanvasPageScene
                  page={exportPage}
                  elements={exportElements}
                  pageDurationMs={exportPageDurationMs}
                  // An off-screen page is thumbnailed at its own start, not at the active
                  // page's playhead (which is meaningless for a different page).
                  playheadMs={exportPageIdOverride ? 0 : effectiveExportPlayheadMs}
                  playheadFrame={exportPageIdOverride ? 0 : effectiveExportPlayheadFrame}
                  previewFps={previewRenderFps}
                  forceTimelineSync
                  interactive={false}
                  toolMode={toolMode}
                  includePageOutline={false}
                  registerRef={registerExportNodeRef}
                  registerPreviewMediaController={registerExportPreviewMediaController}
                />
              </Group>
            </Layer>
          </Stage>
        </div>
      ) : null}

      {showBlockingPreviewOverlay ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#d7d7d9]">
          <div className="rounded-2xl border border-white/80 bg-white/92 px-5 py-3 text-center shadow-lg">
            <div className="text-sm font-semibold text-[#111827]">Generating preview</div>
            <div className="mt-1 text-xs text-[#6b7280]">Please wait while the template preview is rendered.</div>
          </div>
        </div>
      ) : null}

      {previewGenerationActive ? (
        <div className="pointer-events-none absolute right-5 top-5 z-10 rounded-full border border-white/80 bg-white/92 px-3 py-1.5 text-xs font-medium text-[#111827] shadow-md">
          Recording timeline preview...
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
    </div>
  );
}
