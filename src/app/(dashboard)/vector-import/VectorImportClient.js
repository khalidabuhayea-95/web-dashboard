"use client";

import { useMemo, useState } from "react";
import { loadSVGFromString, StaticCanvas } from "fabric";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";

const DEFAULT_MAX_DIMENSION = 1920;
const MAX_REASONABLE_LAYER_COUNT = 160;
const MAX_FLATTENED_VECTOR_LAYERS = 24;
const IMPORT_JOB_POLL_INTERVAL_MS = 2_000;
const IMPORT_JOB_TIMEOUT_MS = 15 * 60 * 1000;
const EXTRA_OBJECT_PROPS = [
  "layerType",
  "layerName",
  "layerLocked",
  "layerHidden",
  "sourceWidth",
  "sourceHeight",
  "fontName",
];

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseSvgLength(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const numeric = Number.parseFloat(raw.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function parseSvgDimensions(svgText) {
  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(svgText, "image/svg+xml");
    const svg = documentNode.querySelector("svg");
    if (!svg) return { width: 0, height: 0 };
    const width = parseSvgLength(svg.getAttribute("width"));
    const height = parseSvgLength(svg.getAttribute("height"));
    if (width > 0 && height > 0) {
      return { width, height };
    }
    const viewBox = String(svg.getAttribute("viewBox") || "").trim();
    const parts = viewBox
      .split(/[\s,]+/)
      .map((part) => Number(part))
      .filter((part) => Number.isFinite(part));
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  } catch (_error) {
    // Ignore parse errors and fallback to object bounds.
  }
  return { width: 0, height: 0 };
}

function inferLayerType(objectType) {
  const type = String(objectType || "").toLowerCase();
  if (type.includes("text")) return "text";
  if (type === "image") return "image";
  return "shape";
}

function isTextObjectType(objectType) {
  const type = String(objectType || "").toLowerCase();
  return type === "text" || type === "textbox" || type === "i-text";
}

function layerNameFromType(layerType, index) {
  if (layerType === "text") return `Text ${index + 1}`;
  if (layerType === "image") return `Image ${index + 1}`;
  return `Shape ${index + 1}`;
}

function computeObjectsBounds(objects) {
  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  objects.forEach((object) => {
    const bounds = object.getBoundingRect?.(true, true);
    if (!bounds) return;
    const left = numberOr(bounds.left, 0);
    const top = numberOr(bounds.top, 0);
    const width = Math.max(0, numberOr(bounds.width, 0));
    const height = Math.max(0, numberOr(bounds.height, 0));
    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
    maxRight = Math.max(maxRight, left + width);
    maxBottom = Math.max(maxBottom, top + height);
  });

  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
    return { minLeft: 0, minTop: 0, width: 1080, height: 1080 };
  }

  return {
    minLeft,
    minTop,
    width: Math.max(1, Math.ceil(maxRight - minLeft)),
    height: Math.max(1, Math.ceil(maxBottom - minTop)),
  };
}

function normalizeSvgCanvasSize(svgText, parsedObjects, maxDimension) {
  const svgSize = parseSvgDimensions(svgText);
  const bounds = computeObjectsBounds(parsedObjects);
  const rawWidth = Math.max(1, Math.round(svgSize.width || bounds.width || 1080));
  const rawHeight = Math.max(1, Math.round(svgSize.height || bounds.height || 1080));
  const maxSide = Math.max(320, Math.round(numberOr(maxDimension, DEFAULT_MAX_DIMENSION)));
  const downscale = Math.min(1, maxSide / Math.max(rawWidth, rawHeight, 1));

  return {
    width: Math.max(1, Math.round(rawWidth * downscale)),
    height: Math.max(1, Math.round(rawHeight * downscale)),
    sourceWidth: rawWidth,
    sourceHeight: rawHeight,
    scale: downscale,
    offsetX: bounds.minLeft,
    offsetY: bounds.minTop,
  };
}

async function buildThumbnailDataUrl(fabricData, width, height) {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = width;
  canvasElement.height = height;
  const previewCanvas = new StaticCanvas(canvasElement, {
    width,
    height,
    renderOnAddRemove: false,
  });
  try {
    await Promise.resolve(previewCanvas.loadFromJSON(fabricData));
    previewCanvas.renderAll();
    const multiplier = Math.min(1, 640 / Math.max(width, height, 1));
    return previewCanvas.toDataURL({
      format: "jpeg",
      quality: 0.82,
      multiplier: Math.max(0.1, multiplier),
    });
  } catch (_error) {
    return "";
  } finally {
    previewCanvas.dispose();
  }
}

async function flattenObjectsToPngDataUrl(objects, width, height) {
  if (!Array.isArray(objects) || objects.length === 0) return "";
  const canvasElement = document.createElement("canvas");
  canvasElement.width = width;
  canvasElement.height = height;
  const flattenCanvas = new StaticCanvas(canvasElement, {
    width,
    height,
    renderOnAddRemove: false,
  });
  try {
    objects.forEach((object) => flattenCanvas.add(object));
    flattenCanvas.renderAll();
    return flattenCanvas.toDataURL({
      format: "png",
      quality: 1,
      multiplier: 1,
    });
  } catch (_error) {
    return "";
  } finally {
    flattenCanvas.dispose();
  }
}

function serializeLayerObject(object, index) {
  const layerType = inferLayerType(object.type);
  object.set({
    layerType,
    layerName: layerNameFromType(layerType, index),
    layerLocked: false,
    layerHidden: false,
  });
  if (layerType === "image") {
    const element = object.getElement?.();
    if (element?.naturalWidth && element?.naturalHeight) {
      object.set({
        sourceWidth: Number(element.naturalWidth),
        sourceHeight: Number(element.naturalHeight),
      });
    }
  }
  return object.toObject(EXTRA_OBJECT_PROPS);
}

async function parseSvgToFabricData(svgText, maxDimension) {
  const parsed = await loadSVGFromString(svgText);
  const sourceObjects = Array.isArray(parsed?.objects) ? parsed.objects : [];
  if (sourceObjects.length === 0) {
    throw new Error("The SVG has no drawable layers.");
  }

  const canvasSize = normalizeSvgCanvasSize(svgText, sourceObjects, maxDimension);
  const scaledObjects = sourceObjects.map((object) => {
    const normalizedLeft = numberOr(object.left, 0) - numberOr(canvasSize.offsetX, 0);
    const normalizedTop = numberOr(object.top, 0) - numberOr(canvasSize.offsetY, 0);
    object.set({
      left: normalizedLeft * canvasSize.scale,
      top: normalizedTop * canvasSize.scale,
      scaleX: numberOr(object.scaleX, 1) * canvasSize.scale,
      scaleY: numberOr(object.scaleY, 1) * canvasSize.scale,
    });
    return object;
  });

  const textObjects = scaledObjects.filter((object) => isTextObjectType(object.type));
  const vectorObjects = scaledObjects.filter((object) => !isTextObjectType(object.type));
  let serializedObjects = [];
  let optimizedFromCount = scaledObjects.length;
  let optimizedToCount = scaledObjects.length;

  if (scaledObjects.length > MAX_REASONABLE_LAYER_COUNT && vectorObjects.length > 0) {
    const vectorChunkSize = Math.max(
      8,
      Math.ceil(vectorObjects.length / MAX_FLATTENED_VECTOR_LAYERS)
    );
    const vectorBuffer = [];
    let flattenedIndex = 0;

    const flushVectorBuffer = async () => {
      if (vectorBuffer.length === 0) return;
      const flattenedPng = await flattenObjectsToPngDataUrl(
        vectorBuffer,
        canvasSize.width,
        canvasSize.height
      );
      if (flattenedPng.startsWith("data:image/")) {
        flattenedIndex += 1;
        serializedObjects.push({
          type: "image",
          version: "7.0.0",
          originX: "center",
          originY: "center",
          left: canvasSize.width / 2,
          top: canvasSize.height / 2,
          width: canvasSize.width,
          height: canvasSize.height,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          opacity: 1,
          src: flattenedPng,
          layerType: "image",
          layerName: `Artwork ${flattenedIndex}`,
          layerLocked: false,
          layerHidden: false,
          sourceWidth: canvasSize.width,
          sourceHeight: canvasSize.height,
        });
      } else {
        vectorBuffer.forEach((object) => {
          serializedObjects.push(serializeLayerObject(object, serializedObjects.length));
        });
      }
      vectorBuffer.length = 0;
    };

    for (let index = 0; index < scaledObjects.length; index += 1) {
      const object = scaledObjects[index];
      if (isTextObjectType(object.type)) {
        await flushVectorBuffer();
        serializedObjects.push(serializeLayerObject(object, serializedObjects.length));
        continue;
      }
      vectorBuffer.push(object);
      if (vectorBuffer.length >= vectorChunkSize) {
        await flushVectorBuffer();
      }
    }
    await flushVectorBuffer();
    if (serializedObjects.length > 0) {
      optimizedToCount = serializedObjects.length;
    }
  }

  if (serializedObjects.length === 0) {
    serializedObjects = scaledObjects.map((object, index) =>
      serializeLayerObject(object, index)
    );
    optimizedToCount = serializedObjects.length;
  }

  const fabricData = {
    version: "7.0.0",
    objects: serializedObjects,
  };
  const thumbnailDataUrl = await buildThumbnailDataUrl(
    fabricData,
    canvasSize.width,
    canvasSize.height
  );

  return {
    fabricData,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    sourceWidth: canvasSize.sourceWidth,
    sourceHeight: canvasSize.sourceHeight,
    thumbnailDataUrl,
    layerCount: serializedObjects.length,
    optimizedFromCount,
    optimizedToCount,
  };
}

function formatErrorMessage(payload, fallback = "Import failed.") {
  const messages = [];
  if (payload?.error && typeof payload.error === "string") {
    messages.push(payload.error);
  }
  if (
    payload?.details &&
    typeof payload.details === "string" &&
    payload.details !== payload.error
  ) {
    messages.push(payload.details);
  }
  return messages.length > 0 ? messages.join(" ") : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollImportJob(jobId, { onUpdate } = {}) {
  const safeJobId = String(jobId || "").trim();
  if (!safeJobId) {
    throw new Error("Import job id is missing.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < IMPORT_JOB_TIMEOUT_MS) {
    const response = await fetch(`/api/tools/import-jobs/${encodeURIComponent(safeJobId)}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatErrorMessage(payload, "Failed to fetch import job status."));
    }

    const job = payload?.job || null;
    if (typeof onUpdate === "function" && job) {
      onUpdate(job);
    }

    const status = String(job?.status || "").toLowerCase();
    if (status === "succeeded") {
      return job?.result || {};
    }
    if (status === "failed") {
      const resultPayload =
        job?.result && typeof job.result === "object" ? job.result : null;
      throw new Error(
        String(job?.error || formatErrorMessage(resultPayload, "File import failed."))
      );
    }

    await sleep(IMPORT_JOB_POLL_INTERVAL_MS);
  }

  throw new Error("Import timed out while waiting for completion.");
}

export default function VectorImportClient() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [maxDimension, setMaxDimension] = useState(String(DEFAULT_MAX_DIMENSION));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);

  const canImport = useMemo(() => !busy && Boolean(file), [busy, file]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setStatus("Choose an SVG file first.");
      return;
    }

    const lowerName = String(file.name || "").toLowerCase();
    const isSvg = lowerName.endsWith(".svg") || file.type === "image/svg+xml";
    const isPdf = lowerName.endsWith(".pdf") || file.type === "application/pdf";
    const isPsd =
      lowerName.endsWith(".psd") ||
      file.type === "image/vnd.adobe.photoshop" ||
      file.type === "application/vnd.adobe.photoshop" ||
      file.type === "application/photoshop" ||
      file.type === "application/x-photoshop";

    if (isPdf || isPsd) {
      setBusy(true);
      setResult(null);
      setResultMeta(null);
      setStatus(isPdf ? "Queueing PDF import..." : "Queueing PSD import...");
      try {
        const formData = new FormData();
        formData.set("type", "vector-raster");
        formData.set("format", isPdf ? "pdf" : "psd");
        formData.set("maxDimension", String(Number(maxDimension) || DEFAULT_MAX_DIMENSION));
        formData.set("file", file);
        if (name.trim()) formData.set("name", name.trim());
        if (slug.trim()) formData.set("slug", slug.trim());

        const response = await fetch("/api/tools/import-jobs", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "File import failed."));
        }

        const jobId = String(payload?.job?.id || "").trim();
        if (!jobId) {
          throw new Error("Import job id was not returned.");
        }

        const resultPayload = await pollImportJob(jobId, {
          onUpdate(job) {
            if (job?.status === "running") {
              setStatus(String(job.progress || (isPdf ? "Converting PDF page 1..." : "Converting PSD...")));
              return;
            }
            if (job?.status === "pending") {
              setStatus(isPdf ? "PDF import queued..." : "PSD import queued...");
            }
          },
        });

        setResult(resultPayload?.template || null);
        setResultMeta({
          importVersion: resultPayload?.importVersion || null,
          layerStats: resultPayload?.layerStats || null,
          warnings: Array.isArray(resultPayload?.warnings) ? resultPayload.warnings : [],
        });
        setStatus(
          `${resultPayload?.message || "File imported."} Layers: ${Number(resultPayload?.layerCount || 1)}`
        );
      } catch (error) {
        setStatus(error?.message || "File import failed.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!isSvg) {
      setStatus("Unsupported file type. Upload SVG, PDF, or PSD.");
      return;
    }

    setBusy(true);
    setResult(null);
    setResultMeta(null);
    setStatus("Parsing SVG layers...");

    try {
      const svgText = await file.text();
      if (!svgText.trim()) {
        throw new Error("SVG file is empty.");
      }

      const parsed = await parseSvgToFabricData(svgText, Number(maxDimension));
      const optimizationLabel =
        parsed.optimizedFromCount > parsed.optimizedToCount
          ? ` Optimized ${parsed.optimizedFromCount} -> ${parsed.optimizedToCount} layers.`
          : "";
      setStatus(`Uploading ${parsed.layerCount} layers...${optimizationLabel}`);

      const response = await fetch("/api/tools/vector-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "svg",
          fileName: file.name,
          name: name.trim() || undefined,
          slug: slug.trim() || undefined,
          canvasWidth: parsed.canvasWidth,
          canvasHeight: parsed.canvasHeight,
          sourceWidth: parsed.sourceWidth,
          sourceHeight: parsed.sourceHeight,
          thumbnailDataUrl: parsed.thumbnailDataUrl || undefined,
          fabricData: parsed.fabricData,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload));
      }

      setResult(payload?.template || null);
      setResultMeta({
        importVersion: payload?.importVersion || null,
        layerStats: payload?.layerStats || null,
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
      });
      setStatus(
        `${payload?.message || "SVG template imported."} Layers: ${Number(payload?.layerCount || parsed.layerCount)}`
      );
    } catch (error) {
      setStatus(error?.message || "SVG import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vector Import</h1>
        <p className="text-sm text-muted-foreground">
          Upload SVG for layered import. PSD now uses layer-parity import (v2) with per-layer fallbacks; PDF imports page 1 as raster.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SVG importer</CardTitle>
          <CardSubtitle>
            SVG: layered import. PSD: hierarchy + layer stats + per-layer fallback. PDF: raster page import.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="vector-file">SVG, PDF, or PSD file</Label>
              <Input
                id="vector-file"
                type="file"
                accept=".svg,.pdf,.psd,image/svg+xml,application/pdf,image/vnd.adobe.photoshop,application/vnd.adobe.photoshop,application/photoshop,application/x-photoshop"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vector-name">Template name (optional)</Label>
                <Input
                  id="vector-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Imported SVG template"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vector-slug">Slug (optional)</Label>
                <Input
                  id="vector-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="imported-svg-template"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vector-max-dimension">Max dimension (px)</Label>
              <Input
                id="vector-max-dimension"
                type="number"
                min={320}
                step={1}
                value={maxDimension}
                onChange={(event) => setMaxDimension(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!canImport}>
                {busy ? "Importing..." : "Import file"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Use SVG for strongest editability. PSD depends on source metadata; PDF is raster only.
              </span>
            </div>
          </form>

          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}

          {result ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 text-sm font-semibold">Imported template</div>
              <div className="grid gap-3 md:grid-cols-[88px_1fr]">
                <div className="h-20 w-20 overflow-hidden rounded-md border border-border bg-muted">
                  {result.thumbnailDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.thumbnailDataUrl}
                      alt={`${result.name} preview`}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{result.name}</div>
                  <div className="text-muted-foreground">Slug: {result.slug}</div>
                  <div className="text-muted-foreground">
                    Canvas: {result?.canvasSize?.width || "-"}x{result?.canvasSize?.height || "-"}
                  </div>
                  <div className="pt-1">
                    <Button as="a" href={`/editor-pro?templateId=${encodeURIComponent(result.id)}`} variant="secondary">
                      Open in Editor Pro
                    </Button>
                  </div>
                  {resultMeta ? (
                    <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                      <div>Import version: {resultMeta.importVersion || "legacy"}</div>
                      {resultMeta.layerStats ? (
                        <div>
                          Layers detected: {resultMeta.layerStats.detected ?? "-"} | Editable: {resultMeta.layerStats.editable ?? "-"} | Rasterized: {resultMeta.layerStats.rasterized ?? "-"} | Skipped: {resultMeta.layerStats.skipped ?? "-"}
                        </div>
                      ) : null}
                      {Array.isArray(resultMeta.warnings) && resultMeta.warnings.length > 0 ? (
                        <div>Warnings: {resultMeta.warnings.join(" | ")}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
