"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, ImageLightbox, Input, Select, Switch } from "@/components/ui";

// The two raw-SQL catalogs share a row shape, a list endpoint shape and a PATCH
// contract, so one screen drives both and only these three strings differ.
const TABS = [
  {
    key: "elements",
    label: "Elements",
    listUrl: "/api/editor/elements/imported",
    patchUrl: (id) => `/api/admin/elements/${encodeURIComponent(id)}`,
    // Same endpoint the editor uses; it removes the row and its R2 objects.
    deleteUrl: "/api/editor/elements/imported",
    // The elements list defaults to source=freepik; "all" shows everything.
    listSource: "all",
    searchable: true,
    categorized: true,
    categoriesUrl: "/api/settings/element-categories",
  },
  {
    key: "backgrounds",
    label: "Backgrounds",
    listUrl: "/api/editor/backgrounds/imported",
    patchUrl: (id) => `/api/admin/backgrounds/${encodeURIComponent(id)}`,
    deleteUrl: "/api/editor/backgrounds/imported",
    listSource: "all",
    // The backgrounds list endpoint has no text search, so the box is hidden.
    searchable: false,
    categorized: true,
    categoriesUrl: "/api/settings/background-categories",
  },
];

const PAGE_SIZE = 40;

export default function ProAssetsClient() {
  const [tabKey, setTabKey] = useState(TABS[0].key);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingIds, setSavingIds] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [zoomSrc, setZoomSrc] = useState(null);

  const tab = useMemo(() => TABS.find((entry) => entry.key === tabKey) ?? TABS[0], [tabKey]);

  // Elements and backgrounds keep SEPARATE category lists (they share slugs for shared themes,
  // but not the set), so the taxonomy is refetched per tab rather than loaded once.
  useEffect(() => {
    if (!tab.categoriesUrl) {
      setCategories([]);
      return undefined;
    }

    let active = true;
    (async () => {
      try {
        const response = await fetch(tab.categoriesUrl, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active || !response.ok) return;
        setCategories(Array.isArray(payload?.settings) ? payload.settings : []);
      } catch (_error) {
        // A missing taxonomy only costs the filter; the grid still lists everything.
      }
    })();
    return () => {
      active = false;
    };
  }, [tab.categoriesUrl]);

  const categoryLabels = useMemo(() => {
    const map = new Map();
    categories.forEach((item) => {
      const value = String(item?.value || "");
      if (value) map.set(value, String(item?.labelAr || item?.labelEn || value));
    });
    return map;
  }, [categories]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        source: tab.listSource,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (premiumOnly) params.set("premiumOnly", "1");
      if (tab.searchable && query) params.set("query", query);
      if (tab.categorized && categoryFilter) params.set("category", categoryFilter);

      const response = await fetch(`${tab.listUrl}?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load ${tab.label.toLowerCase()} (${response.status}).`);
      }
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setTotal(Number(payload.total) || 0);
      setTotalPages(Math.max(1, Number(payload.totalPages) || 1));
      // Ids from the page we just left would silently widen the next delete.
      setSelectedIds([]);
    } catch (loadError) {
      setError(loadError.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, page, premiumOnly, query, categoryFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Any filter change invalidates the current page number.
  const switchTab = (key) => {
    if (key === tabKey) return;
    setTabKey(key);
    setPage(1);
    setItems([]);
    setSearchInput("");
    setQuery("");
    setSelectedIds([]);
    setCategoryFilter("");
  };

  /**
   * Flips one asset between free and Nayroz Pro. Optimistic — the tile updates
   * at once and reverts if the server rejects it. When the Pro-only filter is on,
   * un-flagging removes the tile from the list, which is the honest result.
   */
  const togglePremium = async (item) => {
    if (!item?.id || savingIds[item.id]) return;
    const nextValue = !item.isPremium;
    setSavingIds((prev) => ({ ...prev, [item.id]: true }));
    setError("");
    setItems((prev) =>
      prev.map((entry) => (entry.id === item.id ? { ...entry, isPremium: nextValue } : entry))
    );
    try {
      const response = await fetch(tab.patchUrl(item.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPremium: nextValue }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Update failed (${response.status}).`);
      }
      if (premiumOnly && !nextValue) {
        setItems((prev) => prev.filter((entry) => entry.id !== item.id));
        setTotal((prev) => Math.max(0, prev - 1));
      }
    } catch (saveError) {
      setItems((prev) =>
        prev.map((entry) => (entry.id === item.id ? { ...entry, isPremium: !nextValue } : entry))
      );
      setError(saveError.message);
    } finally {
      setSavingIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = useMemo(() => items.map((item) => item.id), [items]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const toggleSelected = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
    );
  };

  // Selects the current page only — the list is paginated, so "all" can never mean rows the
  // admin has not seen.
  const toggleSelectAllVisible = (checked) => {
    setSelectedIds(checked ? visibleIds : []);
  };

  /**
   * Deletes the selected assets and the R2 objects behind them (the endpoint drops any object
   * nothing else references). Sequential rather than parallel: each delete runs a reference
   * check, and a burst of them would hit the endpoint's rate limit.
   */
  const deleteSelected = async () => {
    if (deleting || selectedIds.length === 0) return;
    const count = selectedIds.length;
    const noun = count === 1 ? tab.label.toLowerCase().replace(/s$/, "") : tab.label.toLowerCase();
    const confirmed = window.confirm(
      `Delete ${count} ${noun}? This also removes their image files and cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError("");
    const failed = [];
    let deleted = 0;

    for (const id of selectedIds) {
      try {
        const response = await fetch(tab.deleteUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.deleted) {
          throw new Error(payload?.error || `Delete failed (${response.status}).`);
        }
        deleted += 1;
        setItems((prev) => prev.filter((entry) => entry.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
      } catch (deleteError) {
        failed.push(deleteError.message);
      }
    }

    setSelectedIds(failed.length > 0 ? selectedIds.slice(deleted) : []);
    if (failed.length > 0) {
      setError(`Deleted ${deleted} of ${count}. ${failed[0]}`);
    }
    setDeleting(false);
    // The page is now short by however many were removed; refill it from the server.
    fetchItems();
  };

  const proOnThisPage = items.filter((item) => item.isPremium).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Crown className="h-6 w-6 text-primary" aria-hidden="true" />
          Pro assets
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which elements and backgrounds need a Nayroz Pro subscription. Flagged assets stay
          visible to everyone in the app with a crown on them — the paywall only appears when
          someone tries to use one. Fonts are flagged on the Fonts page; templates on Templates.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((entry) => (
          <Button
            key={entry.key}
            variant={entry.key === tabKey ? "primary" : "ghost"}
            onClick={() => switchTab(entry.key)}
          >
            {entry.label}
          </Button>
        ))}

        <Switch
          className="ml-2"
          checked={premiumOnly}
          label="Pro only"
          onChange={(next) => {
            setPremiumOnly(next);
            setPage(1);
          }}
        />

        {tab.categorized ? (
          <Select
            className="ml-2 w-52"
            value={categoryFilter}
            aria-label="Filter by category"
            onChange={(event) => {
              setCategoryFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {categories
              .filter((item) => item?.published !== false)
              .map((item) => (
                <option key={item.value} value={item.value}>
                  {item.labelAr || item.labelEn || item.value}
                </option>
              ))}
          </Select>
        ) : null}

        {tab.searchable ? (
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(searchInput.trim());
              setPage(1);
            }}
          >
            <Input
              type="search"
              value={searchInput}
              placeholder="Search elements…"
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search elements"
            />
            <Button type="submit" variant="ghost">
              Search
            </Button>
          </form>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={allVisibleSelected}
            disabled={loading || deleting || items.length === 0}
            onChange={(event) => toggleSelectAllVisible(event.target.checked)}
            aria-label={`Select all ${tab.label.toLowerCase()} on this page`}
          />
          Select all on this page
        </label>

        {selectedIds.length > 0 ? (
          <>
            <span className="text-sm font-medium">{selectedIds.length} selected</span>
            <Button variant="ghost" disabled={deleting} onClick={() => setSelectedIds([])}>
              Clear
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={deleteSelected}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {deleting ? "Deleting…" : `Delete ${selectedIds.length}`}
            </Button>
          </>
        ) : null}

        <p className="ml-auto text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : `${total.toLocaleString()} ${tab.label.toLowerCase()}${
                categoryFilter ? ` in ${categoryLabels.get(categoryFilter) || categoryFilter}` : ""
              }${premiumOnly ? " flagged Pro" : ""} · ${proOnThisPage} Pro on this page`}
        </p>
      </div>

      {!loading && !items.length ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {premiumOnly
                ? `No ${tab.label.toLowerCase()} are marked Pro yet. Turn off "Pro only" to browse and flag some.`
                : `No ${tab.label.toLowerCase()} found.`}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => {
          const saving = Boolean(savingIds[item.id]);
          const label = item.title || item.titleEn || "Untitled";
          const selected = selectedSet.has(item.id);
          const categoryValue = String(item.categoryValue || "");
          const categoryLabel = categoryLabels.get(categoryValue) || categoryValue;
          return (
            <div
              key={item.id}
              className={`rounded-xl border bg-card p-2.5 ${
                selected ? "border-primary ring-2 ring-primary" : item.isPremium ? "border-primary" : ""
              }`}
            >
              <div className="relative">
                <label className="absolute left-1.5 top-1.5 z-10 flex cursor-pointer rounded bg-background/90 p-1 shadow-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer"
                    checked={selected}
                    disabled={deleting}
                    onChange={() => toggleSelected(item.id)}
                    aria-label={`Select ${label}`}
                  />
                </label>
                <button
                  type="button"
                  className="block w-full cursor-zoom-in"
                  onClick={() => setZoomSrc(item.assetUrl || item.thumbnailUrl)}
                  aria-label={`View ${label} at full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external R2 thumbnail; next/image needs domain config */}
                  <img
                    src={item.thumbnailUrl || item.assetUrl}
                    alt={label}
                    loading="lazy"
                    className="aspect-square w-full rounded-lg bg-white object-contain"
                  />
                </button>
                {item.isPremium ? (
                  <span className="absolute right-1.5 top-1.5">
                    <Badge variant="neutral">Pro</Badge>
                  </span>
                ) : null}
              </div>
              <div className="mt-2 truncate text-xs font-medium" title={label}>
                {label}
              </div>
              {tab.categorized ? (
                <div
                  className="mt-0.5 truncate text-[11px] text-muted-foreground"
                  title={categoryLabel || "Uncategorized"}
                >
                  {categoryLabel || "Uncategorized"}
                </div>
              ) : null}
              <div className="mt-1">
                <Switch
                  checked={Boolean(item.isPremium)}
                  disabled={saving}
                  label={saving ? "…" : item.isPremium ? "Pro" : "Free"}
                  labelClassName="text-xs text-muted-foreground"
                  onChange={() => togglePremium(item)}
                  aria-label={`Require Nayroz Pro for ${label}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <ImageLightbox src={zoomSrc} alt="" zoomable onClose={() => setZoomSrc(null)} />

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1 || loading}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
