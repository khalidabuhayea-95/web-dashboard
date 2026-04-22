"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Download,
  Image as ImageIcon,
  Import,
  Loader2,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import Button from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import FreepikBackgroundImportSection from "./FreepikBackgroundImportSection";

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
  if (
    payload?.details &&
    typeof payload.details === "string" &&
    payload.details !== payload.error
  ) {
    details.push(payload.details);
  }
  return details.length > 0 ? details.join(" ") : fallback;
}

function createStatus(tone, message) {
  return { tone, message };
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
    sourcePayload:
      source.sourcePayload && typeof source.sourcePayload === "object"
        ? source.sourcePayload
        : source,
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

function StatusPill({ tone = "neutral", children }) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-border/70 bg-white/85 text-[color:var(--ds-text-muted)]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.08em] ${toneClasses}`}
    >
      {children}
    </span>
  );
}

function StatusBanner({ status }) {
  if (!status?.message) return null;

  const toneClasses =
    status.tone === "success"
      ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
      : status.tone === "error"
        ? "border-rose-200/80 bg-rose-50 text-rose-700"
        : "border-slate-200/80 bg-white/80 text-[color:var(--ds-text-muted)]";

  return (
    <div
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 text-sm font-medium shadow-sm ${toneClasses}`}
    >
      {status.message}
    </div>
  );
}

function SurfaceCard({ title, description, icon: Icon, children, className = "" }) {
  return (
    <div
      className={`rounded-[24px] border border-border/70 bg-white/85 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur ${className}`}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(59,91,219,0.12),rgba(59,91,219,0.05))] text-[color:var(--ds-primary)]">
          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em] text-[color:var(--ds-text)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-[color:var(--ds-text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function WorkspaceSection({ eyebrow, title, description, icon: Icon, badges, children, footer }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(249,250,253,0.95))] shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
      <div className="border-b border-border/70 px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(59,91,219,0.14),rgba(59,91,219,0.06))] text-[color:var(--ds-primary)] shadow-sm">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--ds-text-muted)]">
                  {eyebrow}
                </p>
                <h2 className="mt-1 text-[1.35rem] font-semibold tracking-[-0.03em] text-[color:var(--ds-text)]">
                  {title}
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-[0.96rem] leading-7 text-[color:var(--ds-text-muted)]">
              {description}
            </p>
          </div>

          {badges?.length ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {badges.map((badge) => (
                <StatusPill key={`${badge.tone}-${badge.label}`} tone={badge.tone}>
                  {badge.label}
                </StatusPill>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-7">{children}</div>
      {footer ? <div className="border-t border-border/70 px-5 py-5 sm:px-7">{footer}</div> : null}
    </section>
  );
}

function FieldBlock({ id, label, description, hint, children }) {
  return (
    <div className="space-y-2.5">
      <Label htmlFor={id}>{label}</Label>
      {description ? (
        <p className="text-sm leading-6 text-[color:var(--ds-text-muted)]">{description}</p>
      ) : null}
      {children}
      {hint ? <p className="field-help">{hint}</p> : null}
    </div>
  );
}

function ActionFooter({ status, canEdit, saving, hasChanges, onSave }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm font-medium text-[color:var(--ds-text)]">
            {hasChanges ? "You have unsaved default-query changes." : "Defaults are synced."}
          </div>
          <p className="text-sm text-[color:var(--ds-text-muted)]">
            {canEdit
              ? "Save defaults to keep future preview and import sessions consistent."
              : "You can review current defaults, but only admins can update them."}
          </p>
        </div>

        <Button
          type="button"
          onClick={onSave}
          disabled={!canEdit || saving}
          className="w-full sm:w-auto"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving..." : "Save defaults"}
        </Button>
      </div>
      <StatusBanner status={status} />
    </div>
  );
}

function PreviewTile({ item, selected, onToggle }) {
  const animated =
    isAnimatedAssetUrl(item.videoUrl) ||
    isAnimatedAssetUrl(item.assetUrl) ||
    isAnimatedAssetUrl(item.thumbnailUrl);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-[22px] border p-3 text-left transition ${
        selected
          ? "border-[color:var(--ds-primary)] bg-[color:var(--ds-primary)]/[0.04] shadow-sm"
          : "border-border/80 bg-white/85 hover:border-[color:var(--ds-primary)]/35 hover:bg-white"
      }`}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbnailUrl}
          alt={item.name || "Freepik icon"}
          className="h-32 w-full rounded-2xl bg-white object-contain"
        />
        {animated ? (
          <span className="absolute left-3 top-3 rounded-full bg-[#1f2a39] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
            Animated
          </span>
        ) : null}
        <input
          type="checkbox"
          checked={selected}
          readOnly
          className="absolute right-3 top-3 h-4 w-4"
        />
      </div>
      <div className="mt-3 space-y-1">
        <div className="truncate text-sm font-semibold text-[color:var(--ds-text)]">
          {item.name || item.slug || item.id}
        </div>
        <div className="text-[11px] text-[color:var(--ds-text-muted)]">#{item.id}</div>
        {item.tags.length > 0 ? (
          <div className="line-clamp-2 text-[11px] leading-5 text-[color:var(--ds-text-muted)]">
            {item.tags.join(", ")}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export default function FreepikImportWorkspaceClient() {
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [baselineQuery, setBaselineQuery] = useState(DEFAULT_QUERY);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [baselineFilters, setBaselineFilters] = useState(DEFAULT_FILTERS);
  const [status, setStatus] = useState(createStatus("neutral", "Loading Freepik defaults..."));
  const [saving, setSaving] = useState(false);

  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [previewPagination, setPreviewPagination] = useState({
    total: 0,
    lastPage: 1,
    perPage: 100,
    currentPage: 1,
  });
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
        const defaults =
          settings?.defaults && typeof settings.defaults === "object" ? settings.defaults : {};
        const nextQuery = {
          term: String(defaults.term || DEFAULT_QUERY.term),
          slug: String(defaults.slug || DEFAULT_QUERY.slug),
          page: Number.isFinite(Number(defaults.page)) ? Number(defaults.page) : DEFAULT_QUERY.page,
          perPage: Number.isFinite(Number(defaults.perPage))
            ? Number(defaults.perPage)
            : DEFAULT_QUERY.perPage,
          familyId: String(defaults.familyId || ""),
          order: normalizeOrder(defaults.order),
          thumbnailSize: String(defaults.thumbnailSize || DEFAULT_QUERY.thumbnailSize),
          acceptLanguage: String(defaults.acceptLanguage || ""),
        };
        const nextFilters = {
          ...DEFAULT_FILTERS,
          ...normalizeFreepikFiltersForForm(defaults.filters || {}),
        };

        setCanEdit(Boolean(payload?.canEdit));
        setQuery(nextQuery);
        setBaselineQuery(nextQuery);
        setFilters(nextFilters);
        setBaselineFilters(nextFilters);
        setStatus(createStatus("neutral", ""));
      } catch (error) {
        if (!mounted) return;
        setStatus(
          createStatus(
            "error",
            error?.message || "We could not load the Freepik defaults."
          )
        );
      } finally {
        if (mounted) setLoadingSettings(false);
      }
    };

    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const hasDefaultChanges = useMemo(
    () =>
      JSON.stringify(query) !== JSON.stringify(baselineQuery) ||
      JSON.stringify(filters) !== JSON.stringify(baselineFilters),
    [baselineFilters, baselineQuery, filters, query]
  );

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return previewItems.filter((item) => selectedIds.has(item.id));
  }, [previewItems, selectedIds]);

  const selectedCount = selectedIds.size;

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
    setStatus(createStatus("neutral", "Saving Freepik defaults..."));
    try {
      const filtersPayload = buildFreepikFiltersPayload(filters);
      const response = await fetch("/api/settings/freepik", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

      setBaselineQuery(query);
      setBaselineFilters(filters);
      setStatus(createStatus("success", "Freepik defaults saved."));
    } catch (error) {
      setStatus(
        createStatus(
          "error",
          error?.message || "We could not save the Freepik defaults."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const fetchPreview = async (override = {}) => {
    setPreviewBusy(true);
    setStatus(createStatus("neutral", "Fetching Freepik icons..."));
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
        perPage: Number.isFinite(Number(pagination.perPage))
          ? Number(pagination.perPage)
          : Number(nextQuery.perPage) || 100,
        currentPage: Number.isFinite(Number(pagination.currentPage))
          ? Number(pagination.currentPage)
          : Number(nextQuery.page) || 1,
      });
      setQuery((current) => ({
        ...current,
        page: Number(nextQuery.page) || 1,
      }));
      setSelectedIds(new Set());
      setStatus(createStatus("success", `Loaded ${items.length} icon(s).`));
    } catch (error) {
      setPreviewItems([]);
      setPreviewPagination({
        total: 0,
        lastPage: 1,
        perPage: Number(query.perPage) || 100,
        currentPage: Number(query.page) || 1,
      });
      setSelectedIds(new Set());
      setStatus(
        createStatus("error", error?.message || "Failed to preview icons.")
      );
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
      setStatus(createStatus("warning", "Select at least one icon before import."));
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

      const result =
        completedJob?.result && typeof completedJob.result === "object"
          ? completedJob.result
          : {};
      setImportResult(result);
      const imported = Number(result.imported || 0);
      const failed = Number(result.failed || 0);
      const requested = Number(result.totalRequested || selectedItems.length);
      const firstError =
        Array.isArray(result.errors) && result.errors.length > 0
          ? String(result.errors[0]?.message || "").trim()
          : "";
      setStatus(
        createStatus(
          firstError ? "warning" : "success",
          firstError
            ? `Import completed. Imported ${imported} / ${requested}. Failed: ${failed}. First error: ${firstError}`
            : `Import completed. Imported ${imported} / ${requested}. Failed: ${failed}.`
        )
      );
    } catch (error) {
      setStatus(
        createStatus("error", error?.message || "Freepik import failed.")
      );
    } finally {
      setImportBusy(false);
      setJobProgress("");
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 sm:px-6 lg:px-8">
      <WorkspaceSection
        eyebrow="Icons"
        title="Search, preview, and import Freepik icons"
        description="Tune search defaults, preview the current query response, and import only the assets you want. The workflow is laid out for quick iteration rather than raw parameter dumping."
        icon={Search}
        badges={[
          { tone: hasDefaultChanges ? "warning" : "success", label: hasDefaultChanges ? "Unsaved defaults" : "Defaults synced" },
          { tone: selectedCount > 0 ? "success" : "neutral", label: `${selectedCount} selected` },
        ]}
        footer={
          <ActionFooter
            status={status}
            canEdit={canEdit}
            saving={saving}
            hasChanges={hasDefaultChanges}
            onSave={handleSaveSettings}
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <SurfaceCard
            icon={WandSparkles}
            title="Search defaults"
            description="Keep the most common icon-search settings ready for faster preview cycles."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FieldBlock
                id="freepik-accept-language"
                label="Accept-Language"
                description="Forward a locale when you want region-specific Freepik search behavior."
              >
                <Input
                  id="freepik-accept-language"
                  value={query.acceptLanguage}
                  onChange={(event) => updateQueryField("acceptLanguage", event.target.value)}
                  placeholder="en-US"
                  disabled={loadingSettings}
                />
              </FieldBlock>
              <FieldBlock
                id="freepik-order"
                label="Ordering"
                description="Switch between relevance and recent when seeding the preview query."
              >
                <Select
                  id="freepik-order"
                  value={query.order}
                  onChange={(event) => updateQueryField("order", event.target.value)}
                  disabled={loadingSettings}
                >
                  <option value="relevance">relevance</option>
                  <option value="recent">recent</option>
                </Select>
              </FieldBlock>
              <FieldBlock
                id="freepik-term"
                label="Search term"
                description="Primary search term used for the next preview request."
              >
                <Input
                  id="freepik-term"
                  value={query.term}
                  onChange={(event) => updateQueryField("term", event.target.value)}
                  placeholder="ramadan"
                  disabled={loadingSettings}
                />
              </FieldBlock>
              <FieldBlock
                id="freepik-slug"
                label="Slug"
                description="Optional direct slug when you already know the exact Freepik item."
              >
                <Input
                  id="freepik-slug"
                  value={query.slug}
                  onChange={(event) => updateQueryField("slug", event.target.value)}
                  placeholder="moon_13643078"
                  disabled={loadingSettings}
                />
              </FieldBlock>
              <FieldBlock
                id="freepik-page"
                label="Page"
                description="Current preview page."
              >
                <Input
                  id="freepik-page"
                  type="number"
                  min={1}
                  value={query.page}
                  onChange={(event) => updateQueryField("page", event.target.value)}
                  disabled={loadingSettings}
                />
              </FieldBlock>
              <FieldBlock
                id="freepik-per-page"
                label="Per page"
                description="Preview size for the icon response."
              >
                <Input
                  id="freepik-per-page"
                  type="number"
                  min={1}
                  max={100}
                  value={query.perPage}
                  onChange={(event) => updateQueryField("perPage", event.target.value)}
                  disabled={loadingSettings}
                />
              </FieldBlock>
              <FieldBlock
                id="freepik-family-id"
                label="Family ID"
                description="Use a family ID when you want to constrain the results to a known set."
              >
                <Input
                  id="freepik-family-id"
                  type="number"
                  min={0}
                  value={query.familyId}
                  onChange={(event) => updateQueryField("familyId", event.target.value)}
                  placeholder="0"
                  disabled={loadingSettings}
                />
              </FieldBlock>
              <FieldBlock
                id="freepik-thumbnail-size"
                label="Thumbnail size"
                description="Preview thumbnail size returned by the upstream API."
              >
                <Select
                  id="freepik-thumbnail-size"
                  value={query.thumbnailSize}
                  onChange={(event) => updateQueryField("thumbnailSize", event.target.value)}
                  disabled={loadingSettings}
                >
                  {["64", "128", "256", "512", "1024"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </FieldBlock>
            </div>
          </SurfaceCard>

          <SurfaceCard
            icon={Sparkles}
            title="Filter tuning"
            description="Shape the visible result set before opening preview and selection."
          >
            <div className="grid gap-4">
              <FieldBlock id="freepik-filter-color" label="Color filter">
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
              </FieldBlock>
              <FieldBlock id="freepik-filter-shape" label="Shape filter">
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
              </FieldBlock>
              <FieldBlock id="freepik-filter-period" label="Period filter">
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
              </FieldBlock>
              <FieldBlock id="freepik-filter-free-svg" label="Free/Premium filter">
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
              </FieldBlock>
              <FieldBlock id="freepik-filter-icon-type" label="Icon type">
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
              </FieldBlock>

              <div className="rounded-[22px] border border-[color:var(--ds-primary)]/12 bg-[linear-gradient(135deg,rgba(59,91,219,0.08),rgba(255,255,255,0.95))] px-4 py-4">
                <div className="text-sm font-semibold text-[color:var(--ds-text)]">
                  Fast workflow
                </div>
                <p className="mt-1 text-sm leading-6 text-[color:var(--ds-text-muted)]">
                  Credentials live in
                  {" "}
                  <a href="/settings" className="font-medium text-[color:var(--ds-primary)] underline-offset-4 hover:underline">
                    Settings
                  </a>
                  . This page focuses on searching, previewing, and importing assets.
                </p>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard
          icon={ImageIcon}
          title="Preview and import queue"
          description="Fetch the current query, curate the visible results, and queue only the icons you actually want to bring into the system."
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void fetchPreview()}
                  disabled={previewBusy || loadingSettings}
                >
                  {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
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
                  disabled={
                    previewBusy || Number(query.page) >= Number(previewPagination.lastPage || 1)
                  }
                >
                  Next page
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={selectAllVisible}
                  disabled={previewItems.length === 0}
                >
                  Select all visible
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={clearSelection}
                  disabled={selectedCount === 0}
                >
                  Clear selection
                </Button>
                <Button
                  type="button"
                  onClick={handleImportSelected}
                  disabled={importBusy || selectedCount === 0}
                >
                  {importBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Import className="h-4 w-4" aria-hidden="true" />}
                  {importBusy ? "Importing..." : "Import selected"}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--ds-text-muted)]">
              <span>
                Total {previewPagination.total} • Page {previewPagination.currentPage}/
                {previewPagination.lastPage} • Per page {previewPagination.perPage}
              </span>
              <span>
                Selected {selectedCount}
              </span>
            </div>

            {jobProgress ? (
              <div className="rounded-2xl border border-border/70 bg-slate-50/80 px-4 py-3 text-sm text-[color:var(--ds-text-muted)]">
                {jobProgress}
              </div>
            ) : null}

            {importResult ? (
              <div className="rounded-2xl border border-border/70 bg-slate-50/80 px-4 py-3 text-sm text-[color:var(--ds-text-muted)]">
                Imported {Number(importResult.imported || 0)} • Failed {Number(importResult.failed || 0)} • Requested {Number(importResult.totalRequested || 0)}
              </div>
            ) : null}

            {previewItems.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-border px-6 py-10 text-sm text-[color:var(--ds-text-muted)]">
                No preview icons yet. Fetch preview to see the current query response.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {previewItems.map((item) => (
                  <PreviewTile
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggle={() => toggleSelected(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </SurfaceCard>
      </WorkspaceSection>

      <WorkspaceSection
        eyebrow="Backgrounds"
        title="Background import"
        description="Use the existing background import workflow from the same page so teams can manage both Freepik asset types from one workspace."
        icon={Download}
        badges={[{ tone: "neutral", label: "Shared import workspace" }]}
      >
        <FreepikBackgroundImportSection
          defaultAcceptLanguage={query.acceptLanguage}
          loadingSettings={loadingSettings}
        />
      </WorkspaceSection>

      <div className="flex flex-wrap gap-3">
        <Button as="a" href="/settings" variant="secondary">
          Open Settings
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button as="a" href="/categories" variant="ghost">
          Open categories
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
