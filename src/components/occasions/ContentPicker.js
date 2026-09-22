"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

import { Button, Input, Modal, Select } from "@/components/ui";

/**
 * Which content kinds can be linked to an occasion, in display order. `adminOnly` kinds
 * read an admin-only endpoint (the AI catalog carries prompts), so designers do not get
 * their pickers.
 */
export const ITEM_KIND_META = {
  template: { label: "Templates", single: "template", pickerTitle: "Add templates", search: true },
  "template-category": { label: "Template categories", single: "template category", pickerTitle: "Add template categories" },
  "ai-template": { label: "AI templates", single: "AI template", pickerTitle: "Add AI templates", search: true, adminOnly: true },
  "ai-category": { label: "AI categories", single: "AI category", pickerTitle: "Add AI categories", adminOnly: true },
  element: { label: "Elements", single: "element", pickerTitle: "Add elements", search: true },
  "element-category": { label: "Element categories", single: "element category", pickerTitle: "Add element categories" },
  background: { label: "Backgrounds", single: "background", pickerTitle: "Add backgrounds" },
  "background-category": { label: "Background categories", single: "background category", pickerTitle: "Add background categories" },
};

export const ITEM_KIND_ORDER = Object.keys(ITEM_KIND_META);

const PAGE_SIZE = 40;

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

// Each source has its own search parameter and paging convention (`q`/`perPage`,
// `query`/`pageSize`, none), so the picker talks to them through this adapter table.
async function fetchItems({ kind, query, page, backgroundCategory, aiCatalog }) {
  switch (kind) {
    case "template": {
      const params = new URLSearchParams({ page: String(page), perPage: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      const payload = await readJson(await fetch(`/api/templates?${params}`, { cache: "no-store" }));
      const templates = Array.isArray(payload.templates) ? payload.templates : [];
      return {
        items: templates.map((template) => ({
          itemId: template.id,
          title: template.name,
          subtitle: `${template.status} · ${template.category}/${template.subCategory}`,
          thumbnailUrl: template.thumbnailDataUrl || template.previewPosterUrl || null,
        })),
        totalPages: payload.totalPages || 1,
        total: payload.total ?? templates.length,
      };
    }
    case "element": {
      const params = new URLSearchParams({ source: "all", page: String(page), pageSize: String(PAGE_SIZE) });
      if (query) params.set("query", query);
      const payload = await readJson(await fetch(`/api/editor/elements/imported?${params}`, { cache: "no-store" }));
      const items = Array.isArray(payload.items) ? payload.items : [];
      return {
        items: items.map((item) => ({
          itemId: item.id,
          title: item.title || item.titleEn || item.titleAr || "Element",
          subtitle: item.categoryValue || "",
          thumbnailUrl: item.thumbnailUrl || item.assetUrl || null,
        })),
        totalPages: payload.totalPages || 1,
        total: payload.total ?? items.length,
      };
    }
    case "background": {
      const params = new URLSearchParams({ source: "all", page: String(page), pageSize: String(PAGE_SIZE) });
      if (backgroundCategory) params.set("category", backgroundCategory);
      const payload = await readJson(await fetch(`/api/editor/backgrounds/imported?${params}`, { cache: "no-store" }));
      const items = Array.isArray(payload.items) ? payload.items : [];
      return {
        items: items.map((item) => ({
          itemId: item.id,
          title: item.title || item.titleEn || item.titleAr || "Background",
          subtitle: item.categoryValue || "",
          thumbnailUrl: item.thumbnailUrl || item.assetUrl || null,
        })),
        totalPages: payload.totalPages || 1,
        total: payload.total ?? items.length,
      };
    }
    case "ai-template": {
      // One nested payload, filtered here: the admin catalog has no search parameter.
      const needle = query.trim().toLowerCase();
      const all = aiCatalog || [];
      const items = all.filter(
        (item) =>
          !needle ||
          item.title.toLowerCase().includes(needle) ||
          (item.titleAr || "").includes(query.trim()) ||
          item.slug.includes(needle)
      );
      const start = (page - 1) * PAGE_SIZE;
      return { items: items.slice(start, start + PAGE_SIZE), totalPages: Math.max(1, Math.ceil(items.length / PAGE_SIZE)), total: items.length };
    }
    default:
      return { items: [], totalPages: 1, total: 0 };
  }
}

async function fetchAiCatalog() {
  const payload = await readJson(await fetch("/api/admin/ai-templates", { cache: "no-store" }));
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  return {
    templates: categories.flatMap((category) =>
      (category.templates || []).map((template) => ({
        itemId: template.id,
        slug: template.slug || "",
        title: template.titleEn,
        titleAr: template.titleAr,
        subtitle: `${category.titleEn}${template.published ? "" : " · hidden"}`,
        thumbnailUrl: template.thumbUrl || template.afterUrl || null,
      }))
    ),
    categories: categories.map((category) => ({
      itemId: category.slug,
      label: category.titleEn,
      sublabel: category.titleAr,
      thumbnailUrl: null,
    })),
  };
}

async function fetchOptions(kind) {
  switch (kind) {
    case "template-category": {
      const payload = await readJson(await fetch("/api/settings/template-taxonomy", { cache: "no-store" }));
      const settings = Array.isArray(payload.settings) ? payload.settings : [];
      return settings.flatMap((category) => [
        { itemId: category.value, label: category.labelEn || category.value, sublabel: category.labelAr || "", group: true },
        ...(category.subCategories || []).map((sub) => ({
          itemId: `${category.value}/${sub.value}`,
          label: `${category.labelEn || category.value} › ${sub.labelEn || sub.value}`,
          sublabel: sub.labelAr || "",
        })),
      ]);
    }
    case "element-category":
    case "background-category": {
      const url = kind === "element-category" ? "/api/settings/element-categories" : "/api/settings/background-categories";
      const payload = await readJson(await fetch(url, { cache: "no-store" }));
      const settings = Array.isArray(payload.settings) ? payload.settings : [];
      return settings.map((category) => ({
        itemId: category.value,
        label: category.labelEn || category.value,
        sublabel: category.labelAr || "",
        thumbnailUrl: category.thumbnailUrl || null,
      }));
    }
    case "ai-category":
      return (await fetchAiCatalog()).categories;
    default:
      return [];
  }
}

/**
 * Picks content to link to an occasion. Category kinds show a checkbox list; item kinds a
 * searchable thumbnail grid with paging. Selection is confirmed with one button so a
 * whole batch is a single request. Mount it with a fresh `key` per opening so its state
 * (query, page, selection) starts clean.
 */
export default function ContentPicker({ open, kind, keywords = [], existingIds, role, onClose, onConfirm }) {
  const meta = ITEM_KIND_META[kind] || { label: kind, pickerTitle: "Add content" };
  const isCategoryKind = String(kind || "").endsWith("-category");
  const keywordList = useMemo(() => (Array.isArray(keywords) ? keywords.filter(Boolean) : []), [keywords]);

  const [query, setQuery] = useState(() => (meta.search ? keywordList[0] || "" : ""));
  const [page, setPage] = useState(1);
  const [results, setResults] = useState({ items: [], totalPages: 1, total: 0 });
  const [options, setOptions] = useState([]);
  const [optionFilter, setOptionFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Map());
  const [backgroundCategory, setBackgroundCategory] = useState("");
  const [backgroundCategories, setBackgroundCategories] = useState([]);
  const [aiCatalog, setAiCatalog] = useState(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOptions(await fetchOptions(kind));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const loadBackgroundCategories = useCallback(async () => {
    try {
      const payload = await readJson(await fetch("/api/settings/background-categories", { cache: "no-store" }));
      setBackgroundCategories(Array.isArray(payload.settings) ? payload.settings : []);
    } catch {
      setBackgroundCategories([]);
    }
  }, []);

  const loadAiCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAiCatalog((await fetchAiCatalog()).templates);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPage = useCallback(async () => {
    if (kind === "ai-template" && !aiCatalog) return;
    setLoading(true);
    setError("");
    try {
      setResults(await fetchItems({ kind, query, page, backgroundCategory, aiCatalog }));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [kind, query, page, backgroundCategory, aiCatalog]);

  useEffect(() => {
    if (!open) return;
    if (isCategoryKind) loadOptions();
    else if (kind === "background") loadBackgroundCategories();
    else if (kind === "ai-template") loadAiCatalog();
  }, [open, kind, isCategoryKind, loadOptions, loadBackgroundCategories, loadAiCatalog]);

  useEffect(() => {
    if (!open || isCategoryKind) return undefined;
    // Debounced so typing does not fire a request per keystroke.
    const timer = setTimeout(() => {
      loadPage();
    }, 250);
    return () => clearTimeout(timer);
  }, [open, isCategoryKind, loadPage]);

  const toggle = (item) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.itemId)) next.delete(item.itemId);
      else next.set(item.itemId, item);
      return next;
    });
  };

  const isLinked = (itemId) => Boolean(existingIds && existingIds.has(itemId));
  const filteredOptions = options.filter((option) => {
    const needle = optionFilter.trim().toLowerCase();
    if (!needle) return true;
    return option.label.toLowerCase().includes(needle) || (option.sublabel || "").includes(optionFilter.trim()) || option.itemId.includes(needle);
  });

  if (meta.adminOnly && role !== "admin") return null;

  return (
    <Modal open={open} onClose={onClose} className="flex max-h-[85vh] w-[min(860px,94vw)] flex-col overflow-hidden" backdropClassName="z-[60]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{meta.pickerTitle}</h3>
        <span className="text-xs text-muted-foreground">
          {selected.size} selected{!isCategoryKind && results.total ? ` · ${results.total} found` : ""}
        </span>
      </div>

      {isCategoryKind ? (
        <div className="mt-3 flex items-center gap-2">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input value={optionFilter} onChange={(event) => setOptionFilter(event.target.value)} placeholder="Filter categories" aria-label="Filter categories" />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {meta.search ? (
            <div className="flex items-center gap-2">
              <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search…"
                aria-label="Search"
              />
            </div>
          ) : null}
          {kind === "background" ? (
            <Select
              value={backgroundCategory}
              onChange={(event) => {
                setBackgroundCategory(event.target.value);
                setPage(1);
              }}
              aria-label="Background category"
            >
              <option value="">All categories</option>
              {backgroundCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.labelEn || category.value}
                </option>
              ))}
            </Select>
          ) : null}
          {meta.search && keywordList.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {keywordList.map((keyword) => (
                <button
                  key={keyword}
                  type="button"
                  className={`badge cursor-pointer ${query === keyword ? "badge-success" : ""}`}
                  onClick={() => {
                    setQuery(keyword);
                    setPage(1);
                  }}
                >
                  {keyword}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {loading && (isCategoryKind ? options.length === 0 : results.items.length === 0) ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isCategoryKind ? (
          filteredOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories.</p>
          ) : (
            <ul className="space-y-1">
              {filteredOptions.map((option) => {
                const linked = isLinked(option.itemId);
                const checked = selected.has(option.itemId);
                return (
                  <li key={option.itemId}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--ds-surface-2)] ${
                        linked ? "opacity-60" : ""
                      } ${option.group ? "font-medium" : "pl-6"}`}
                    >
                      <input type="checkbox" checked={linked || checked} disabled={linked} onChange={() => toggle(option)} />
                      {option.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={option.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />
                      ) : null}
                      <span className="flex-1 truncate text-sm">{option.label}</span>
                      {option.sublabel ? (
                        <span dir="rtl" className="truncate text-xs text-muted-foreground">
                          {option.sublabel}
                        </span>
                      ) : null}
                      {linked ? <span className="text-[11px] text-muted-foreground">linked</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )
        ) : results.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing found.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {results.items.map((item) => {
              const linked = isLinked(item.itemId);
              const checked = selected.has(item.itemId);
              return (
                <button
                  key={item.itemId}
                  type="button"
                  disabled={linked}
                  onClick={() => toggle(item)}
                  title={item.title}
                  aria-pressed={checked}
                  className={`group relative overflow-hidden rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-primary ${
                    linked ? "opacity-50" : ""
                  } ${checked ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="aspect-square w-full bg-[var(--ds-surface-2)]">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  {checked || linked ? (
                    <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check size={12} strokeWidth={3} aria-hidden="true" />
                    </span>
                  ) : null}
                  <div className="truncate px-1 pt-1 text-[11px] font-medium">{item.title}</div>
                  <div className="truncate px-1 pb-1 text-[10px] text-muted-foreground">{linked ? "Already linked" : item.subtitle}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
        {!isCategoryKind && results.totalPages > 1 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
              Previous
            </Button>
            <span>
              Page {page} / {results.totalPages}
            </span>
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.min(results.totalPages, value + 1))} disabled={page >= results.totalPages || loading}>
              Next
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(Array.from(selected.values()).map((item) => ({ kind, itemId: item.itemId })))}
            disabled={selected.size === 0}
          >
            Add {selected.size || ""} {selected.size === 1 ? meta.single : meta.label.toLowerCase()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
