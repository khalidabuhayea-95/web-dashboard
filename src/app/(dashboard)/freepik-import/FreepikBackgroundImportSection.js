"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";

const DEFAULT_BACKGROUND_QUERY = {
  term: "background",
  slug: "",
  page: 1,
  limit: 40,
  order: "relevance",
  acceptLanguage: "",
};

const BACKGROUND_FILTER_SELECT_OPTIONS = {
  orientation: [
    { value: "all", label: "All orientations" },
    { value: "landscape", label: "Landscape" },
    { value: "portrait", label: "Portrait" },
    { value: "square", label: "Square" },
  ],
  contentType: [
    { value: "all", label: "All content types" },
    { value: "photo", label: "Photo" },
    { value: "vector", label: "Vector" },
    { value: "psd", label: "PSD" },
  ],
};

const DEFAULT_BACKGROUND_FILTERS = {
  orientation: "all",
  contentType: "all",
};

const IMPORT_POLL_INTERVAL_MS = 2000;
const IMPORT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

function formatErrorMessage(payload, fallback = "Request failed.") {
  const details = [];
  if (payload?.error && typeof payload.error === "string") {
    details.push(payload.error);
  }
  if (payload?.details && typeof payload.details === "string" && payload.details !== payload.error) {
    details.push(payload.details);
  }
  return details.length > 0 ? details.join(" ") : fallback;
}

function normalizeBackgroundOrientationValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "all";
  if (normalized === "horizontal") return "landscape";
  if (normalized === "vertical") return "portrait";
  if (normalized === "landscape" || normalized === "portrait" || normalized === "square") {
    return normalized;
  }
  return "all";
}

function normalizeBackgroundContentTypeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "all";
  return normalized;
}

function buildBackgroundFiltersPayload(filters) {
  const payload = {};

  const orientation = normalizeBackgroundOrientationValue(filters?.orientation);
  if (orientation !== "all") {
    payload.orientation = {
      [orientation]: 1,
    };
  }

  const contentType = normalizeBackgroundContentTypeValue(filters?.contentType);
  if (contentType !== "all") {
    payload.content_type = {
      [contentType]: 1,
    };
  }

  return payload;
}

function buildBackgroundPreviewDebugCurl({ query, filters, maskedApiKey = "YOUR_API_KEY" }) {
  const safeQuery = query && typeof query === "object" ? query : {};
  const params = new URLSearchParams();
  const term = String(safeQuery.term || "").trim();
  const slug = String(safeQuery.slug || "").trim();
  const page = Number(safeQuery.page) || 1;
  const limit = Number(safeQuery.limit) || 40;
  const order = String(safeQuery.order || "").trim() || "relevance";
  const acceptLanguage = String(safeQuery.acceptLanguage || "").trim();

  if (term) params.set("term", term);
  if (slug) params.set("slug", slug);
  params.set("page", String(page));
  params.set("limit", String(limit));
  params.set("order", order);

  const filtersPayload = buildBackgroundFiltersPayload(filters);
  Object.entries(filtersPayload).forEach(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    Object.entries(value).forEach(([nestedKey, nestedValue]) => {
      const safeValue = String(nestedValue || "").trim();
      if (!safeValue) return;
      params.append(`filters[${key}][${nestedKey}]`, safeValue);
    });
  });
  params.append("filters[license][freemium]", "1");

  const url = `https://api.freepik.com/v1/resources?${params.toString()}`;
  const curlLines = [
    "curl --request GET \\",
    `  --url '${url}' \\`,
  ];
  if (acceptLanguage) {
    curlLines.push(`  --header 'Accept-Language: ${acceptLanguage}' \\`);
  }
  curlLines.push(`  --header 'x-freepik-api-key: ${maskedApiKey}'`);
  return curlLines.join("\n");
}

function extractMaskedApiKeyFromCurl(curlCommand) {
  const source = String(curlCommand || "");
  const match = source.match(/x-freepik-api-key:\s*([^'\n\r]+)/i);
  return match ? String(match[1] || "").trim() : "";
}

function buildBackgroundDownloadDebugCurl({ item, maskedApiKey = "", acceptLanguage = "" }) {
  const resourceId = Number.parseInt(String(item?.id || ""), 10);
  if (!Number.isFinite(resourceId) || resourceId < 1 || !maskedApiKey) return "";

  const url = `https://api.freepik.com/v1/resources/${resourceId}/download`;
  const curlLines = [
    "curl --request GET \\",
    `  --url '${url}' \\`,
  ];
  if (String(acceptLanguage || "").trim()) {
    curlLines.push(`  --header 'Accept-Language: ${String(acceptLanguage).trim()}' \\`);
  }
  curlLines.push(`  --header 'x-freepik-api-key: ${maskedApiKey}'`);
  return curlLines.join("\n");
}

function formatBackgroundSizeLabel(width, height) {
  const safeWidth = Number.isFinite(Number(width)) ? Number(width) : null;
  const safeHeight = Number.isFinite(Number(height)) ? Number(height) : null;
  if (!safeWidth || !safeHeight) return "";
  return `${safeWidth} x ${safeHeight}`;
}

function normalizePreviewItem(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    id: String(source.id || ""),
    title: String(source.title || source.name || "").trim(),
    slug: String(source.slug || "").trim(),
    type: String(source.type || "").trim(),
    orientation: String(source.orientation || "").trim(),
    tags: Array.isArray(source.tags)
      ? source.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [],
    thumbnailUrl: String(source.thumbnailUrl || source.assetUrl || "").trim(),
    assetUrl: String(source.assetUrl || source.thumbnailUrl || "").trim(),
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
    author: source.author && typeof source.author === "object" ? source.author : {},
    created: String(source.created || "").trim(),
    sourcePayload: source.sourcePayload && typeof source.sourcePayload === "object" ? source.sourcePayload : source,
  };
}

async function pollImportJob(jobId, { onUpdate } = {}) {
  const safeJobId = String(jobId || "").trim();
  if (!safeJobId) {
    throw new Error("Missing import job id.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < IMPORT_POLL_TIMEOUT_MS) {
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

    const status = String(job?.status || "").trim().toLowerCase();
    if (status === "succeeded") {
      return job;
    }
    if (status === "failed") {
      throw new Error(job?.error || "Import job failed.");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, IMPORT_POLL_INTERVAL_MS);
    });
  }

  throw new Error("Import job timed out.");
}

export default function FreepikBackgroundImportSection({
  defaultAcceptLanguage = "",
  loadingSettings = false,
}) {
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [backgroundCategories, setBackgroundCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [backgroundQuery, setBackgroundQuery] = useState(DEFAULT_BACKGROUND_QUERY);
  const [filters, setFilters] = useState(DEFAULT_BACKGROUND_FILTERS);
  const [selectedCategoryValue, setSelectedCategoryValue] = useState("");
  const [status, setStatus] = useState("Loading background categories...");

  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [previewPagination, setPreviewPagination] = useState({ total: 0, lastPage: 1, perPage: 40, currentPage: 1 });
  const [previewDebugCurl, setPreviewDebugCurl] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [importBusy, setImportBusy] = useState(false);
  const [jobProgress, setJobProgress] = useState("");
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    setBackgroundQuery((current) => ({
      ...current,
      acceptLanguage: current.acceptLanguage || String(defaultAcceptLanguage || ""),
    }));
  }, [defaultAcceptLanguage]);

  useEffect(() => {
    let mounted = true;

    const loadCategories = async () => {
      setCategoriesLoading(true);
      try {
        const response = await fetch("/api/settings/background-categories", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load background categories."));
        }

        if (!mounted) return;
        const nextCategories = Array.isArray(payload?.settings)
          ? payload.settings.filter((item) => item && typeof item === "object" && item.published !== false)
          : [];
        setBackgroundCategories(nextCategories);
        setSelectedCategoryValue((current) => {
          if (current && nextCategories.some((item) => item.value === current)) {
            return current;
          }
          return String(nextCategories[0]?.value || "");
        });
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setBackgroundCategories([]);
        setSelectedCategoryValue("");
        setStatus(error?.message || "Failed to load background categories.");
      } finally {
        if (mounted) setCategoriesLoading(false);
      }
    };

    void loadCategories();
    return () => {
      mounted = false;
    };
  }, []);

  const contentTypeOptions = useMemo(() => {
    const options = [...BACKGROUND_FILTER_SELECT_OPTIONS.contentType];
    const knownValues = new Set(options.map((option) => option.value));

    previewItems.forEach((item) => {
      const value = normalizeBackgroundContentTypeValue(item.type);
      if (value === "all" || knownValues.has(value)) return;
      knownValues.add(value);
      options.push({
        value,
        label: value
          .split(/[-_\s]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
      });
    });

    return options;
  }, [previewItems]);

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return previewItems.filter((item) => selectedIds.has(item.id));
  }, [previewItems, selectedIds]);
  const downloadDebugItem = useMemo(
    () => selectedItems[0] || previewItems[0] || null,
    [previewItems, selectedItems]
  );
  const previewMaskedApiKey = useMemo(
    () => extractMaskedApiKeyFromCurl(previewDebugCurl),
    [previewDebugCurl]
  );
  const previewDownloadCurl = useMemo(
    () =>
      buildBackgroundDownloadDebugCurl({
        item: downloadDebugItem,
        maskedApiKey: previewMaskedApiKey,
        acceptLanguage: backgroundQuery.acceptLanguage,
      }),
    [backgroundQuery.acceptLanguage, downloadDebugItem, previewMaskedApiKey]
  );

  const selectedCount = selectedItems.length;

  const updateBackgroundQueryField = (field, value) => {
    setBackgroundQuery((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateFilterField = (field, value) => {
    setFilters((current) => ({
      ...current,
      [field]: value,
    }));
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters.contentType, filters.orientation]);

  const fetchPreview = async (override = {}) => {
    setPreviewBusy(true);
    setStatus("Fetching Freepik backgrounds...");
    setImportResult(null);
    try {
      const filtersPayload = buildBackgroundFiltersPayload(filters);
      const nextQuery = {
        ...backgroundQuery,
        ...override,
        page: Number(override.page ?? backgroundQuery.page) || 1,
        limit: Number(override.limit ?? backgroundQuery.limit) || 40,
        filters: filtersPayload,
      };
      const fallbackPreviewCurl = buildBackgroundPreviewDebugCurl({
        query: nextQuery,
        filters,
        maskedApiKey: extractMaskedApiKeyFromCurl(previewDebugCurl) || "YOUR_API_KEY",
      });
      setPreviewDebugCurl(fallbackPreviewCurl);

      const response = await fetch("/api/settings/freepik/backgrounds/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: nextQuery,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const debugCurl = String(payload?.debug?.curl || "").trim();
      if (debugCurl) {
        setPreviewDebugCurl(debugCurl);
      }
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to preview backgrounds."));
      }

      const items = Array.isArray(payload?.items)
        ? payload.items
            .map(normalizePreviewItem)
            .filter((item) => item.id && (item.thumbnailUrl || item.assetUrl))
        : [];
      const pagination = payload?.pagination || {};

      setPreviewItems(items);
      setPreviewPagination({
        total: Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : items.length,
        lastPage: Number.isFinite(Number(pagination.lastPage)) ? Number(pagination.lastPage) : 1,
        perPage: Number.isFinite(Number(pagination.perPage)) ? Number(pagination.perPage) : Number(nextQuery.limit) || 40,
        currentPage: Number.isFinite(Number(pagination.currentPage)) ? Number(pagination.currentPage) : Number(nextQuery.page) || 1,
      });
      setBackgroundQuery((current) => ({
        ...current,
        page: Number(nextQuery.page) || 1,
      }));
      setSelectedIds(new Set());
      setStatus(`Loaded ${items.length} background(s).`);
    } catch (error) {
      setPreviewItems([]);
      setPreviewPagination({ total: 0, lastPage: 1, perPage: Number(backgroundQuery.limit) || 40, currentPage: Number(backgroundQuery.page) || 1 });
      setSelectedIds(new Set());
      setStatus(error?.message || "Failed to preview backgrounds.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(previewItems.map((item) => item.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleImportSelected = async () => {
    if (selectedItems.length === 0) {
      setStatus("Select at least one background before import.");
      return;
    }
    if (!selectedCategoryValue) {
      setStatus("Choose a background category before import.");
      return;
    }

    setImportBusy(true);
    setJobProgress("Creating background import job...");
    setImportResult(null);
    try {
      const response = await fetch("/api/tools/import-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "freepik-backgrounds",
          categoryValue: selectedCategoryValue,
          selectedItems: selectedItems.map((item) => ({
            id: item.id,
            title: item.title,
            slug: item.slug,
            type: item.type,
            orientation: item.orientation,
            tags: item.tags,
            thumbnailUrl: item.thumbnailUrl,
            assetUrl: item.assetUrl,
            width: item.width,
            height: item.height,
            author: item.author,
            created: item.created,
            sourcePayload: item.sourcePayload,
          })),
          query: {
            ...backgroundQuery,
            filters: buildBackgroundFiltersPayload(filters),
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to queue Freepik background import."));
      }

      const jobId = String(payload?.job?.id || "").trim();
      if (!jobId) {
        throw new Error("Import job id was not returned.");
      }

      const completedJob = await pollImportJob(jobId, {
        onUpdate: (job) => {
          setJobProgress(String(job?.progress || "Processing Freepik background import..."));
        },
      });

      const result = completedJob?.result && typeof completedJob.result === "object" ? completedJob.result : {};
      setImportResult(result);
      const imported = Number(result.imported || 0);
      const failed = Number(result.failed || 0);
      const requested = Number(result.totalRequested || selectedItems.length);
      const firstError =
        Array.isArray(result.errors) && result.errors.length > 0
          ? String(result.errors[0]?.message || "").trim()
          : "";
      setStatus(
        firstError
          ? `Background import completed. Imported ${imported} / ${requested}. Failed: ${failed}. First error: ${firstError}`
          : `Background import completed. Imported ${imported} / ${requested}. Failed: ${failed}.`
      );
    } catch (error) {
      setStatus(error?.message || "Freepik background import failed.");
    } finally {
      setImportBusy(false);
      setJobProgress("");
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Backgrounds Import</CardTitle>
          <CardSubtitle>
            Search Freepik stock backgrounds, choose a background category, then import the selected assets.
          </CardSubtitle>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setSectionCollapsed((current) => !current)}
          aria-expanded={!sectionCollapsed}
        >
          {sectionCollapsed ? (
            <>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              Expand
            </>
          ) : (
            <>
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
              Collapse
            </>
          )}
        </Button>
      </CardHeader>
      {!sectionCollapsed ? (
        <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="freepik-background-term">term</Label>
            <Input
              id="freepik-background-term"
              value={backgroundQuery.term}
              onChange={(event) => updateBackgroundQueryField("term", event.target.value)}
              placeholder="background"
              disabled={loadingSettings}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-slug">slug</Label>
            <Input
              id="freepik-background-slug"
              value={backgroundQuery.slug}
              onChange={(event) => updateBackgroundQueryField("slug", event.target.value)}
              placeholder="blue-abstract-background"
              disabled={loadingSettings}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-page">page</Label>
            <Input
              id="freepik-background-page"
              type="number"
              min={1}
              max={100}
              value={backgroundQuery.page}
              onChange={(event) => updateBackgroundQueryField("page", event.target.value)}
              disabled={loadingSettings}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-limit">limit</Label>
            <Input
              id="freepik-background-limit"
              type="number"
              min={1}
              max={100}
              value={backgroundQuery.limit}
              onChange={(event) => updateBackgroundQueryField("limit", event.target.value)}
              disabled={loadingSettings}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="freepik-background-order">order</Label>
            <Select
              id="freepik-background-order"
              value={backgroundQuery.order}
              onChange={(event) => updateBackgroundQueryField("order", event.target.value)}
              disabled={loadingSettings}
            >
              <option value="relevance">relevance</option>
              <option value="recent">recent</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-orientation">filters[orientation]</Label>
            <Select
              id="freepik-background-orientation"
              value={filters.orientation}
              onChange={(event) => updateFilterField("orientation", event.target.value)}
              disabled={loadingSettings}
            >
              {BACKGROUND_FILTER_SELECT_OPTIONS.orientation.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-content-type">filters[content_type]</Label>
            <Select
              id="freepik-background-content-type"
              value={filters.contentType}
              onChange={(event) => updateFilterField("contentType", event.target.value)}
              disabled={loadingSettings}
            >
              {contentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-language">Accept-Language</Label>
            <Input
              id="freepik-background-language"
              value={backgroundQuery.acceptLanguage}
              onChange={(event) => updateBackgroundQueryField("acceptLanguage", event.target.value)}
              placeholder="en-US"
              disabled={loadingSettings}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-category">Background category</Label>
            <Select
              id="freepik-background-category"
              value={selectedCategoryValue}
              onChange={(event) => setSelectedCategoryValue(event.target.value)}
              disabled={categoriesLoading || backgroundCategories.length === 0}
            >
              {backgroundCategories.length === 0 ? (
                <option value="">{categoriesLoading ? "Loading categories..." : "No categories"}</option>
              ) : (
                backgroundCategories.map((item) => (
                  <option key={item.id || item.value} value={item.value}>
                    {item.labelEn || item.labelAr || item.value}
                  </option>
                ))
              )}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freepik-background-selection-count">Selected backgrounds</Label>
            <Input id="freepik-background-selection-count" value={String(selectedCount)} readOnly />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void fetchPreview()} disabled={previewBusy || loadingSettings}>
            {previewBusy ? "Fetching..." : "Fetch backgrounds"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void fetchPreview({ page: Math.max(1, Number(backgroundQuery.page) - 1) })}
            disabled={previewBusy || Number(backgroundQuery.page) <= 1}
          >
            Prev page
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void fetchPreview({ page: Number(backgroundQuery.page) + 1 })}
            disabled={previewBusy || Number(backgroundQuery.page) >= Number(previewPagination.lastPage || 1)}
          >
            Next page
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Total: {previewPagination.total} | Page: {previewPagination.currentPage}/{previewPagination.lastPage} | Per page: {previewPagination.perPage}
          </span>
          {filters.orientation !== "all" || filters.contentType !== "all" ? (
            <span> | API filters active</span>
          ) : null}
        </div>

        {previewDebugCurl ? (
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Preview curl
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-[11px] leading-5 text-foreground">
              {previewDebugCurl}
            </pre>
          </div>
        ) : null}

        {previewDownloadCurl ? (
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Download curl
              </div>
              {downloadDebugItem?.id ? (
                <div className="text-[11px] text-muted-foreground">
                  Resource #{downloadDebugItem.id}
                </div>
              ) : null}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-[11px] leading-5 text-foreground">
              {previewDownloadCurl}
            </pre>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={selectAllVisible} disabled={previewItems.length === 0}>
            Select all visible
          </Button>
          <Button type="button" variant="secondary" onClick={clearSelection} disabled={selectedCount === 0}>
            Clear selection
          </Button>
          <Button
            type="button"
            onClick={handleImportSelected}
            disabled={importBusy || selectedCount === 0 || !selectedCategoryValue}
          >
            {importBusy ? "Importing..." : "Import selected backgrounds"}
          </Button>
        </div>

        {jobProgress ? <div className="text-sm text-muted-foreground">{jobProgress}</div> : null}

        {importResult ? (
          <div className="rounded-xl border border-border bg-muted/25 p-3 text-sm">
            Imported: {Number(importResult.imported || 0)} | Failed: {Number(importResult.failed || 0)} | Requested: {Number(importResult.totalRequested || 0)}
          </div>
        ) : null}

        {previewItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            No preview backgrounds yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {previewItems.map((item) => {
              const selected = selectedIds.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleSelected(item.id)}
                  className={`rounded-xl border p-2 text-left transition ${
                    selected ? "border-primary ring-1 ring-primary/20" : "border-border hover:bg-accent/40"
                  }`}
                >
                  <div className="relative overflow-hidden rounded-md bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbnailUrl || item.assetUrl}
                      alt={item.title || "Freepik background"}
                      className="h-40 w-full object-cover"
                    />
                    {item.type ? (
                      <span className="absolute left-2 top-2 rounded-full bg-[#1f2a39] px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                        {item.type}
                      </span>
                    ) : null}
                    <input
                      type="checkbox"
                      checked={selected}
                      readOnly
                      className="absolute right-2 top-2 h-4 w-4"
                    />
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold">{item.title || item.slug || item.id}</div>
                  <div className="text-[11px] text-muted-foreground">#{item.id}</div>
                  {formatBackgroundSizeLabel(item.width, item.height) ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Preview size: {formatBackgroundSizeLabel(item.width, item.height)}
                    </div>
                  ) : null}
                  {item.tags.length > 0 ? (
                    <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.tags.join(", ")}</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <div role="status" className="text-sm text-muted-foreground">
          {status}
        </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
