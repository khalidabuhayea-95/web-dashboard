"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import clsx from "clsx";

import { NAV_BADGE_EVENT } from "@/lib/dashboard/navBadges";
import {
  CreditCard,
  Download,
  BellRing,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  Crown,
  Files,
  FolderOpen,
  Home,
  Images,
  Import,
  Wand2,
  Megaphone,
  Palette,
  Inbox,
  Layers,
  Pencil,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tags,
  Type,
  Users,
  UsersRound,
} from "lucide-react";

const ICONS = {
  overview: Home,
  templates: Files,
  editor: Pencil,
  settings: SlidersHorizontal,
  mobileSettings: Smartphone,
  aiSettings: Settings2,
  users: Users,
  analytics: BarChart3,
  push: BellRing,
  designSystem: Files,
  freepikImport: Download,
  psdImport: Layers,
  fonts: Type,
  categories: Tags,
  occasions: CalendarDays,
  contactMessages: Inbox,
  aiTemplates: Sparkles,
  gallery: Images,
  magicTools: Wand2,
  textEffects: Palette,
  proAssets: Crown,
  subscriptions: CreditCard,
  // Group headers.
  content: FolderOpen,
  import: Import,
  ai: BrainCircuit,
  people: UsersRound,
  engagement: Megaphone,
};

// How often the sidebar re-checks counts while the tab is visible. Slow enough
// to be free, fast enough that a message sent now shows up shortly after.
const POLL_MS = 30_000;

// Which groups the user left open, by group key. Survives a hard refresh. The
// group holding the current page opens on arrival whether or not it is listed
// here — see useOpenGroups.
const OPEN_GROUPS_STORAGE_KEY = "nayroz.dashboardNav.openGroups";

function isActivePath(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isGroup(item) {
  return Array.isArray(item.items);
}

/** Every page in the nav, groups unwrapped — for anything that works per-href. */
function flattenPages(navItems) {
  return navItems.flatMap((item) => (isGroup(item) ? item.items : [item]));
}

function writeStoredOpenGroups(keys) {
  try {
    window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Private mode or a full quota: the sidebar still works, it just forgets.
  }
}

/**
 * Keeps the server-rendered badge seeds fresh.
 *
 * Refetches on an interval, whenever the tab regains focus, and on every route
 * change — the last one matters because reading a message in the inbox flips it
 * out of "new", and navigating away should drop the count immediately rather
 * than leave a stale number sitting in the sidebar for up to POLL_MS.
 */
function useLiveBadges(pages, pathname) {
  const seeds = {};
  for (const item of pages) {
    if (item.countHref) seeds[item.href] = item.badge ?? 0;
  }

  const [counts, setCounts] = useState(seeds);

  // Stable key so the effect only re-subscribes when the polled set changes,
  // not on every render (pages is a fresh array each time).
  const sources = pages
    .filter((item) => item.countHref)
    .map((item) => `${item.href}|${item.countHref}|${item.countKey || "new"}`)
    .join(",");

  useEffect(() => {
    if (!sources) return undefined;

    const entries = sources.split(",").map((source) => {
      const [href, countHref, countKey] = source.split("|");
      return { href, countHref, countKey };
    });

    let cancelled = false;
    const controllers = new Set();

    async function refresh() {
      if (document.visibilityState === "hidden") return;

      await Promise.all(
        entries.map(async ({ href, countHref, countKey }) => {
          const controller = new AbortController();
          controllers.add(controller);
          try {
            const response = await fetch(countHref, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) return;
            const payload = await response.json();
            const next = Number(payload?.counts?.[countKey]);
            if (cancelled || !Number.isFinite(next)) return;
            setCounts((prev) => (prev[href] === next ? prev : { ...prev, [href]: next }));
          } catch {
            // Offline, aborted, or a transient 5xx — keep the last known count.
          } finally {
            controllers.delete(controller);
          }
        })
      );
    }

    // A page that just changed the underlying data hands us the new counts
    // directly, so the badge moves in the same tick rather than on the next poll.
    function onPublished(event) {
      const { href, counts } = event.detail || {};
      const target = entries.find((entry) => entry.href === href);
      if (!target) return;
      const next = Number(counts?.[target.countKey]);
      if (!Number.isFinite(next)) return;
      setCounts((prev) => (prev[href] === next ? prev : { ...prev, [href]: next }));
    }

    refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(NAV_BADGE_EVENT, onPublished);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(NAV_BADGE_EVENT, onPublished);
      for (const controller of controllers) controller.abort();
    };
  }, [sources, pathname]);

  return counts;
}

// localStorage is the store for "which groups are open"; this is the change
// signal for it. The browser's own `storage` event only fires in OTHER tabs.
const OPEN_GROUPS_CHANGE_EVENT = "nayroz:dashboard-nav-open-groups";

function subscribeOpenGroups(onChange) {
  window.addEventListener(OPEN_GROUPS_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(OPEN_GROUPS_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Snapshots are compared by value, so the raw string is the cheapest stable
// snapshot; parse it once per change, not once per render.
function getOpenGroupsSnapshot() {
  try {
    return window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function getOpenGroupsServerSnapshot() {
  return "[]";
}

/**
 * Which groups are open.
 *
 * Two sources, never in conflict: what the user left open last time (read
 * straight from localStorage through useSyncExternalStore, so the server
 * renders "nothing remembered" and the client corrects itself without a
 * hydration mismatch and without an effect), and the group that holds the
 * current page, which is open on arrival regardless. Closing the current
 * page's group is allowed — that choice lives in plain state and is forgotten
 * the moment the route moves into a different group, so navigation always
 * reveals where you are.
 */
function useOpenGroups(navItems, pathname) {
  const activeGroupKey =
    navItems.find(
      (item) => isGroup(item) && item.items.some((page) => isActivePath(pathname, page.href))
    )?.key ?? null;

  const storedRaw = useSyncExternalStore(
    subscribeOpenGroups,
    getOpenGroupsSnapshot,
    getOpenGroupsServerSnapshot
  );
  const stored = useMemo(() => {
    try {
      const parsed = JSON.parse(storedRaw);
      return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
    } catch {
      return [];
    }
  }, [storedRaw]);

  // The one exception to "active group is open": the user closed it by hand.
  // Keyed by group so it self-expires when the active group changes.
  const [closedActiveKey, setClosedActiveKey] = useState(null);

  const isOpen = (key) =>
    key === activeGroupKey ? closedActiveKey !== key : stored.includes(key);

  function toggle(key) {
    const next = isOpen(key) ? stored.filter((k) => k !== key) : [...new Set([...stored, key])];
    writeStoredOpenGroups(next);
    window.dispatchEvent(new Event(OPEN_GROUPS_CHANGE_EVENT));
    if (key === activeGroupKey) {
      setClosedActiveKey((prev) => (prev === key ? null : key));
    }
  }

  return { isOpen, activeGroupKey, toggle };
}

function Badge({ count, label }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-[1.35rem] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[0.68rem] font-semibold leading-none text-primary-foreground tabular-nums"
      aria-label={`${count} ${label || "new"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function PageRow({ item, active, count, nested }) {
  const Icon = ICONS[item.icon] || Home;
  return (
    // Active row lifts off the sidebar as a white pill — the reference marks
    // selection with a surface, not a tint or a rule.
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group flex items-center gap-3 rounded-2xl py-2.5 text-sm transition-colors",
        nested ? "pl-3 pr-3.5" : "px-3.5",
        active
          ? "bg-[var(--ds-surface)] font-medium text-[var(--ds-text)] shadow-[var(--ds-shadow-sm)]"
          : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={active ? 2.25 : 2}
        className={clsx(
          "shrink-0",
          nested ? "h-4 w-4" : "h-[18px] w-[18px]",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
        )}
      />
      <span className="truncate">{item.label}</span>
      <Badge count={count} label={item.badgeLabel} />
    </Link>
  );
}

function GroupRow({ group, open, holdsActive, collapsedBadge, onToggle, children }) {
  const Icon = ICONS[group.icon] || Home;
  const panelId = `nav-group-${group.key}`;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={clsx(
          "group flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm transition-colors",
          // A closed group that holds the current page keeps a hint of the
          // selection so the user can still tell where they are.
          holdsActive && !open
            ? "font-medium text-[var(--ds-text)]"
            : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <Icon
          aria-hidden="true"
          strokeWidth={holdsActive ? 2.25 : 2}
          className={clsx(
            "h-[18px] w-[18px] shrink-0",
            holdsActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
          )}
        />
        <span className="truncate">{group.label}</span>
        {/* While closed, the children's badges roll up here so an unread count
            is never hidden behind a collapsed header. */}
        {!open ? <Badge count={collapsedBadge} label="new" /> : null}
        <ChevronDown
          aria-hidden="true"
          className={clsx(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open ? "rotate-180" : "rotate-0",
            open || collapsedBadge > 0 ? "" : "ml-auto"
          )}
        />
      </button>

      {/* 0fr → 1fr is the height animation that needs no measuring: the inner
          box is allowed to shrink to nothing, so the row track does the work. */}
      <div
        id={panelId}
        className={clsx(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-border/60 pl-2">
            {children}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function DashboardNav({ navItems }) {
  const pathname = usePathname();
  const pages = flattenPages(navItems);
  const liveCounts = useLiveBadges(pages, pathname);
  const { isOpen, activeGroupKey, toggle } = useOpenGroups(navItems, pathname);

  const countFor = (item) =>
    item.countHref ? liveCounts[item.href] ?? item.badge ?? 0 : item.badge ?? 0;

  return (
    <nav className="px-3 pb-6" aria-label="Dashboard navigation">
      <div className="px-3.5 pb-2 text-xs font-medium text-muted-foreground">General</div>
      <ul className="space-y-0.5">
        {navItems.map((item) => {
          if (!isGroup(item)) {
            return (
              <li key={item.href}>
                <PageRow
                  item={item}
                  active={isActivePath(pathname, item.href)}
                  count={countFor(item)}
                />
              </li>
            );
          }

          const open = isOpen(item.key);
          const collapsedBadge = item.items.reduce((sum, page) => sum + countFor(page), 0);

          return (
            <li key={item.key}>
              <GroupRow
                group={item}
                open={open}
                holdsActive={activeGroupKey === item.key}
                collapsedBadge={collapsedBadge}
                onToggle={() => toggle(item.key)}
              >
                {item.items.map((page) => (
                  <li key={page.href}>
                    <PageRow
                      item={page}
                      active={isActivePath(pathname, page.href)}
                      count={countFor(page)}
                      nested
                    />
                  </li>
                ))}
              </GroupRow>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
