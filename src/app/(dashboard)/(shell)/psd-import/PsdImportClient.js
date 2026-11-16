"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Layers,
  Upload,
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  Download,
  Copy,
  Check,
  Save,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function StatPill({ label, value }) {
  return (
    <div className="rounded-xl border bg-card px-3.5 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function PsdImportClient() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [imported, setImported] = useState(null);

  const projectJson = useMemo(
    () => (result?.project ? JSON.stringify(result.project, null, 2) : ""),
    [result]
  );

  const onSelectFile = useCallback((nextFile) => {
    setError("");
    setResult(null);
    setImportError("");
    setImported(null);
    setFile(nextFile || null);
  }, []);

  const onConvert = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);
    setImportError("");
    setImported(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/tools/psd-import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Conversion failed (${response.status}).`);
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      setLoading(false);
    }
  }, [file]);

  const onImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    setImportError("");
    setImported(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/tools/psd-import/import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Import failed (${response.status}).`);
      }
      setImported(payload);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }, [file]);

  const onCopyJson = useCallback(async () => {
    if (!projectJson) return;
    try {
      await navigator.clipboard.writeText(projectJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  }, [projectJson]);

  const onDownloadJson = useCallback(() => {
    if (!projectJson) return;
    const blob = new Blob([projectJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result?.name || "psd-project"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [projectJson, result]);

  const stats = result?.stats;
  const layerUri = (index) => {
    const layer = result?.project?.layers?.[index];
    return layer?.type === "IMAGE" ? layer.imageUri : null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Layers className="h-6 w-6 text-primary" aria-hidden="true" />
          PSD Import
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Convert a Photoshop <code>.psd</code> into editable mobile-template layers. Text layers become
          re-typeable text; everything else is rasterized per layer. Upload a few files to validate the
          converter before wiring it into the Freepik pipeline.
        </p>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Upload a PSD</CardTitle>
          <CardSubtitle>Max 200&nbsp;MB. Nothing is stored — rasters are inlined for preview only.</CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors hover:bg-accent"
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer?.files?.[0];
              if (dropped) onSelectFile(dropped);
            }}
          >
            <Upload className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm font-medium">
              {file ? file.name : "Click to choose or drag a .psd here"}
            </div>
            {file ? (
              <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
            ) : (
              <div className="text-xs text-muted-foreground">Photoshop document</div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".psd,image/vnd.adobe.photoshop"
              className="hidden"
              onChange={(event) => onSelectFile(event.target.files?.[0] || null)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={onConvert} disabled={!file || loading}>
              {loading ? "Converting…" : "Convert PSD"}
            </Button>
            {file ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onSelectFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                disabled={loading}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>{result.name}</CardTitle>
              <CardSubtitle>
                {result.docWidth} × {result.docHeight}px · {stats.emitted} layer
                {stats.emitted === 1 ? "" : "s"} extracted
              </CardSubtitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatPill label="Text layers" value={stats.textCount} />
                <StatPill label="Image layers" value={stats.imageCount} />
                <StatPill label="Groups" value={stats.groups} />
                <StatPill label="Hidden skipped" value={stats.skippedHidden} />
                <StatPill label="Empty skipped" value={stats.skippedEmpty} />
                <StatPill label="Fonts used" value={stats.fontsUsed.length} />
              </div>

              {result.fontStatus?.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    Fonts — {result.fontStatus.filter((font) => font.available).length} of{" "}
                    {result.fontStatus.length} available in catalog
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {result.fontStatus.map((font) => (
                      <Badge key={font.name} variant={font.available ? "success" : "warning"}>
                        <span className="inline-flex items-center gap-1">
                          {font.available ? (
                            <Check className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          )}
                          {font.name}
                        </span>
                      </Badge>
                    ))}
                  </div>
                  {result.fontStatus.some((font) => !font.available) ? (
                    <p className="text-xs text-muted-foreground">
                      Missing fonts render with a fallback until added to the font catalog.
                    </p>
                  ) : null}
                </div>
              ) : stats.fontsUsed.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Fonts:</span>
                  {stats.fontsUsed.map((font) => (
                    <Badge key={font}>{font}</Badge>
                  ))}
                </div>
              ) : null}

              {result.warnings?.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    Fidelity notes
                  </div>
                  <ul className="list-disc space-y-1 pl-5">
                    {result.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={onImport} disabled={importing || stats.emitted === 0}>
                    <span className="inline-flex items-center gap-1.5">
                      <Save className="h-4 w-4" aria-hidden="true" />
                      {importing ? "Importing…" : "Import to Templates database"}
                    </span>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Uploads layers to storage and saves a draft template (category “general”).
                  </span>
                </div>
                {imported ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      Imported as <strong>{imported.name}</strong> — {imported.uploadedAssets} asset
                      {imported.uploadedAssets === 1 ? "" : "s"} uploaded, {imported.layerCount} layer
                      {imported.layerCount === 1 ? "" : "s"}.
                    </span>
                    <a
                      href="/templates"
                      className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                    >
                      View in Templates <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                    {imported.missingFonts?.length > 0 ? (
                      <span className="w-full text-xs">
                        {imported.missingFonts.length} font
                        {imported.missingFonts.length === 1 ? "" : "s"} not in catalog (
                        {imported.missingFonts.join(", ")}) — will use a fallback until added.
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {importError ? (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{importError}</span>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Composite preview */}
          {result.composite ? (
            <Card>
              <CardHeader>
                <CardTitle>Composite preview</CardTitle>
                <CardSubtitle>The flattened PSD as Photoshop renders it — your ground truth.</CardSubtitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center rounded-xl border bg-muted/40 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={result.composite}
                    alt="PSD composite preview"
                    className="max-h-[520px] w-auto max-w-full rounded-md shadow-sm"
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Layer breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Extracted layers</CardTitle>
              <CardSubtitle>Bottom → top (z-order). Verify text content, fonts, and positions.</CardSubtitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>#</TableHeaderCell>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell>Preview / Text</TableHeaderCell>
                      <TableHeaderCell>Font</TableHeaderCell>
                      <TableHeaderCell>Position</TableHeaderCell>
                      <TableHeaderCell>Size</TableHeaderCell>
                      <TableHeaderCell>Notes</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.sourceLayers.map((layer) => {
                      const uri = layerUri(layer.index);
                      return (
                        <TableRow key={layer.index}>
                          <TableCell className="tabular-nums text-muted-foreground">{layer.index}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              {layer.kind === "text" ? (
                                <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                              ) : (
                                <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              )}
                              <span className="capitalize">{layer.kind}</span>
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            {layer.kind === "text" ? (
                              <span className="line-clamp-2 whitespace-pre-wrap break-words">{layer.text}</span>
                            ) : uri ? (
                              <span className="flex items-center gap-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={uri}
                                  alt={layer.name}
                                  className="h-10 w-10 shrink-0 rounded border bg-muted/40 object-contain"
                                />
                                <span className="truncate text-xs text-muted-foreground">{layer.name}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">{layer.name}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {layer.kind === "text" ? (
                              <span className="flex items-center gap-2">
                                {layer.colorHex ? (
                                  <span
                                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border"
                                    style={{ backgroundColor: layer.colorHex }}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span>
                                  {layer.fontName}
                                  {layer.fontSize ? ` · ${layer.fontSize}px` : ""}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-xs text-muted-foreground">
                            {layer.x}, {layer.y}
                          </TableCell>
                          <TableCell className="tabular-nums text-xs text-muted-foreground">
                            {layer.width}×{layer.height}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="flex flex-wrap gap-1">
                              {layer.hasEffects ? <Badge>fx</Badge> : null}
                              {layer.hasMask ? <Badge>mask</Badge> : null}
                              {layer.blendMode ? <Badge>{layer.blendMode}</Badge> : null}
                              {layer.opacity < 1 ? <Badge>{Math.round(layer.opacity * 100)}%</Badge> : null}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Raw JSON */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Mobile project JSON</CardTitle>
                <CardSubtitle>Output of toMobileProjectSlim — the editor&apos;s layer format.</CardSubtitle>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="ghost" onClick={onCopyJson}>
                  {copied ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Check className="h-4 w-4" aria-hidden="true" /> Copied
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Copy className="h-4 w-4" aria-hidden="true" /> Copy
                    </span>
                  )}
                </Button>
                <Button type="button" variant="ghost" onClick={onDownloadJson}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download className="h-4 w-4" aria-hidden="true" /> Download
                  </span>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                  Show {result.project.layers.length} layer{result.project.layers.length === 1 ? "" : "s"} of JSON
                </summary>
                <pre className="mt-3 max-h-[480px] overflow-auto rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed">
                  {projectJson}
                </pre>
              </details>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
