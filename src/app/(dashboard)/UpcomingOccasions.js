"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";

import Badge from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const PHASE_META = {
  live: { label: "Live now", variant: "success" },
  boost: { label: "Boost active", variant: "success" },
  reminder: { label: "Reminder", variant: "warning" },
  upcoming: { label: "Upcoming", variant: "neutral" },
};

function formatDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function whenLabel(next) {
  if (!next) return "";
  if (next.daysUntil > 1) return `in ${next.daysUntil} days`;
  if (next.daysUntil === 1) return "tomorrow";
  if (next.daysUntil === 0) return "today";
  return "running";
}

// The Overview's reminder: what is coming in the next two months and whether the library
// has anything for it yet. Its own request (not part of /api/admin/stats) so a stats hiccup
// cannot hide it, and so designers — who have no stats — see it too.
export default function UpcomingOccasions() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/occasions/upcoming", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not load occasions.");
      setPayload(body);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load occasions.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = payload?.items || [];
  const horizon = payload?.horizonDays || 60;
  const needing = items.filter((item) => item.needsContent).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} strokeWidth={2.25} className="text-muted-foreground" aria-hidden="true" />
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Upcoming occasions
          </h2>
        </div>
        <a href="/occasions" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Open calendar <ChevronRight size={14} aria-hidden="true" />
        </a>
      </div>
      <Card>
        <CardContent>
          {error ? (
            <p className="text-sm text-muted-foreground">{error}</p>
          ) : !payload ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No occasions in the next {horizon} days.</p>
          ) : (
            <div>
              {needing > 0 ? (
                <p className="mb-3 text-sm">
                  <span className="font-semibold text-amber-700">{needing}</span>{" "}
                  {needing === 1 ? "occasion needs" : "occasions need"} content before it starts.
                </p>
              ) : null}
              <ul className="divide-y divide-[var(--border)]">
                {items.slice(0, 8).map((item) => {
                  const phase = PHASE_META[item.next?.phase] || PHASE_META.upcoming;
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="w-7 text-center text-lg leading-none" aria-hidden="true">
                        {item.emoji || "📅"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate text-sm font-medium">{item.titleEn}</span>
                          <span dir="rtl" className="truncate text-xs text-muted-foreground">
                            {item.titleAr}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(item.next?.startIso)}
                          {item.next?.hijriAr ? <span dir="rtl"> · {item.next.hijriAr}</span> : null}
                          {item.next?.estimated ? " · estimated" : ""}
                          {" · "}
                          {whenLabel(item.next)}
                        </div>
                      </div>
                      <Badge variant={phase.variant}>{phase.label}</Badge>
                      {item.needsContent ? (
                        <Badge variant="warning">Needs content</Badge>
                      ) : (
                        <Badge variant="neutral">{item.itemCount} linked</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
