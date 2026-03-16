"use client";

import { useEffect, useMemo, useState } from "react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";

const DEFAULT_QUERY = {
  term: "ramadan",
  slug: "",
  page: 1,
  perPage: 100,
  familyId: "",
  order: "relevance",
  thumbnailSize: "512",
  acceptLanguage: "",
};

const FILTER_SELECT_OPTIONS = {
  color: [
    "all",
    "gradient",
    "solid-black",
    "multicolor",
    "azure",
    "black",
    "blue",
    "chartreuse",
    "cyan",
    "gray",
    "green",
    "orange",
    "red",
    "rose",
    "spring-green",
    "violet",
    "white",
    "yellow",
  ],
  shape: ["all", "outline", "fill", "lineal-color", "hand-drawn"],
  period: ["all", "three-months", "six-months", "one-year"],
  freeSvg: ["all", "free", "premium"],
  iconType: ["all", "standard", "animated", "sticker", "uicon"],
};

const DEFAULT_FILTERS = {
  color: "all",
  shape: "all",
  period: "all",
  freeSvg: "all",
  iconType: "all",
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

function normalizeFilterSelectValue(value, allowedOptions) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "all";
  if (!Array.isArray(allowedOptions) || allowedOptions.length === 0) return normalized;
  return allowedOptions.includes(normalized) ? normalized : normalized;
}

function normalizeFreepikFiltersForForm(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const rawFreeSvg = source.free_svg ?? source.freeSvg;
  let freeSvg = "all";
  if (typeof rawFreeSvg === "boolean") {
    freeSvg = rawFreeSvg ? "free" : "premium";
  } else if (rawFreeSvg != null) {
    const normalized = String(rawFreeSvg).trim().toLowerCase();
    if (normalized === "true") freeSvg = "free";
    else if (normalized === "false") freeSvg = "premium";
    else freeSvg = normalizeFilterSelectValue(rawFreeSvg, FILTER_SELECT_OPTIONS.freeSvg);
  }

  const rawIconType = Array.isArray(source.icon_type)
    ? source.icon_type[0]
    : source.icon_type || source.iconType;

  return {
    color: normalizeFilterSelectValue(source.color, FILTER_SELECT_OPTIONS.color),
    shape: normalizeFilterSelectValue(source.shape, FILTER_SELECT_OPTIONS.shape),
    period: normalizeFilterSelectValue(source.period, FILTER_SELECT_OPTIONS.period),
    freeSvg,
    iconType: normalizeFilterSelectValue(rawIconType, FILTER_SELECT_OPTIONS.iconType),
  };
}

function buildFreepikFiltersPayload(filters) {
  const normalized = {
    color: normalizeFilterSelectValue(filters?.color, FILTER_SELECT_OPTIONS.color),
    shape: normalizeFilterSelectValue(filters?.shape, FILTER_SELECT_OPTIONS.shape),
    period: normalizeFilterSelectValue(filters?.period, FILTER_SELECT_OPTIONS.period),
    freeSvg: normalizeFilterSelectValue(filters?.freeSvg, FILTER_SELECT_OPTIONS.freeSvg),
    iconType: normalizeFilterSelectValue(filters?.iconType, FILTER_SELECT_OPTIONS.iconType),
  };

  const payload = {};
  if (normalized.color && normalized.color !== "all") payload.color = normalized.color;
  if (normalized.shape && normalized.shape !== "all") payload.shape = normalized.shape;
  if (normalized.period && normalized.period !== "all") payload.period = normalized.period;
  if (normalized.freeSvg && normalized.freeSvg !== "all") payload.free_svg = normalized.freeSvg;
  if (normalized.iconType && normalized.iconType !== "all") payload.icon_type = [normalized.iconType];
  return payload;
}

function optionsForFilter(currentValue, presetOptions) {
  const options = Array.isArray(presetOptions) ? [...presetOptions] : [];
  const safeCurrent = String(currentValue || "").trim();
  if (safeCurrent && !options.includes(safeCurrent)) {
    options.push(safeCurrent);
  }
  return options;
}

function normalizeOrder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "relevant") return "relevance";
  if (normalized === "latest" || normalized === "popular") return "recent";
  if (normalized === "relevance" || normalized === "recent") return normalized;
  return DEFAULT_QUERY.order;
}

function normalizePreviewItem(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    id: String(source.id || ""),
    name: String(source.name || "").trim(),
    slug: String(source.slug || "").trim(),
    tags: Array.isArray(source.tags)
      ? source.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [],
    thumbnailUrl: String(source.thumbnailUrl || "").trim(),
    assetUrl: String(source.assetUrl || source.thumbnailUrl || "").trim(),
    videoUrl: String(source.videoUrl || source.animatedVideoUrl || "").trim(),
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
    style: source.style && typeof source.style === "object" ? source.style : {},
    family: source.family && typeof source.family === "object" ? source.family : {},
    author: source.author && typeof source.author === "object" ? source.author : {},
    freeSvg: Boolean(source.freeSvg),
    created: String(source.created || "").trim(),
    sourcePayload: source.sourcePayload && typeof source.sourcePayload === "object" ? source.sourcePayload : source,
  };
}

function isAnimatedAssetUrl(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:image/gif") || source.startsWith("data:video/")) return true;
  try {
    const parsed = new URL(source);
    return /\.(gif|mp4|webm|mov|m4v)(?:$|[?#])/i.test(parsed.pathname || "");
  } catch {
    return /\.(gif|mp4|webm|mov|m4v)(?:$|[?#])/i.test(source);
  }
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

export default function FreepikImportClient() {
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [status, setStatus] = useState("Loading Freepik settings...");
  const [saving, setSaving] = useState(false);

  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [previewPagination, setPreviewPagination] = useState({ total: 0, lastPage: 1, perPage: 100, currentPage: 1 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [importBusy, setImportBusy] = useState(false);
  const [jobProgress, setJobProgress] = useState("");
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoadingSettings(true);
      try {
        const response = await fetch("/api/settings/freepik", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load Freepik settings."));
        }

        if (!mounted) return;
        const settings = payload?.settings || {};
        setCanEdit(Boolean(payload?.canEdit));
        setApiKeyConfigured(Boolean(settings?.apiKeyConfigured));
        setApiKeyMasked(String(settings?.apiKeyMasked || ""));

        const defaults = settings?.defaults && typeof settings.defaults === "object" ? settings.defaults : {};
        setQuery({
          term: String(defaults.term || DEFAULT_QUERY.term),
          slug: String(defaults.slug || DEFAULT_QUERY.slug),
          page: Number.isFinite(Number(defaults.page)) ? Number(defaults.page) : DEFAULT_QUERY.page,
          perPage: Number.isFinite(Number(defaults.perPage)) ? Number(defaults.perPage) : DEFAULT_QUERY.perPage,
          familyId: String(defaults.familyId || ""),
          order: normalizeOrder(defaults.order),
          thumbnailSize: String(defaults.thumbnailSize || DEFAULT_QUERY.thumbnailSize),
          acceptLanguage: String(defaults.acceptLanguage || ""),
        });
        setFilters({
          ...DEFAULT_FILTERS,
          ...normalizeFreepikFiltersForForm(defaults.filters || {}),
        });
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setStatus(error?.message || "Failed to load Freepik settings.");
      } finally {
        if (mounted) setLoadingSettings(false);
      }
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  const selectedCount = selectedIds.size;

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return previewItems.filter((item) => selectedIds.has(item.id));
  }, [previewItems, selectedIds]);

  const updateQueryField = (field, value) => {
    setQuery((current) => ({
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

  const handleSaveSettings = async () => {
    setSaving(true);
    setStatus("Saving Freepik settings...");
    try {
      const filtersPayload = buildFreepikFiltersPayload(filters);
      const response = await fetch("/api/settings/freepik", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKeyInput,
          defaults: {
            ...query,
            page: Number(query.page) || 1,
            perPage: Number(query.perPage) || 100,
            familyId: Number(query.familyId) || 0,
            filters: filtersPayload,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save Freepik settings."));
      }

      const settings = payload?.settings || {};
      setApiKeyConfigured(Boolean(settings?.apiKeyConfigured));
      setApiKeyMasked(String(settings?.apiKeyMasked || ""));
      setApiKeyInput("");
      setStatus("Freepik settings saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save Freepik settings.");
    } finally {
      setSaving(false);
    }
  };

  const fetchPreview = async (override = {}) => {
    setPreviewBusy(true);
    setStatus("Fetching Freepik icons...");
    setImportResult(null);
    try {
      const filtersPayload = buildFreepikFiltersPayload(filters);
      const nextQuery = {
        ...query,
        ...override,
        page: Number(override.page ?? query.page) || 1,
        perPage: Number(override.perPage ?? query.perPage) || 100,
        familyId: Number(override.familyId ?? query.familyId) || 0,
        filters: filtersPayload,
      };

      const response = await fetch("/api/settings/freepik/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyOverride: String(apiKeyInput || "").trim(),
          query: nextQuery,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to preview icons."));
      }

      const items = Array.isArray(payload?.items)
        ? payload.items.map(normalizePreviewItem).filter((item) => item.id && item.thumbnailUrl)
        : [];
      const pagination = payload?.pagination || {};

      setPreviewItems(items);
      setPreviewPagination({
        total: Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : items.length,
        lastPage: Number.isFinite(Number(pagination.lastPage)) ? Number(pagination.lastPage) : 1,
        perPage: Number.isFinite(Number(pagination.perPage)) ? Number(pagination.perPage) : Number(nextQuery.perPage) || 100,
        currentPage: Number.isFinite(Number(pagination.currentPage)) ? Number(pagination.currentPage) : Number(nextQuery.page) || 1,
      });
      setQuery((current) => ({
        ...current,
        page: Number(nextQuery.page) || 1,
      }));
      setSelectedIds(new Set());
      setStatus(`Loaded ${items.length} icon(s).`);
    } catch (error) {
      setPreviewItems([]);
      setPreviewPagination({ total: 0, lastPage: 1, perPage: Number(query.perPage) || 100, currentPage: Number(query.page) || 1 });
      setSelectedIds(new Set());
      setStatus(error?.message || "Failed to preview icons.");
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
      setStatus("Select at least one icon before import.");
      return;
    }

    setImportBusy(true);
    setJobProgress("Creating import job...");
    setImportResult(null);
    try {
      const response = await fetch("/api/tools/import-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "freepik-icons",
          selectedItems: selectedItems.map((item) => ({
            id: item.id,
            name: item.name,
            slug: item.slug,
            tags: item.tags,
            thumbnailUrl: item.thumbnailUrl,
            assetUrl: item.assetUrl,
            videoUrl: item.videoUrl,
            width: item.width,
            height: item.height,
            style: item.style,
            family: item.family,
            author: item.author,
            freeSvg: item.freeSvg,
            created: item.created,
            sourcePayload: item.sourcePayload,
          })),
          query,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to queue Freepik import."));
      }

      const jobId = String(payload?.job?.id || "").trim();
      if (!jobId) {
        throw new Error("Import job id was not returned.");
      }

      const completedJob = await pollImportJob(jobId, {
        onUpdate: (job) => {
          setJobProgress(String(job?.progress || "Processing Freepik import..."));
        },
      });

      const result = completedJob?.result && typeof completedJob.result === "object" ? completedJob.result : {};
      setImportResult(result);
      const imported = Number(result.imported || 0);
      const failed = Number(result.failed || 0);
      const requested = Number(result.totalRequested || selectedItems.length);
      const firstError = Array.isArray(result.errors) && result.errors.length > 0
        ? String(result.errors[0]?.message || "").trim()
        : "";
      setStatus(
        firstError
          ? `Import completed. Imported ${imported} / ${requested}. Failed: ${failed}. First error: ${firstError}`
          : `Import completed. Imported ${imported} / ${requested}. Failed: ${failed}.`
      );
    } catch (error) {
      setStatus(error?.message || "Freepik import failed.");
    } finally {
      setImportBusy(false);
      setJobProgress("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Freepik Import</h1>
        <p className="text-sm text-muted-foreground">
          Configure your Freepik API key, preview icons by query parameters, then select and import them into Elements.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Freepik Settings</CardTitle>
          <CardSubtitle>Save API key once and keep reusable query defaults.</CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="freepik-api-key">Freepik API key</Label>
              <Input
                id="freepik-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder={apiKeyConfigured ? "Enter new key to replace existing" : "Enter Freepik API key"}
                disabled={!canEdit || loadingSettings}
              />
              {apiKeyConfigured ? (
                <p className="text-xs text-muted-foreground">Configured key: {apiKeyMasked || "********"}</p>
              ) : (
                <p className="text-xs text-muted-foreground">No API key saved yet.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-accept-language">Accept-Language</Label>
              <Input
                id="freepik-accept-language"
                value={query.acceptLanguage}
                onChange={(event) => updateQueryField("acceptLanguage", event.target.value)}
                placeholder="en-US"
                disabled={loadingSettings}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="freepik-term">term</Label>
              <Input
                id="freepik-term"
                value={query.term}
                onChange={(event) => updateQueryField("term", event.target.value)}
                placeholder="ramadan"
                disabled={loadingSettings}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-slug">slug</Label>
              <Input
                id="freepik-slug"
                value={query.slug}
                onChange={(event) => updateQueryField("slug", event.target.value)}
                placeholder="moon_13643078"
                disabled={loadingSettings}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-page">page</Label>
              <Input
                id="freepik-page"
                type="number"
                min={1}
                value={query.page}
                onChange={(event) => updateQueryField("page", event.target.value)}
                disabled={loadingSettings}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-per-page">per_page</Label>
              <Input
                id="freepik-per-page"
                type="number"
                min={1}
                max={100}
                value={query.perPage}
                onChange={(event) => updateQueryField("perPage", event.target.value)}
                disabled={loadingSettings}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="freepik-family-id">family-id</Label>
              <Input
                id="freepik-family-id"
                type="number"
                min={0}
                value={query.familyId}
                onChange={(event) => updateQueryField("familyId", event.target.value)}
                placeholder="0"
                disabled={loadingSettings}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-order">order</Label>
              <Select
                id="freepik-order"
                value={query.order}
                onChange={(event) => updateQueryField("order", event.target.value)}
                disabled={loadingSettings}
              >
                <option value="relevance">relevance</option>
                <option value="recent">recent</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-thumbnail-size">thumbnail_size</Label>
              <Select
                id="freepik-thumbnail-size"
                value={query.thumbnailSize}
                onChange={(event) => updateQueryField("thumbnailSize", event.target.value)}
                disabled={loadingSettings}
              >
                {[
                  { value: "64", label: "64" },
                  { value: "128", label: "128" },
                  { value: "256", label: "256" },
                  { value: "512", label: "512" },
                  { value: "1024", label: "1024" },
                ].map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-selection-count">Selected icons</Label>
              <Input id="freepik-selection-count" value={String(selectedCount)} readOnly />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="freepik-filter-color">filters[color]</Label>
              <Select
                id="freepik-filter-color"
                value={filters.color}
                onChange={(event) => updateFilterField("color", event.target.value)}
                disabled={loadingSettings}
              >
                {optionsForFilter(filters.color, FILTER_SELECT_OPTIONS.color).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-filter-shape">filters[shape]</Label>
              <Select
                id="freepik-filter-shape"
                value={filters.shape}
                onChange={(event) => updateFilterField("shape", event.target.value)}
                disabled={loadingSettings}
              >
                {optionsForFilter(filters.shape, FILTER_SELECT_OPTIONS.shape).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-filter-period">filters[period]</Label>
              <Select
                id="freepik-filter-period"
                value={filters.period}
                onChange={(event) => updateFilterField("period", event.target.value)}
                disabled={loadingSettings}
              >
                {optionsForFilter(filters.period, FILTER_SELECT_OPTIONS.period).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="freepik-filter-free-svg">filters[free_svg]</Label>
              <Select
                id="freepik-filter-free-svg"
                value={filters.freeSvg}
                onChange={(event) => updateFilterField("freeSvg", event.target.value)}
                disabled={loadingSettings}
              >
                {optionsForFilter(filters.freeSvg, FILTER_SELECT_OPTIONS.freeSvg).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="freepik-filter-icon-type">filters[icon_type]</Label>
              <Select
                id="freepik-filter-icon-type"
                value={filters.iconType}
                onChange={(event) => updateFilterField("iconType", event.target.value)}
                disabled={loadingSettings}
              >
                {optionsForFilter(filters.iconType, FILTER_SELECT_OPTIONS.iconType).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSaveSettings} disabled={saving || !canEdit || loadingSettings}>
              {saving ? "Saving..." : "Save settings"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void fetchPreview()} disabled={previewBusy || loadingSettings}>
              {previewBusy ? "Fetching..." : "Fetch preview"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchPreview({ page: Math.max(1, Number(query.page) - 1) })}
              disabled={previewBusy || Number(query.page) <= 1}
            >
              Prev page
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchPreview({ page: Number(query.page) + 1 })}
              disabled={previewBusy || Number(query.page) >= Number(previewPagination.lastPage || 1)}
            >
              Next page
            </Button>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview & Selection</CardTitle>
          <CardSubtitle>
            Select icons from the API response before importing into system Elements.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Total: {previewPagination.total} | Page: {previewPagination.currentPage}/{previewPagination.lastPage} | Per page: {previewPagination.perPage}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={selectAllVisible} disabled={previewItems.length === 0}>
              Select all visible
            </Button>
            <Button type="button" variant="secondary" onClick={clearSelection} disabled={selectedCount === 0}>
              Clear selection
            </Button>
            <Button type="button" onClick={handleImportSelected} disabled={importBusy || selectedCount === 0}>
              {importBusy ? "Importing..." : "Import selected"}
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
              No preview icons yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {previewItems.map((item) => {
                const selected = selectedIds.has(item.id);
                const animated =
                  isAnimatedAssetUrl(item.videoUrl) ||
                  isAnimatedAssetUrl(item.assetUrl) ||
                  isAnimatedAssetUrl(item.thumbnailUrl);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSelected(item.id)}
                    className={`rounded-xl border p-2 text-left transition ${
                      selected ? "border-primary ring-1 ring-primary/20" : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt={item.name || "Freepik icon"}
                        className="h-28 w-full rounded-md object-contain bg-white"
                      />
                      {animated ? (
                        <span className="absolute left-2 top-2 rounded-full bg-[#1f2a39] px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                          Animated
                        </span>
                      ) : null}
                      <input
                        type="checkbox"
                        checked={selected}
                        readOnly
                        className="absolute right-2 top-2 h-4 w-4"
                      />
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold">{item.name || item.slug || item.id}</div>
                    <div className="text-[11px] text-muted-foreground">#{item.id}</div>
                    {item.tags.length > 0 ? (
                      <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.tags.join(", ")}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div role="status" className="text-sm text-muted-foreground">
        {status}
      </div>
    </div>
  );
}
