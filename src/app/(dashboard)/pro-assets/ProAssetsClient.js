"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Switch } from "@/components/ui";

// The two raw-SQL catalogs share a row shape, a list endpoint shape and a PATCH
// contract, so one screen drives both and only these three strings differ.
const TABS = [
  {
    key: "elements",
    label: "Elements",
    listUrl: "/api/editor/elements/imported",
    patchUrl: (id) => `/api/admin/elements/${encodeURIComponent(id)}`,
    // The elements list defaults to source=freepik; "all" shows everything.
    listSource: "all",
    searchable: true,
  },
  {
    key: "backgrounds",
    label: "Backgrounds",
    listUrl: "/api/editor/backgrounds/imported",
    patchUrl: (id) => `/api/admin/backgrounds/${encodeURIComponent(id)}`,
    listSource: "all",
    // The backgrounds list endpoint has no text search, so the box is hidden.
    searchable: false,
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

  const tab = useMemo(() => TABS.find((entry) => entry.key === tabKey) ?? TABS[0], [tabKey]);

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

      const response = await fetch(`${tab.listUrl}?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load ${tab.label.toLowerCase()} (${response.status}).`);
      }
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setTotal(Number(payload.total) || 0);
      setTotalPages(Math.max(1, Number(payload.totalPages) || 1));
    } catch (loadError) {
      setError(loadError.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, page, premiumOnly, query]);

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

      <p className="text-sm text-muted-foreground">
        {loading
          ? "Loading…"
          : `${total.toLocaleString()} ${tab.label.toLowerCase()}${premiumOnly ? " flagged Pro" : ""} · ${proOnThisPage} Pro on this page`}
      </p>

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
          return (
            <div
              key={item.id}
              className={`rounded-xl border bg-card p-2.5 ${item.isPremium ? "border-primary" : ""}`}
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- external R2 thumbnail; next/image needs domain config */}
                <img
                  src={item.thumbnailUrl || item.assetUrl}
                  alt={label}
                  loading="lazy"
                  className="aspect-square w-full rounded-lg bg-white object-contain"
                />
                {item.isPremium ? (
                  <span className="absolute right-1.5 top-1.5">
                    <Badge variant="neutral">Pro</Badge>
                  </span>
                ) : null}
              </div>
              <div className="mt-2 truncate text-xs font-medium" title={label}>
                {label}
              </div>
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
