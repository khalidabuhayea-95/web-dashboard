"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";

import { NAV_BADGE_EVENT } from "@/lib/dashboard/navBadges";
import {
  Download,
  BellRing,
  BarChart3,
  Files,
  Home,
  Inbox,
  Layers,
  Pencil,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Type,
  Users,
} from "lucide-react";

const ICONS = {
  overview: Home,
  templates: Files,
  editor: Pencil,
  settings: SlidersHorizontal,
  mobileSettings: Smartphone,
  users: Users,
  analytics: BarChart3,
  push: BellRing,
  designSystem: Files,
  freepikImport: Download,
  psdImport: Layers,
  fonts: Type,
  categories: Tags,
  contactMessages: Inbox,
};

// How often the sidebar re-checks counts while the tab is visible. Slow enough
// to be free, fast enough that a message sent now shows up shortly after.
const POLL_MS = 30_000;

function isActivePath(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Keeps the server-rendered badge seeds fresh.
 *
 * Refetches on an interval, whenever the tab regains focus, and on every route
 * change — the last one matters because reading a message in the inbox flips it
 * out of "new", and navigating away should drop the count immediately rather
 * than leave a stale number sitting in the sidebar for up to POLL_MS.
 */
function useLiveBadges(navItems, pathname) {
  const seeds = {};
  for (const item of navItems) {
    if (item.countHref) seeds[item.href] = item.badge ?? 0;
  }

  const [counts, setCounts] = useState(seeds);

  // Stable key so the effect only re-subscribes when the polled set changes,
  // not on every render (navItems is a fresh array each time).
  const sources = navItems
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

export default function DashboardNav({ navItems }) {
  const pathname = usePathname();
  const liveCounts = useLiveBadges(navItems, pathname);

  return (
    <nav className="px-3 pb-6" aria-label="Dashboard navigation">
      <ul className="space-y-1.5">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = ICONS[item.icon] || Home;
          const count = item.countHref ? liveCounts[item.href] ?? item.badge ?? 0 : item.badge ?? 0;
          const showBadge = Number.isFinite(count) && count > 0;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "group flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "text-foreground/75 hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={clsx(
                    "h-4 w-4 shrink-0 transition-transform",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span className="truncate">{item.label}</span>
                {showBadge ? (
                  <span
                    className="ml-auto inline-flex min-w-[1.35rem] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[0.68rem] font-bold leading-none text-primary-foreground tabular-nums"
                    aria-label={`${count} ${item.badgeLabel || "new"}`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
