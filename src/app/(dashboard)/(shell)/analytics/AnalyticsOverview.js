"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";

import {
  BarList,
  DonutChart,
  Heatmap,
  Sparkline,
  TrendChart,
  formatDuration,
  formatNumber,
  formatPercent,
} from "./charts";

const SUMMARY_ENDPOINT = "/api/admin/analytics/summary";
const REALTIME_ENDPOINT = "/api/admin/analytics/realtime";
const REALTIME_POLL_MS = 30_000;

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "90 days" },
];

// Headline tiles carry a sparkline; the secondary strip is quality-of-traffic
// context that doesn't need its own trend line.
const PRIMARY_KPIS = [
  { key: "activeUsers", label: "Active users", series: "activeUsers" },
  { key: "sessions", label: "Sessions", series: "sessions" },
  { key: "screenPageViews", label: "Views", series: "screenPageViews" },
  { key: "newUsers", label: "New users", series: "newUsers" },
];

const SECONDARY_KPIS = [
  { key: "engagementRate", label: "Engagement rate", format: (v) => formatPercent(v) },
  { key: "averageSessionDuration", label: "Avg. session", format: formatDuration },
  { key: "engagedSessions", label: "Engaged sessions", format: formatNumber },
  { key: "eventCount", label: "Events", format: formatNumber },
];

const TREND_METRICS = [
  { key: "activeUsers", label: "Active users" },
  { key: "sessions", label: "Sessions" },
  { key: "screenPageViews", label: "Views" },
  { key: "newUsers", label: "New users" },
];

function formatChange(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function ChangeBadge({ changePct }) {
  const change = formatChange(changePct);
  if (!change) return <span className="text-xs text-muted-foreground">No prior period</span>;
  const positive = (changePct ?? 0) >= 0;
  return (
    <span className="text-xs">
      <span className={positive ? "text-primary" : "text-destructive"}>{change}</span>{" "}
      <span className="text-muted-foreground">vs previous</span>
    </span>
  );
}

function Panel({ title, subtitle, children, className = "" }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <CardSubtitle>{subtitle}</CardSubtitle> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function RealtimeStrip({ realtime, error }) {
  const peak = Math.max(1, ...(realtime?.timeline || []).map((point) => point.users));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active right now
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {error ? "—" : formatNumber(realtime?.activeUsers)}
            </div>
          </div>
          <span className="ms-1 text-xs text-muted-foreground">last 30 min</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          {(realtime?.platforms || []).map((platform) => (
            <span key={platform.name} className="text-muted-foreground">
              {platform.name}{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatNumber(platform.users)}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Per-minute bars for the last half hour, oldest on the left. */}
      <div className="mt-3 flex h-8 items-end gap-[2px]">
        {(realtime?.timeline || []).map((point) => (
          <div
            key={point.minutesAgo}
            title={`${point.minutesAgo}m ago — ${formatNumber(point.users)} users`}
            className="flex-1 rounded-sm bg-primary"
            style={{
              height: `${Math.max(6, (point.users / peak) * 100)}%`,
              opacity: point.users ? 0.85 : 0.15,
            }}
          />
        ))}
      </div>

      {error ? <p className="mt-2 text-xs text-muted-foreground">Realtime unavailable: {error}</p> : null}
    </div>
  );
}

export default function AnalyticsOverview() {
  const [days, setDays] = useState(28);
  const [summary, setSummary] = useState(null);
  const [realtime, setRealtime] = useState(null);
  const [realtimeError, setRealtimeError] = useState("");
  const [trendMetric, setTrendMetric] = useState("activeUsers");
  const [loading, setLoading] = useState(true);
  const [setupMessage, setSetupMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (windowDays, signal) => {
    setLoading(true);
    setError("");
    setSetupMessage("");
    try {
      const response = await fetch(`${SUMMARY_ENDPOINT}?days=${windowDays}`, {
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 409 && payload?.setupRequired) {
        setSummary(null);
        setSetupMessage(String(payload.error || "Analytics is not configured yet."));
        return;
      }
      if (!response.ok) {
        throw new Error(String(payload?.error || "Failed to load analytics summary."));
      }
      setSummary(payload?.summary || null);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Failed to load analytics summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(days, controller.signal);
    return () => controller.abort();
  }, [days, load]);

  // Realtime polls on its own cadence — the summary is cached for minutes, this
  // is cached for seconds.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const response = await fetch(REALTIME_ENDPOINT, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setRealtimeError(String(payload?.error || "unavailable"));
          return;
        }
        setRealtime(payload?.realtime || null);
        setRealtimeError("");
      } catch (err) {
        if (err?.name === "AbortError" || !active) return;
        setRealtimeError(err?.message || "unavailable");
      }
    };

    void tick();
    const timer = setInterval(tick, REALTIME_POLL_MS);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  if (setupMessage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live metrics unavailable</CardTitle>
          <CardSubtitle>Google Analytics itself is still reachable via the buttons above.</CardSubtitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{setupMessage}</p>
        </CardContent>
      </Card>
    );
  }

  const daily = summary?.daily || [];
  const activeTrend = TREND_METRICS.find((metric) => metric.key === trendMetric) || TREND_METRICS[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                days === range.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {/* This is the GA query time, not the page load time — responses are
              cached server-side for 5 minutes, so say so rather than implying
              the numbers were fetched just now. */}
          {loading
            ? "Refreshing..."
            : summary?.fetchedAt
              ? `GA data as of ${new Date(summary.fetchedAt).toLocaleTimeString()} · property ${summary.propertyId}`
              : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <RealtimeStrip realtime={realtime} error={realtimeError} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PRIMARY_KPIS.map((kpi) => (
          <div key={kpi.key} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {kpi.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {formatNumber(summary?.totals?.[kpi.key]?.value)}
            </div>
            <div className="mt-1">
              <ChangeBadge changePct={summary?.totals?.[kpi.key]?.changePct} />
            </div>
            <div className="mt-2">
              <Sparkline values={daily.map((point) => point[kpi.series])} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SECONDARY_KPIS.map((kpi) => (
          <div key={kpi.key} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {kpi.label}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">
                {kpi.format(summary?.totals?.[kpi.key]?.value)}
              </span>
              <ChangeBadge changePct={summary?.totals?.[kpi.key]?.changePct} />
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Traffic trend</CardTitle>
              <CardSubtitle>
                Solid line is this period, dashed is the {summary?.windowDays ?? days} days before it.
              </CardSubtitle>
            </div>
            <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
              {TREND_METRICS.map((metric) => (
                <button
                  key={metric.key}
                  type="button"
                  onClick={() => setTrendMetric(metric.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    trendMetric === metric.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TrendChart
            data={daily}
            previous={summary?.previousDaily}
            metricKey={activeTrend.key}
            label={activeTrend.label}
          />
        </CardContent>
      </Card>

      <Panel
        title="When people use it"
        subtitle="Active users by weekday and hour of day, in the property's timezone."
      >
        <Heatmap cells={summary?.activityByHour} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Top pages & screens" subtitle="Most-viewed website pages and in-app screens.">
          <BarList
            rows={summary?.topPages}
            primaryKey="views"
            secondaryKey="users"
            secondaryLabel="users"
            emptyLabel="No page or screen data for this period."
          />
        </Panel>
        <Panel title="Top events" subtitle="What people actually do, by event count.">
          <BarList
            rows={summary?.events}
            primaryKey="count"
            secondaryKey="users"
            secondaryLabel="users"
            emptyLabel="No events recorded for this period."
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Countries" subtitle="Where your users are.">
          <BarList
            rows={summary?.countries}
            primaryKey="users"
            secondaryKey="sessions"
            secondaryLabel="sessions"
            emptyLabel="No country data for this period."
          />
        </Panel>
        <Panel title="Cities" subtitle="Narrower geography for the same window.">
          <BarList
            rows={summary?.cities}
            primaryKey="users"
            secondaryKey="sessions"
            secondaryLabel="sessions"
            emptyLabel="No city data for this period."
          />
        </Panel>
        <Panel title="Acquisition" subtitle="Which source and medium sessions came from.">
          <BarList
            rows={summary?.sources}
            primaryKey="sessions"
            secondaryKey="users"
            secondaryLabel="users"
            emptyLabel="No acquisition data for this period."
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Devices" subtitle="Share of users by device category.">
          <DonutChart rows={summary?.devices} valueKey="users" />
        </Panel>
        <Panel title="Operating systems" subtitle="Platform split across all streams.">
          <BarList
            rows={summary?.operatingSystems}
            primaryKey="users"
            secondaryKey="sessions"
            secondaryLabel="sessions"
            emptyLabel="No OS data for this period."
          />
        </Panel>
        <Panel title="App versions" subtitle="How far the current release has rolled out.">
          <BarList
            rows={summary?.appVersions}
            primaryKey="users"
            secondaryKey="sessions"
            secondaryLabel="sessions"
            emptyLabel="No app version data for this period."
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="By stream" subtitle="Website traffic appears here once nayroz.com is live.">
          <BarList
            rows={summary?.streams}
            primaryKey="users"
            secondaryKey="views"
            secondaryLabel="views"
            emptyLabel="No stream data for this period."
          />
        </Panel>
        <Panel title="New vs returning" subtitle="Share of users by whether they'd been seen before.">
          <DonutChart rows={summary?.newVsReturning} valueKey="users" />
        </Panel>
      </div>
    </div>
  );
}
