"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import Button from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import {
  extractImagePaletteFromSource,
  extractSvgPaletteColors,
  migrateRasterColorMap,
  normalizeRasterColorMap,
  RASTER_PALETTE_VERSION,
  serializeRasterColorMap,
} from "@/lib/editor/imagePalette";
import { computeRemoveEdgeWhiteBackgroundPatch } from "@/lib/editor/imageCrop";
import { dataUrlToFile, uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { normalizeHexColor } from "@/lib/editor/colorUtils";
import {
  resolveTextStrokeWidthPx,
  TEXT_STROKE_MAX_PERCENT,
} from "@/lib/editor/textStroke";
import {
  useEditorStore,
  type CornerRadiusCorners,
  type EditorElement,
} from "@/store/editorStore";

const ALL_CORNERS: CornerRadiusCorners = {
  topLeft: true,
  topRight: true,
  bottomRight: true,
  bottomLeft: true,
};

/** Matches the mobile app's MAX_BLUR_RADIUS, and the 0–40 clamp the mobile serializer applies. */
const MAX_MEDIA_BLUR = 40;

/**
 * Shadow and stroke opacity ride inside their colour as an `rgba()` string rather than as separate
 * fields: Konva renders that directly, and the mobile serializer already splits colour from alpha
 * (rgbaToHexWithOpacity → `…ColorHex` + `…Opacity`), so nothing new has to be persisted.
 */
function splitColorAlpha(input: unknown) {
  const value = String(input || "").trim();
  if (!value) return { hex: "#000000", opacity: 1 };
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    const channel = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw) || 0)));
    const hex = `#${[rgba[1], rgba[2], rgba[3]]
      .map((part) => channel(part).toString(16).padStart(2, "0"))
      .join("")}`;
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return { hex, opacity: Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1)) };
  }
  return { hex: normalizeHexColor(value) || "#000000", opacity: 1 };
}

function buildColorAlpha(hex: string, opacity: number) {
  const safeHex = normalizeHexColor(hex) || "#000000";
  const alpha = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
  if (alpha >= 1) return safeHex;
  const value = safeHex.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

type ImageEditorElement = EditorElement & { type: "image" };
type VideoEditorElement = EditorElement & { type: "video" };
type MediaEditorElement = ImageEditorElement | VideoEditorElement;

function numberOr(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function isImageEditorElement(element: EditorElement | null): element is ImageEditorElement {
  return element?.type === "image";
}

function isMediaEditorElement(element: EditorElement | null): element is MediaEditorElement {
  return element?.type === "image" || element?.type === "video";
}

const SHAPE_ELEMENT_TYPES = new Set(["rect", "circle", "line", "arrow", "star"]);

function isShapeEditorElement(element: EditorElement | null): boolean {
  return Boolean(element && SHAPE_ELEMENT_TYPES.has(element.type));
}

interface PropertiesPanelProps {
  collapsed: boolean;
}

export default function PropertiesPanel({ collapsed }: PropertiesPanelProps) {
  const [isConvertingMediaToFrame, setIsConvertingMediaToFrame] = useState(false);

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const availableFontFamilies = useEditorStore((state) => state.availableFontFamilies);

  const updateElement = useEditorStore((state) => state.updateElement);
  const recordHistory = useEditorStore((state) => state.recordHistory);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);
  const convertMediaElementToFrame = useEditorStore((state) => state.convertMediaElementToFrame);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );

  const selectedElements = useMemo(
    () => activePage.elements.filter((element) => selectedIds.includes(element.id)),
    [activePage.elements, selectedIds]
  );

  const activeElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const activeMediaElement = isMediaEditorElement(activeElement) ? activeElement : null;
  // Corners & Border applies to media (image/video — includes vector layers, which are images)
  // AND to shape elements; the radius slider itself only shows where cornerRadius renders.
  const activeBorderElement =
    activeMediaElement || (isShapeEditorElement(activeElement) ? activeElement : null);
  const activeBorderSupportsRadius =
    !!activeBorderElement &&
    (activeBorderElement.type === "image" ||
      activeBorderElement.type === "video" ||
      activeBorderElement.type === "rect");
  const activeCornerMask: CornerRadiusCorners =
    activeBorderElement?.cornerRadiusCorners ?? ALL_CORNERS;
  const activeCornerAllOn =
    activeCornerMask.topLeft &&
    activeCornerMask.topRight &&
    activeCornerMask.bottomRight &&
    activeCornerMask.bottomLeft;
  const applyCornerMask = (next: CornerRadiusCorners) => {
    if (!activeBorderElement) return;
    const allOn = next.topLeft && next.topRight && next.bottomRight && next.bottomLeft;
    // Store the mask only when it deviates from the all-corners default.
    updateElement(activeBorderElement.id, { cornerRadiusCorners: allOn ? undefined : next });
  };
  const toggleCorner = (key: keyof CornerRadiusCorners) => {
    // From the "all" state a corner click means "round ONLY this corner" (like the preset row);
    // afterwards clicks toggle corners individually so pairs/combos are possible.
    if (activeCornerAllOn) {
      applyCornerMask({ ...{ topLeft: false, topRight: false, bottomRight: false, bottomLeft: false }, [key]: true });
      return;
    }
    applyCornerMask({ ...activeCornerMask, [key]: !activeCornerMask[key] });
  };
  // Shadow renders on text, media and shapes alike, and ships to mobile for all of them (text via
  // the layer's `shadow` object, media via `filters.shadow*`).
  const activeShadowElement =
    activeElement &&
    (activeElement.type === "text" || !!activeMediaElement || isShapeEditorElement(activeElement))
      ? activeElement
      : null;
  const activeShadow = splitColorAlpha(activeShadowElement?.shadowColor);
  const activeShadowBlur = Math.max(0, Math.round(Number(activeShadowElement?.shadowBlur) || 0));
  const activeShadowOffsetX = Math.round(Number(activeShadowElement?.shadowOffsetX) || 0);
  const activeShadowOffsetY = Math.round(Number(activeShadowElement?.shadowOffsetY) || 0);
  // Mirrors the serializer's visibility test: a 0-radius, 0-offset shadow draws nothing.
  const activeShadowVisible =
    activeShadow.opacity > 0 &&
    (activeShadowBlur > 0 || activeShadowOffsetX !== 0 || activeShadowOffsetY !== 0);
  const patchShadow = (patch: Partial<EditorElement>, options?: { recordHistory?: boolean }) => {
    if (!activeShadowElement) return;
    updateElement(activeShadowElement.id, patch, options);
  };
  /** Writes colour + opacity back as one rgba() string (what the mobile serializer parses). */
  const setShadowColor = (hex: string, opacity: number, options?: { recordHistory?: boolean }) =>
    patchShadow({ shadowColor: buildColorAlpha(hex, opacity) }, options);

  // Text outline. Separate from the media/shape "Corners & Border" section because a TEXT layer's
  // `strokeWidth` is a 0–100 PERCENTAGE of the font size, not a pixel width (see textStroke.ts).
  const activeTextStrokeElement = activeElement?.type === "text" ? activeElement : null;
  const activeTextStroke = splitColorAlpha(activeTextStrokeElement?.stroke);
  const activeTextStrokeWidth = Math.max(
    0,
    Math.min(TEXT_STROKE_MAX_PERCENT, Math.round(Number(activeTextStrokeElement?.strokeWidth) || 0))
  );
  const patchTextStroke = (patch: Partial<EditorElement>, options?: { recordHistory?: boolean }) => {
    if (!activeTextStrokeElement) return;
    updateElement(activeTextStrokeElement.id, patch, options);
  };

  // Blur is a media filter on mobile (MediaAction.BLUR). Videos are excluded: a blurred Konva node
  // renders from a cached bitmap, which would freeze playback on the web canvas.
  const activeBlurElement =
    activeElement && activeElement.type === "image" ? activeElement : null;
  const activeBlurRadius = Math.max(0, Math.min(MAX_MEDIA_BLUR, Number(activeBlurElement?.mediaBlur) || 0));

  const activeImageElement = isImageEditorElement(activeElement) ? activeElement : null;
  const activeImageId = String(activeImageElement?.id || "");
  const activeImageRasterOriginalSrc = String(activeImageElement?.rasterOriginalSrc || "").trim();
  const activeRasterSource = (() => {
    const source = String(activeImageElement?.rasterOriginalSrc || activeImageElement?.src || "").trim();
    return source || "";
  })();
  const activeRasterPalette = Array.isArray(activeImageElement?.rasterPalette)
    ? activeImageElement.rasterPalette
        .map((value) => normalizeHexColor(String(value || "")))
        .filter((value): value is string => Boolean(value))
    : ([] as string[]);
  const activeRasterPaletteVersion = Math.max(0, Number(activeImageElement?.rasterPaletteVersion || 0));
  const activeRasterColorMap = normalizeRasterColorMap(activeImageElement?.rasterColorMap);
  const activeRasterColorMapKey = serializeRasterColorMap(activeRasterColorMap);
  const activeVectorSource = String(activeImageElement?.vectorSrc || "").trim();

  useEffect(() => {
    if (!activeImageId || !activeRasterSource) {
      return;
    }

    const hasPalette = activeRasterPalette.length > 0;
    const sourceWasPersisted = activeImageRasterOriginalSrc === activeRasterSource;
    const paletteIsCurrent = activeRasterPaletteVersion >= RASTER_PALETTE_VERSION;
    if (hasPalette && sourceWasPersisted && paletteIsCurrent) {
      return;
    }

    let cancelled = false;

    // Shapes keep their authored SVG: list its true colours instead of pixel-extracting the
    // rasterized PNG, whose anti-aliased edges hallucinate phantom near-black palette entries.
    const svgPalette = extractSvgPaletteColors(activeVectorSource, 6);
    const palettePromise =
      svgPalette.length > 0 ? Promise.resolve(svgPalette) : extractImagePaletteFromSource(activeRasterSource, 6);

    void palettePromise
      .then((palette) => {
        if (cancelled) return;
        const colors = Array.isArray(palette) ? palette : [];
        const patch: {
          rasterOriginalSrc?: string;
          rasterPalette?: string[];
          rasterPaletteVersion?: number;
          rasterColorMap?: Record<string, string>;
        } = {
          rasterPaletteVersion: RASTER_PALETTE_VERSION,
          rasterPalette: colors,
        };
        if (!sourceWasPersisted) {
          patch.rasterOriginalSrc = activeRasterSource;
        }
        // Carry an existing recolor over to the re-derived palette's keys (nearest colour wins).
        const currentMap = Object.fromEntries(JSON.parse(activeRasterColorMapKey) as Array<[string, string]>);
        const migratedMap = migrateRasterColorMap(currentMap, colors);
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
  const fontFamilies = useMemo(() => {
    const set = new Set(availableFontFamilies);
    if (activeElement?.fontFamily) set.add(activeElement.fontFamily);
    return Array.from(set);
  }, [activeElement, availableFontFamilies]);

  const convertSelectedMediaToFrame = async () => {
    if (!activeMediaElement || isConvertingMediaToFrame) return;

    if (activeMediaElement.type !== "image") {
      convertMediaElementToFrame(activeMediaElement.id);
      return;
    }

    setIsConvertingMediaToFrame(true);
    try {
      const result = await computeRemoveEdgeWhiteBackgroundPatch(activeMediaElement);
      if (!result.supported) {
        if (result.reason) window.alert(result.reason);
        return;
      }

      let patch = result.patch;
      if (patch?.src && String(patch.src).startsWith("data:image/")) {
        try {
          const file = dataUrlToFile(
            String(patch.src),
            `frame-source-${activeMediaElement.id}.png`,
            "image/png"
          );
          const uploaded = await uploadEditorMediaFile(file, "image");
          patch = {
            ...patch,
            src: uploaded.url,
            rasterOriginalSrc: uploaded.url,
          };
        } catch {
          // Keep conversion usable even if the upload path is temporarily unavailable.
        }
      }

      convertMediaElementToFrame(activeMediaElement.id, patch ? { sourcePatch: patch } : undefined);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to convert image to frame.");
    } finally {
      setIsConvertingMediaToFrame(false);
    }
  };

  return (
    <aside
      className={`min-h-0 shrink-0 overflow-hidden bg-white transition-[width,padding,opacity,border-color] duration-300 ease-out dark:bg-slate-950 ${
        collapsed
          ? "w-0 border-l border-transparent p-0 opacity-0"
          : "w-[320px] border-l border-slate-200 p-3 opacity-100 dark:border-slate-800"
      }`}
      aria-hidden={collapsed}
    >
      <div
        className={`flex h-full min-h-0 flex-col overflow-y-auto pr-1 transition-opacity duration-150 ${
          collapsed ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <SlidersHorizontal size={16} /> Properties
        </div>

        {selectedElements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Select an element to edit position, size, styles, and text/image settings.
          </div>
        ) : null}

        {selectedElements.length > 1 ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="font-semibold">{selectedElements.length} layers selected</div>
              <div className="mt-1 text-slate-500">Batch editing affects all selected layers.</div>
            </div>

            <div className="space-y-1">
              <Label>Opacity (0-100)</Label>
              <Input
                value={Math.round(selectedElements[0].opacity * 100)}
                onChange={(event) => {
                  const value = Math.max(0, Math.min(100, numberOr(event.target.value, 100))) / 100;
                  updateSelectedElements({ opacity: value });
                }}
              />
            </div>

          </div>
        ) : null}

        {activeElement ? (
          <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="font-semibold">{activeElement.name}</div>
            <div className="text-slate-500">{activeElement.type}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="m-0">Opacity</Label>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {Math.round((activeElement.opacity ?? 1) * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((activeElement.opacity ?? 1) * 100)}
                onChange={(event) => {
                  // Don't push an undo entry on every drag tick — commit one on release.
                  const value = Math.max(0, Math.min(100, numberOr(event.target.value, 100))) / 100;
                  updateElement(activeElement.id, { opacity: value }, { recordHistory: false });
                }}
                onPointerUp={() => recordHistory()}
                onKeyUp={() => recordHistory()}
                aria-label="Layer opacity"
                className="h-2 flex-1 cursor-pointer accent-slate-700 dark:accent-slate-300"
              />
              <Input
                className="w-16"
                value={Math.round((activeElement.opacity ?? 1) * 100)}
                onChange={(event) => {
                  const value = Math.max(0, Math.min(100, numberOr(event.target.value, 100))) / 100;
                  updateElement(activeElement.id, { opacity: value });
                }}
              />
            </div>
          </div>

          {activeMediaElement ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <Button
                type="button"
                variant="secondary"
                disabled={isConvertingMediaToFrame}
                onClick={() => {
                  void convertSelectedMediaToFrame();
                }}
                className="w-full justify-start !rounded-lg !px-3 !text-sm !font-semibold"
              >
                {isConvertingMediaToFrame ? "Converting to frame..." : "Convert layer to frame"}
              </Button>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                Make white edge background transparent while keeping the same layer dimensions.
              </p>
            </div>
          ) : null}

          {activeElement.type === "text" ? (
            <>
              <div className="space-y-1">
                <Label>Text</Label>
                <Input value={activeElement.text} onChange={(event) => updateElement(activeElement.id, { text: event.target.value })} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Font Family</Label>
                  <Select value={activeElement.fontFamily} onChange={(event) => updateElement(activeElement.id, { fontFamily: event.target.value })}>
                    {fontFamilies.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Font Size</Label>
                  <Input
                    value={activeElement.fontSize}
                    onChange={(event) =>
                      updateElement(activeElement.id, {
                        fontSize: Math.max(8, numberOr(event.target.value, activeElement.fontSize)),
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>Weight</Label>
                  <Select value={String(activeElement.fontWeight)} onChange={(event) => updateElement(activeElement.id, { fontWeight: event.target.value })}>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                    <option value="800">Extra Bold</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Style</Label>
                  <Select
                    value={activeElement.fontStyle}
                    onChange={(event) => updateElement(activeElement.id, { fontStyle: event.target.value as "normal" | "italic" })}
                  >
                    <option value="normal">Normal</option>
                    <option value="italic">Italic</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Decoration</Label>
                  <Select
                    value={activeElement.textDecoration}
                    onChange={(event) =>
                      updateElement(activeElement.id, {
                        textDecoration: event.target.value as
                          | ""
                          | "underline"
                          | "line-through"
                          | "underline line-through",
                      })
                    }
                  >
                    <option value="">None</option>
                    <option value="underline">Underline</option>
                    <option value="line-through">Strikethrough</option>
                    <option value="underline line-through">Underline + Strikethrough</option>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Text Align</Label>
                  <Select value={activeElement.align} onChange={(event) => updateElement(activeElement.id, { align: event.target.value as "left" | "center" | "right" | "justify" })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                    <option value="justify">Justify</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Letter Spacing</Label>
                  <Input
                    value={activeElement.letterSpacing}
                    onChange={(event) =>
                      updateElement(activeElement.id, {
                        letterSpacing: numberOr(event.target.value, activeElement.letterSpacing),
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Line Height</Label>
                  <Input
                    value={activeElement.lineHeight}
                    onChange={(event) =>
                      updateElement(activeElement.id, {
                        lineHeight: Math.max(0.4, numberOr(event.target.value, activeElement.lineHeight)),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Text Color</Label>
                  <Input
                    type="color"
                    value={activeElement.color || "#111827"}
                    onChange={(event) => updateElement(activeElement.id, { color: event.target.value, fill: event.target.value })}
                  />
                </div>
              </div>
            </>
          ) : null}

          {activeBorderElement ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <Label className="m-0">Corners &amp; Border</Label>
              {activeBorderSupportsRadius ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { key: "all" as const, title: "All corners", style: { borderRadius: 7 } },
                        { key: "topLeft" as const, title: "Top left", style: { borderTopLeftRadius: 7 } },
                        { key: "topRight" as const, title: "Top right", style: { borderTopRightRadius: 7 } },
                        { key: "bottomLeft" as const, title: "Bottom left", style: { borderBottomLeftRadius: 7 } },
                        { key: "bottomRight" as const, title: "Bottom right", style: { borderBottomRightRadius: 7 } },
                      ]
                    ).map(({ key, title, style }) => {
                      const active =
                        key === "all"
                          ? activeCornerAllOn
                          : !activeCornerAllOn && activeCornerMask[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          title={title}
                          aria-pressed={active}
                          onClick={() =>
                            key === "all" ? applyCornerMask(ALL_CORNERS) : toggleCorner(key)
                          }
                          className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                            active
                              ? "border-sky-500 bg-sky-50 text-sky-600 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300"
                              : "border-slate-200 bg-white text-slate-400 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="block h-4 w-4 border-2 border-current"
                            style={style}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                      Corner radius
                    </Label>
                    <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {Math.round(Number(activeBorderElement.cornerRadius) || 0)}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(
                      1,
                      Math.round(
                        Math.min(
                          Number(activeBorderElement.width) || 0,
                          Number(activeBorderElement.height) || 0
                        ) / 2
                      )
                    )}
                    step={1}
                    value={Math.round(Number(activeBorderElement.cornerRadius) || 0)}
                    onChange={(event) =>
                      updateElement(
                        activeBorderElement.id,
                        { cornerRadius: Math.max(0, numberOr(event.target.value, 0)) },
                        { recordHistory: false }
                      )
                    }
                    onPointerUp={() => recordHistory()}
                    onKeyUp={() => recordHistory()}
                    className="w-full accent-sky-500"
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Border width
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={Math.round(Number(activeBorderElement.strokeWidth) || 0)}
                    onChange={(event) => {
                      const nextWidth = Math.max(0, numberOr(event.target.value, 0));
                      const patch: Partial<EditorElement> = { strokeWidth: nextWidth };
                      // Give a newly-enabled border a visible colour when the layer has none.
                      if (nextWidth > 0 && !normalizeHexColor(String(activeBorderElement.stroke || ""))) {
                        patch.stroke = "#000000";
                      }
                      updateElement(activeBorderElement.id, patch);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Border color
                  </Label>
                  <Input
                    type="color"
                    className="h-9 cursor-pointer p-1"
                    value={normalizeHexColor(String(activeBorderElement.stroke || "")) || "#000000"}
                    onChange={(event) =>
                      updateElement(activeBorderElement.id, { stroke: event.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          {activeTextStrokeElement ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <Label className="m-0">Stroke</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300"
                  disabled={activeTextStrokeWidth <= 0}
                  onClick={() => patchTextStroke({ strokeWidth: 0 })}
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Color
                  </Label>
                  <Input
                    type="color"
                    className="h-9 cursor-pointer p-1"
                    value={activeTextStroke.hex}
                    onChange={(event) => {
                      patchTextStroke({
                        stroke: buildColorAlpha(event.target.value, activeTextStroke.opacity),
                      });
                      // Picking a colour with no width reads as a no-op — give it a visible outline.
                      if (activeTextStrokeWidth <= 0) patchTextStroke({ strokeWidth: 10 });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                      Opacity
                    </Label>
                    <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {Math.round(activeTextStroke.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(activeTextStroke.opacity * 100)}
                    onChange={(event) =>
                      patchTextStroke(
                        {
                          stroke: buildColorAlpha(
                            activeTextStroke.hex,
                            numberOr(event.target.value, 100) / 100
                          ),
                        },
                        { recordHistory: false }
                      )
                    }
                    onPointerUp={() => recordHistory()}
                    onKeyUp={() => recordHistory()}
                    className="h-9 w-full accent-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Width
                  </Label>
                  {/* Percentage of the font size, exactly like the mobile Stroke sheet. */}
                  <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {activeTextStrokeWidth}%
                    {activeTextStrokeWidth > 0
                      ? ` · ${
                          Math.round(
                            resolveTextStrokeWidthPx(
                              activeTextStrokeWidth,
                              activeTextStrokeElement.fontSize
                            ) * 10
                          ) / 10
                        }px`
                      : ""}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={TEXT_STROKE_MAX_PERCENT}
                  step={1}
                  value={activeTextStrokeWidth}
                  onChange={(event) => {
                    const nextWidth = Math.max(
                      0,
                      Math.min(TEXT_STROKE_MAX_PERCENT, numberOr(event.target.value, 0))
                    );
                    const patch: Partial<EditorElement> = { strokeWidth: nextWidth };
                    // Give a newly-enabled outline a visible colour when the layer has none.
                    if (nextWidth > 0 && !String(activeTextStrokeElement.stroke || "").trim()) {
                      patch.stroke = "#000000";
                    }
                    patchTextStroke(patch, { recordHistory: false });
                  }}
                  onPointerUp={() => recordHistory()}
                  onKeyUp={() => recordHistory()}
                  className="w-full accent-sky-500"
                />
              </div>
            </div>
          ) : null}

          {activeShadowElement ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <Label className="m-0">Shadow</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300"
                  disabled={!activeShadowVisible}
                  onClick={() =>
                    patchShadow({
                      shadowColor: "#000000",
                      shadowBlur: 0,
                      shadowOffsetX: 0,
                      shadowOffsetY: 0,
                    })
                  }
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Color
                  </Label>
                  <Input
                    type="color"
                    className="h-9 cursor-pointer p-1"
                    value={activeShadow.hex}
                    onChange={(event) => {
                      // Giving a shadow a colour should show something: seed a soft radius when
                      // the layer has no offset or blur yet, otherwise the pick looks like a no-op.
                      setShadowColor(event.target.value, activeShadow.opacity);
                      if (!activeShadowVisible) patchShadow({ shadowBlur: 12 });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                      Opacity
                    </Label>
                    <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {Math.round(activeShadow.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(activeShadow.opacity * 100)}
                    onChange={(event) =>
                      setShadowColor(activeShadow.hex, numberOr(event.target.value, 100) / 100, {
                        recordHistory: false,
                      })
                    }
                    onPointerUp={() => recordHistory()}
                    onKeyUp={() => recordHistory()}
                    className="h-9 w-full accent-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Shadow radius
                  </Label>
                  <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {activeShadowBlur}px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.min(100, activeShadowBlur)}
                  onChange={(event) =>
                    patchShadow(
                      { shadowBlur: Math.max(0, numberOr(event.target.value, 0)) },
                      { recordHistory: false }
                    )
                  }
                  onPointerUp={() => recordHistory()}
                  onKeyUp={() => recordHistory()}
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Move horizontally
                  </Label>
                  <Input
                    type="number"
                    value={activeShadowOffsetX}
                    onChange={(event) =>
                      patchShadow({ shadowOffsetX: numberOr(event.target.value, 0) })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="m-0 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Move vertically
                  </Label>
                  <Input
                    type="number"
                    value={activeShadowOffsetY}
                    onChange={(event) =>
                      patchShadow({ shadowOffsetY: numberOr(event.target.value, 0) })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          {activeBlurElement ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <Label className="m-0">Blur</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300"
                  disabled={activeBlurRadius <= 0}
                  onClick={() => updateElement(activeBlurElement.id, { mediaBlur: 0 })}
                >
                  Reset
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Blurs the layer itself
                </span>
                {/* Shown as a percentage of the 40px max, matching the mobile Blur sheet. */}
                <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {Math.round((activeBlurRadius / MAX_MEDIA_BLUR) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((activeBlurRadius / MAX_MEDIA_BLUR) * 100)}
                onChange={(event) =>
                  updateElement(
                    activeBlurElement.id,
                    {
                      mediaBlur:
                        (Math.max(0, Math.min(100, numberOr(event.target.value, 0))) / 100) *
                        MAX_MEDIA_BLUR,
                    },
                    { recordHistory: false }
                  )
                }
                onPointerUp={() => recordHistory()}
                onKeyUp={() => recordHistory()}
                className="w-full accent-sky-500"
              />
            </div>
          ) : null}

          {activeElement.type === "image" ? (
            <>
              {activeRasterSource ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="m-0">Image Colors</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-600 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300"
                      disabled={Object.keys(activeRasterColorMap).length === 0}
                      onClick={() => updateElement(activeElement.id, { rasterColorMap: {} })}
                    >
                      Reset all
                    </button>
                  </div>

                  {activeRasterPalette.length === 0 ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      No dominant raster colors were detected in this image yet.
                    </div>
                  ) : null}

                  {activeRasterPalette.length > 0 ? (
                    <div className="space-y-2">
                      {activeRasterPalette.map((originalColor) => {
                        const mappedColor = activeRasterColorMap[originalColor] || originalColor;
                        return (
                          <div key={originalColor} className="grid grid-cols-[auto,1fr,auto,auto] items-center gap-2">
                            <span
                              className="h-5 w-5 rounded border border-slate-300 dark:border-slate-600"
                              style={{ backgroundColor: mappedColor }}
                              aria-hidden="true"
                            />
                            <code className="truncate text-[11px] text-slate-600 dark:text-slate-300">
                              {originalColor}
                            </code>
                            <Input
                              type="color"
                              value={mappedColor}
                              className="h-8 w-10 cursor-pointer p-1"
                              onChange={(event) => {
                                const nextColor = normalizeHexColor(event.target.value) || originalColor;
                                const nextMap = { ...activeRasterColorMap };
                                if (nextColor === originalColor) {
                                  delete nextMap[originalColor];
                                } else {
                                  nextMap[originalColor] = nextColor;
                                }
                                updateElement(activeElement.id, { rasterColorMap: nextMap });
                              }}
                            />
                            <button
                              type="button"
                              className="text-xs text-slate-600 underline underline-offset-2 dark:text-slate-300"
                              onClick={() => {
                                const nextMap = { ...activeRasterColorMap };
                                delete nextMap[originalColor];
                                updateElement(activeElement.id, { rasterColorMap: nextMap });
                              }}
                            >
                              Reset
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeRasterSource ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <Label className="m-0 text-amber-900 dark:text-amber-200">Image recolor</Label>
                  <div className="text-xs leading-5 text-amber-800 dark:text-amber-300">
                    This layer uses palette-based image recolor. It works best on flat illustrations
                    and decorative assets with a limited number of dominant colors.
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
