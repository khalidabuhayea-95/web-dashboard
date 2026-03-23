"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import useImage from "use-image";
import { Copy, Layers, Trash2 } from "lucide-react";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
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
  normalizeRasterColorMap,
  recolorRasterSourceToDataUrl,
  serializeRasterColorMap,
} from "@/lib/editor/imagePalette";
import { dataUrlToFile, uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { resolveCssFontFamily } from "@/lib/templates/fontCatalog";

interface ImageNodeProps {
  element: EditorElement;
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

function CanvasImageNode({
  element,
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
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      scaleX={element.scaleX}
      scaleY={element.scaleY}
      opacity={element.opacity}
      visible={element.visible}
      draggable={!element.locked}
      listening={!element.locked}
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
  onSelect,
  onContextMenu,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  registerRef,
  onVideoMetadata,
}: ImageNodeProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const imageRef = useRef<Konva.Image | null>(null);
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
    htmlVideo.loop = false;
    htmlVideo.preload = "auto";
    htmlVideo.playsInline = true;
    htmlVideo.setAttribute("playsinline", "true");

    const applyTrimWindow = () => {
      const duration = Number.isFinite(htmlVideo.duration) ? Math.max(0, htmlVideo.duration) : 0;
      const start = Math.max(0, element.videoStart || 0);
      const fallbackEnd = duration > 0 ? duration : start + 0.25;
      const rawVideoEnd = Number(element.videoEnd);
      const requestedEnd = Number.isFinite(rawVideoEnd) && rawVideoEnd > 0 ? rawVideoEnd : fallbackEnd;
      const end = Math.max(start + 0.01, duration > 0 ? Math.min(requestedEnd, duration) : requestedEnd);

      if (htmlVideo.currentTime < start || htmlVideo.currentTime >= end) {
        try {
          htmlVideo.currentTime = start;
        } catch {
          // ignore seek errors while metadata is initializing
        }
      }
    };

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(htmlVideo.duration) ? Math.max(0, htmlVideo.duration) : 0;
      onMetadataRef.current?.({ duration });
      applyTrimWindow();
      void htmlVideo.play().catch(() => undefined);
    };

    const handleCanPlay = () => {
      if (!mounted) return;
      setVideo(htmlVideo);
      void htmlVideo.play().catch(() => undefined);
    };

    const handleTimeUpdate = () => {
      applyTrimWindow();
    };

    htmlVideo.addEventListener("loadedmetadata", handleLoadedMetadata);
    htmlVideo.addEventListener("canplay", handleCanPlay);
    htmlVideo.addEventListener("timeupdate", handleTimeUpdate);
    htmlVideo.load();

    return () => {
      mounted = false;
      htmlVideo.pause();
      htmlVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
      htmlVideo.removeEventListener("canplay", handleCanPlay);
      htmlVideo.removeEventListener("timeupdate", handleTimeUpdate);
      setVideo((current) => (current === htmlVideo ? null : current));
    };
  }, [element.src, element.videoEnd, element.videoStart]);

  useEffect(() => {
    let frame = 0;
    const redraw = () => {
      imageRef.current?.getLayer()?.batchDraw();
      frame = requestAnimationFrame(redraw);
    };
    if (video) {
      frame = requestAnimationFrame(redraw);
    }
    return () => cancelAnimationFrame(frame);
  }, [video]);

  return (
    <KonvaImage
      ref={(node) => {
        imageRef.current = node;
        registerRef(element.id, node);
      }}
      id={element.id}
      image={video || undefined}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      scaleX={element.scaleX}
      scaleY={element.scaleY}
      opacity={element.opacity}
      visible={element.visible}
      draggable={!element.locked}
      listening={!element.locked}
      globalCompositeOperation={element.blendMode}
      cornerRadius={element.cornerRadius || 0}
      shadowColor={element.shadowColor}
      shadowBlur={element.shadowBlur}
      shadowOffsetX={element.shadowOffsetX}
      shadowOffsetY={element.shadowOffsetY}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={onContextMenu}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

  const setStageApi = useEditorStore((state) => state.setStageApi);
  const setZoomPercent = useEditorStore((state) => state.setZoomPercent);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
  const setShowRightSidebar = useEditorStore((state) => state.setShowRightSidebar);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const addTextElement = useEditorStore((state) => state.addTextElement);
  const addShapeElement = useEditorStore((state) => state.addShapeElement);
  const addImageElement = useEditorStore((state) => state.addImageElement);
  const addVideoElement = useEditorStore((state) => state.addVideoElement);
  const addFreehandLine = useEditorStore((state) => state.addFreehandLine);
  const updateElement = useEditorStore((state) => state.updateElement);
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

  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );

  const elements = useMemo(() => activePage?.elements ?? [], [activePage]);

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
      .map((id) => nodeRefs.current[id])
      .filter((node): node is Konva.Node => Boolean(node));

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, elements]);

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
    if (selectedIds.length === 0) return null;

    const active = elements.find((element) => element.id === selectedIds[0]);
    if (!active) return null;

    return {
      x: viewport.x + (active.x + active.width * 0.5) * viewport.scale,
      y: viewport.y + active.y * viewport.scale - 40,
    };
  }, [elements, selectedIds, viewport.scale, viewport.x, viewport.y]);

  useEffect(() => {
    setStageApi({
      zoomIn: () => zoomBy(1.12),
      zoomOut: () => zoomBy(1 / 1.12),
      fitToScreen,
      exportPng,
      captureThumbnailDataUrl,
      mergeSelectedLayers,
    });

    return () => setStageApi(null);
  }, [captureThumbnailDataUrl, exportPng, fitToScreen, mergeSelectedLayers, setStageApi, zoomBy]);

  const screenToPage = useCallback(
    (point: { x: number; y: number }) => ({
      x: (point.x - viewport.x) / viewport.scale,
      y: (point.y - viewport.y) / viewport.scale,
    }),
    [viewport.scale, viewport.x, viewport.y]
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
    },
    [applySnapping]
  );

  const finishNodeDrag = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>, element: EditorElement) => {
      updateElement(element.id, {
        x: event.target.x(),
        y: event.target.y(),
      });
      setSnapGuides({ x: null, y: null });
    },
    [updateElement]
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

  const onDropAsset = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw =
        event.dataTransfer.getData("application/x-editor-asset") ||
        event.dataTransfer.getData("text/plain");

      if (!raw) return;

      const stage = stageRef.current;
      if (!stage || !activePage) return;

      const rect = stage.container().getBoundingClientRect();
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const pagePoint = screenToPage(pointer);

      try {
        const parsed = JSON.parse(raw) as {
          kind?: string;
          src?: string;
          payload?: Partial<EditorElement>;
        };

        if (parsed.kind === "photo" && parsed.src) {
          addImageElement(parsed.src, {
            x: pagePoint.x - 170,
            y: pagePoint.y - 110,
            width: Math.min(activePage.width * 0.5, 420),
            height: Math.min(activePage.height * 0.45, 360),
          });
          return;
        }

        if (parsed.kind === "video" && parsed.src) {
          addVideoElement(parsed.src, {
            x: pagePoint.x - 170,
            y: pagePoint.y - 110,
            width: Math.min(activePage.width * 0.7, 960),
            height: Math.min(activePage.height * 0.5, 540),
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
            addImageElement(next.src, next);
          } else if (next.type === "video") {
            addVideoElement(next.src, next);
          } else {
            addShapeElement(next.type as ShapeType, next);
          }
        }
      } catch {
        // Ignore invalid drag payloads.
      }
    },
    [activePage, addImageElement, addShapeElement, addTextElement, addVideoElement, screenToPage]
  );

  const setNodeRef = (id: string, node: Konva.Node | null) => {
    nodeRefs.current[id] = node;
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#d7d7d9]"
      onDragOver={(event) => event.preventDefault()}
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
            stroke="#d8dde5"
            strokeWidth={1}
            listening={false}
          />

          <Group
            clipX={0}
            clipY={0}
            clipWidth={activePage.width}
            clipHeight={activePage.height}
          >
            {elements.map((element) => {
              if (!element.visible) return null;

              const commonProps = {
                ref: (node: Konva.Node | null) => setNodeRef(element.id, node),
                id: element.id,
                x: element.x,
                y: element.y,
                rotation: element.rotation,
                scaleX: element.scaleX,
                scaleY: element.scaleY,
                opacity: element.opacity,
                draggable: !element.locked && toolMode !== "draw",
                listening: !element.locked,
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
                onTransformEnd: (event: Konva.KonvaEventObject<Event>) => updateNodeTransform(event, element),
              };

              if (element.type === "image") {
                return (
                  <CanvasImageNode
                    key={element.id}
                    element={element}
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
            <Layers size={14} /> Position
          </button>
        </div>
      ) : null}
    </div>
  );
}
