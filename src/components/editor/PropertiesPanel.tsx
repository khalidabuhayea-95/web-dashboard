"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Input, Label, Select } from "@/components/ui/form";
import {
  extractImagePaletteFromSource,
  normalizeRasterColorMap,
  RASTER_PALETTE_VERSION,
} from "@/lib/editor/imagePalette";
import { normalizeHexColor } from "@/lib/editor/colorUtils";
import { useEditorStore } from "@/store/editorStore";

function numberOr(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

interface PropertiesPanelProps {
  collapsed: boolean;
}

export default function PropertiesPanel({ collapsed }: PropertiesPanelProps) {
  const [lockAspect, setLockAspect] = useState(true);

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const availableFontFamilies = useEditorStore((state) => state.availableFontFamilies);

  const updateElement = useEditorStore((state) => state.updateElement);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );

  const selectedElements = useMemo(
    () => activePage.elements.filter((element) => selectedIds.includes(element.id)),
    [activePage.elements, selectedIds]
  );

  const activeElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const activeImageElement = activeElement?.type === "image" ? activeElement : null;
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

    void extractImagePaletteFromSource(activeRasterSource, 6)
      .then((palette) => {
        if (cancelled) return;
        const patch: {
          rasterOriginalSrc?: string;
          rasterPalette?: string[];
          rasterPaletteVersion?: number;
        } = {
          rasterPaletteVersion: RASTER_PALETTE_VERSION,
          rasterPalette: Array.isArray(palette) ? palette : [],
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
  const fontFamilies = useMemo(() => {
    const set = new Set(availableFontFamilies);
    if (activeElement?.fontFamily) set.add(activeElement.fontFamily);
    return Array.from(set);
  }, [activeElement, availableFontFamilies]);

  return (
    <aside
      className={`shrink-0 overflow-hidden bg-white transition-[width,padding,opacity,border-color] duration-300 ease-out dark:bg-slate-950 ${
        collapsed
          ? "w-0 border-l border-transparent p-0 opacity-0"
          : "w-[320px] border-l border-slate-200 p-3 opacity-100 dark:border-slate-800"
      }`}
      aria-hidden={collapsed}
    >
      <div
        className={`h-full transition-opacity duration-150 ${
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

            <div className="space-y-1">
              <Label>Blend Mode</Label>
              <Select
                value={selectedElements[0].blendMode}
                onChange={(event) => updateSelectedElements({ blendMode: event.target.value as GlobalCompositeOperation })}
              >
                <option value="source-over">Normal</option>
                <option value="multiply">Multiply</option>
                <option value="screen">Screen</option>
                <option value="overlay">Overlay</option>
                <option value="darken">Darken</option>
                <option value="lighten">Lighten</option>
              </Select>
            </div>
          </div>
        ) : null}

        {activeElement ? (
          <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="font-semibold">{activeElement.name}</div>
            <div className="text-slate-500">{activeElement.type}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>X</Label>
              <Input
                value={Math.round(activeElement.x)}
                onChange={(event) => updateElement(activeElement.id, { x: numberOr(event.target.value, activeElement.x) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Y</Label>
              <Input
                value={Math.round(activeElement.y)}
                onChange={(event) => updateElement(activeElement.id, { y: numberOr(event.target.value, activeElement.y) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Width</Label>
              <Input
                value={Math.round(activeElement.width)}
                onChange={(event) => {
                  const width = Math.max(2, numberOr(event.target.value, activeElement.width));
                  if (lockAspect) {
                    const ratio = Math.max(0.0001, activeElement.height / Math.max(activeElement.width, 1));
                    updateElement(activeElement.id, { width, height: width * ratio });
                  } else {
                    updateElement(activeElement.id, { width });
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Height</Label>
              <Input
                value={Math.round(activeElement.height)}
                onChange={(event) => {
                  const height = Math.max(2, numberOr(event.target.value, activeElement.height));
                  if (lockAspect) {
                    const ratio = Math.max(0.0001, activeElement.width / Math.max(activeElement.height, 1));
                    updateElement(activeElement.id, { height, width: height * ratio });
                  } else {
                    updateElement(activeElement.id, { height });
                  }
                }}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={lockAspect}
              onChange={(event) => setLockAspect(event.target.checked)}
              className="h-4 w-4"
            />
            Lock aspect ratio
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Rotation</Label>
              <Input
                value={Math.round(activeElement.rotation)}
                onChange={(event) =>
                  updateElement(activeElement.id, { rotation: numberOr(event.target.value, activeElement.rotation) })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Opacity (0-100)</Label>
              <Input
                value={Math.round(activeElement.opacity * 100)}
                onChange={(event) => {
                  const opacity = Math.max(0, Math.min(100, numberOr(event.target.value, activeElement.opacity * 100))) / 100;
                  updateElement(activeElement.id, { opacity });
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Fill</Label>
              <Input type="color" value={activeElement.fill} onChange={(event) => updateElement(activeElement.id, { fill: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Stroke</Label>
              <Input type="color" value={activeElement.stroke || "#000000"} onChange={(event) => updateElement(activeElement.id, { stroke: event.target.value })} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Stroke Width</Label>
            <Input
              value={activeElement.strokeWidth}
              onChange={(event) =>
                updateElement(activeElement.id, {
                  strokeWidth: Math.max(0, numberOr(event.target.value, activeElement.strokeWidth)),
                })
              }
            />
          </div>

          <div className="space-y-1">
            <Label>Blend Mode</Label>
            <Select
              value={activeElement.blendMode}
              onChange={(event) =>
                updateElement(activeElement.id, { blendMode: event.target.value as GlobalCompositeOperation })
              }
            >
              <option value="source-over">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="overlay">Overlay</option>
              <option value="darken">Darken</option>
              <option value="lighten">Lighten</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Shadow color</Label>
              <Input
                type="color"
                value={activeElement.shadowColor || "#000000"}
                onChange={(event) => updateElement(activeElement.id, { shadowColor: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Shadow blur</Label>
              <Input
                value={activeElement.shadowBlur}
                onChange={(event) =>
                  updateElement(activeElement.id, {
                    shadowBlur: Math.max(0, numberOr(event.target.value, activeElement.shadowBlur)),
                  })
                }
              />
            </div>
          </div>

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

          {activeElement.type === "image" ? (
            <>
              <div className="space-y-1">
                <Label>Corner Radius</Label>
                <Input
                  value={activeElement.cornerRadius || 0}
                  onChange={(event) =>
                    updateElement(activeElement.id, {
                      cornerRadius: Math.max(0, numberOr(event.target.value, activeElement.cornerRadius || 0)),
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label>Filters</Label>
                <Select>
                  <option>None</option>
                  <option>Grayscale (placeholder)</option>
                  <option>Sepia (placeholder)</option>
                  <option>Contrast (placeholder)</option>
                </Select>
              </div>

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
