"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Type,
  Upload,
  Trash2,
  Search,
  Check,
  AlertTriangle,
  X,
  Image as ImageIcon,
  RefreshCw,
  Loader2,
  Sparkles,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";

const PER_PAGE = 40;
const ARABIC_SAMPLE = "أبجد هوز حطي";
const LATIN_SAMPLE = "The quick brown fox";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function LanguageBadges({ languages }) {
  return (
    <span className="flex flex-wrap gap-1">
      {languages?.english ? <Badge variant="neutral">EN</Badge> : null}
      {languages?.arabic ? <Badge variant="neutral">AR</Badge> : null}
      {!languages?.english && !languages?.arabic ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : null}
    </span>
  );
}

export default function FontsClient() {
  const [fonts, setFonts] = useState([]);
  const [counts, setCounts] = useState({ total: 0, english: 0, arabic: 0, google: 0, custom: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("all");
  const [page, setPage] = useState(1);

  const [uploadFile, setUploadFile] = useState(null);
  const [uploadFamily, setUploadFamily] = useState("");
  const [uploadLanguage, setUploadLanguage] = useState("auto");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const uploadInputRef = useRef(null);

  // Preview-image generation state.
  const [rowGenerating, setRowGenerating] = useState({});
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total, failed }
  const [previewNotice, setPreviewNotice] = useState("");
  const bulkCancelRef = useRef(false);

  const fetchFonts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        search,
        language,
        page: String(page),
        perPage: String(PER_PAGE),
      });
      const response = await fetch(`/api/admin/fonts?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to load fonts.");
      setFonts(Array.isArray(payload.fonts) ? payload.fonts : []);
      setCounts(payload.counts || { total: 0, english: 0, arabic: 0, google: 0, custom: 0 });
      setTotal(Number(payload.total) || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fonts.");
    } finally {
      setLoading(false);
    }
  }, [search, language, page]);

  useEffect(() => {
    fetchFonts();
  }, [fetchFonts]);

  // Inject an @font-face per visible font so the preview column renders in the
  // font's own typeface (served from /api/mobile/fonts/{id}/file).
  const fontFaceCss = useMemo(
    () =>
      fonts
        .filter((font) => font.mobileCompatible && font.fileUrl)
        .map((font) => `@font-face{font-family:'pf-${font.id}';font-display:swap;src:url("${font.fileUrl}");}`)
        .join("\n"),
    [fonts]
  );

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const onPickUpload = useCallback((file) => {
    setUploadError("");
    setUploadNotice("");
    setUploadFile(file || null);
    if (file) {
      const base = String(file.name || "").replace(/\.(ttf|otf|woff2?|eot)$/i, "").replace(/[_-]+/g, " ").trim();
      setUploadFamily(base);
    }
  }, []);

  const submitUpload = useCallback(async () => {
    if (!uploadFile || !uploadFamily.trim()) {
      setUploadError("Choose a font file and a family name.");
      return;
    }
    setUploading(true);
    setUploadError("");
    setUploadNotice("");
    try {
      const dataUrl = await readFileAsDataUrl(uploadFile);
      const categories = uploadLanguage === "auto" ? [] : [uploadLanguage];
      const response = await fetch("/api/admin/fonts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family: uploadFamily.trim(),
          fileName: uploadFile.name,
          dataUrl,
          categories,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload?.error || `Upload failed (${response.status}).`);
      setUploadNotice(
        payload.skipped
          ? `“${uploadFamily.trim()}” already exists — skipped.`
          : `Uploaded “${uploadFamily.trim()}”.`
      );
      setUploadFile(null);
      setUploadFamily("");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      setPage(1);
      await fetchFonts();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, [uploadFile, uploadFamily, uploadLanguage, fetchFonts]);

  const deleteFont = useCallback(
    async (font) => {
      if (!font?.id) return;
      if (!window.confirm(`Delete “${font.family}” from the library?`)) return;
      try {
        const response = await fetch("/api/admin/fonts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: font.id, family: font.family, source: font.source }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload?.error || "Delete failed.");
        await fetchFonts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed.");
      }
    },
    [fetchFonts]
  );

  const patchFontRow = useCallback((id, patch) => {
    setFonts((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const generateOnePreview = useCallback(
    async (font) => {
      if (!font?.id || rowGenerating[font.id]) return;
      setRowGenerating((prev) => ({ ...prev, [font.id]: true }));
      setPreviewNotice("");
      setError("");
      try {
        const response = await fetch("/api/admin/fonts/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [font.id], force: true }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload?.error || `Generation failed (${response.status}).`);
        const result = Array.isArray(payload.results) ? payload.results[0] : null;
        if (!result?.ok) throw new Error(result?.error || "Generation failed.");
        patchFontRow(font.id, {
          previewImageUrl: result.previewImageUrl || null,
          previewImageDarkUrl: result.previewImageDarkUrl || null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Preview generation failed.");
      } finally {
        setRowGenerating((prev) => {
          const next = { ...prev };
          delete next[font.id];
          return next;
        });
      }
    },
    [rowGenerating, patchFontRow]
  );

  const generateAllPreviews = useCallback(
    async ({ force = false } = {}) => {
      if (bulkGenerating) return;
      setBulkGenerating(true);
      setPreviewNotice("");
      setError("");
      bulkCancelRef.current = false;
      try {
        const listRes = await fetch(`/api/admin/fonts/preview?missingOnly=${force ? "0" : "1"}`);
        const listPayload = await listRes.json().catch(() => ({}));
        if (!listRes.ok) throw new Error(listPayload?.error || "Could not load fonts to generate.");
        const ids = Array.isArray(listPayload.ids) ? listPayload.ids : [];
        const total = ids.length;
        setBulkProgress({ done: 0, total, failed: 0 });
        if (total === 0) {
          setPreviewNotice(force ? "No fonts to generate." : "All fonts already have previews.");
          return;
        }
        const BATCH = 20;
        let done = 0;
        let failed = 0;
        for (let i = 0; i < ids.length; i += BATCH) {
          if (bulkCancelRef.current) break;
          const batch = ids.slice(i, i + BATCH);
          try {
            const res = await fetch("/api/admin/fonts/preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: batch, force }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || `Batch failed (${res.status}).`);
            failed += Number(payload.failedCount || 0);
          } catch (_err) {
            failed += batch.length;
          }
          done += batch.length;
          setBulkProgress({ done, total, failed });
        }
        setPreviewNotice(
          bulkCancelRef.current
            ? `Stopped. Processed ${done}/${total}.`
            : `Done. Generated ${Math.max(0, done - failed)}/${total}${failed ? ` · ${failed} failed` : ""}.`
        );
        await fetchFonts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Preview generation failed.");
      } finally {
        setBulkGenerating(false);
      }
    },
    [bulkGenerating, fetchFonts]
  );

  return (
    <div className="space-y-6">
      {fontFaceCss ? <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} /> : null}

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Type className="h-6 w-6 text-primary" aria-hidden="true" />
          Fonts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the font library served to the editor and mobile apps. Upload fonts and organize
          by language.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Total", value: counts.total },
          { label: "English", value: counts.english },
          { label: "Arabic", value: counts.arabic },
          { label: "Google", value: counts.google },
          { label: "Custom", value: counts.custom },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card px-3.5 py-2.5">
            <div className="text-xs text-muted-foreground">{stat.label}</div>
            <div className="text-lg font-semibold tabular-nums">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Upload a font */}
      <Card>
        <CardHeader>
          <CardTitle>Upload a font</CardTitle>
          <CardSubtitle>TTF, OTF, WOFF, or WOFF2. WOFF/WOFF2 are converted to a mobile-compatible TTF automatically.</CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor="font-file">Font file</Label>
              <input
                ref={uploadInputRef}
                id="font-file"
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(event) => onPickUpload(event.target.files?.[0] || null)}
              />
            </div>
            <div>
              <Label htmlFor="font-family">Family name</Label>
              <Input
                id="font-family"
                value={uploadFamily}
                onChange={(event) => setUploadFamily(event.target.value)}
                placeholder="e.g. My Brand Sans"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="font-language">Language</Label>
              <Select
                id="font-language"
                value={uploadLanguage}
                onChange={(event) => setUploadLanguage(event.target.value)}
                className="mt-1"
              >
                <option value="auto">Auto-detect</option>
                <option value="ENGLISH">English</option>
                <option value="ARABIC">Arabic</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={submitUpload} disabled={uploading || !uploadFile}>
              <span className="inline-flex items-center gap-1.5">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? "Uploading…" : "Upload font"}
              </span>
            </Button>
            {uploadNotice ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="h-4 w-4" aria-hidden="true" /> {uploadNotice}
              </span>
            ) : null}
          </div>
          {uploadError ? (
            <div className="inline-flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {uploadError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Library */}
      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
          <CardSubtitle>{total} font{total === 1 ? "" : "s"}{language !== "all" ? ` · ${language}` : ""}</CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {[
                { value: "all", label: `All (${counts.total})` },
                { value: "english", label: `English (${counts.english})` },
                { value: "arabic", label: `Arabic (${counts.arabic})` },
              ].map((tab) => (
                <Button
                  key={tab.value}
                  type="button"
                  variant={language === tab.value ? "primary" : "ghost"}
                  onClick={() => {
                    setPage(1);
                    setLanguage(tab.value);
                  }}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Search family…"
                className="w-56 pl-8"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-3">
            <Button type="button" onClick={() => generateAllPreviews({ force: false })} disabled={bulkGenerating}>
              {bulkGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {bulkGenerating ? "Generating previews…" : "Generate missing previews"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => generateAllPreviews({ force: true })}
              disabled={bulkGenerating}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Regenerate all
            </Button>
            {bulkGenerating ? (
              <Button type="button" variant="ghost" onClick={() => { bulkCancelRef.current = true; }}>
                Stop
              </Button>
            ) : null}
            {bulkProgress ? (
              <div className="flex min-w-[180px] flex-1 items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${bulkProgress.total ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {bulkProgress.done}/{bulkProgress.total}
                  {bulkProgress.failed ? ` · ${bulkProgress.failed} failed` : ""}
                </span>
              </div>
            ) : null}
            {previewNotice ? (
              <span className="text-xs text-muted-foreground">{previewNotice}</span>
            ) : null}
          </div>

          {error ? (
            <div className="inline-flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Preview</TableHeaderCell>
                  <TableHeaderCell>Family</TableHeaderCell>
                  <TableHeaderCell>Language</TableHeaderCell>
                  <TableHeaderCell>Source</TableHeaderCell>
                  <TableHeaderCell>Mobile</TableHeaderCell>
                  <TableHeaderCell>Image</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                ) : fonts.length === 0 ? (
                  <TableRow>
                    <TableCell className="py-6 text-center text-sm text-muted-foreground">
                      No fonts yet. Upload one above.
                    </TableCell>
                  </TableRow>
                ) : (
                  fonts.map((font) => (
                    <TableRow key={font.id}>
                      <TableCell>
                        <span
                          className="text-xl"
                          style={font.mobileCompatible ? { fontFamily: `'pf-${font.id}', sans-serif` } : undefined}
                        >
                          {font.languages?.arabic ? ARABIC_SAMPLE : LATIN_SAMPLE}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{font.displayName || font.family}</TableCell>
                      <TableCell>
                        <LanguageBadges languages={font.languages} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={font.source === "google" ? "neutral" : "neutral"}>{font.source}</Badge>
                      </TableCell>
                      <TableCell>
                        {font.mobileCompatible ? (
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {font.previewImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- external R2 thumbnail; next/image needs domain config
                            <img
                              src={font.previewImageUrl}
                              alt=""
                              className="h-8 max-w-[140px] rounded border border-border/50 bg-white object-contain px-1"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => generateOnePreview(font)}
                            disabled={Boolean(rowGenerating[font.id])}
                            aria-label={
                              font.previewImageUrl
                                ? `Regenerate preview for ${font.family}`
                                : `Generate preview for ${font.family}`
                            }
                          >
                            {rowGenerating[font.id] ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : font.previewImageUrl ? (
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ImageIcon className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => deleteFont(font)}
                          aria-label={`Delete ${font.family}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Button type="button" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
