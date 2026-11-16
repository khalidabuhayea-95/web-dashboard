"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";

import { Sparkline, formatNumber } from "./charts";

const AI_USAGE_ENDPOINT = "/api/admin/analytics/ai-usage";

const FEATURE_LABELS = {
  "edit-image": "Edit by prompt",
  "ai-expand": "AI expand",
  upscale: "Upscale",
  "object-removal": "Object removal",
};

// Provider costs run from $0.00052 to tens of dollars — show cents when that is
// exact, more digits when it is not, so a real cost is never rendered as "$0.00".
function formatUsd(value) {
  const amount = Number(value) || 0;
  if (!amount) return "$0.00";
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  const exact = Number(amount.toFixed(6));
  return Number(exact.toFixed(2)) === exact ? `$${exact.toFixed(2)}` : `$${exact}`;
}

function formatMonth(periodKey) {
  if (!periodKey) return "this month";
  const [year, month] = String(periodKey).split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(date.getTime())) return periodKey;
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Bar row carrying both a run count and its cost — the pair is the whole point. */
function UsageList({ rows, emptyLabel }) {
  const entries = rows || [];
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(1, ...entries.map((row) => Number(row.runs) || 0));

  return (
    <ul className="space-y-1.5">
      {entries.map((row, index) => {
        const runs = Number(row.runs) || 0;
        return (
          <li key={`${row.label}-${index}`} className="relative">
            <div
              className="absolute inset-y-0 start-0 rounded-md bg-primary/10"
              style={{ width: `${Math.max(2, (runs / max) * 100)}%` }}
              aria-hidden="true"
            />
            <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm">
              <span className="truncate text-foreground" title={row.label}>
                {row.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="font-medium">{formatNumber(runs)}</span>
                <span className="text-xs text-muted-foreground">runs</span>
                <span className="text-xs font-medium text-foreground">
                  {formatUsd(row.costUsd)}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * AI usage on the analytics screen. Reads our own database rather than GA4, so it
 * keeps working when Google Analytics is not configured — hence its own fetch and
 * its own error state instead of riding on the GA summary.
 */
export default function AiUsageSection() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(AI_USAGE_ENDPOINT, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load AI usage.");
        }
        if (!mounted) return;
        setUsage(payload);
        setError("");
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError?.message || "Failed to load AI usage.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI usage</CardTitle>
          <CardSubtitle>Loading…</CardSubtitle>
        </CardHeader>
      </Card>
    );
  }

  if (error || usage?.available === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI usage</CardTitle>
          <CardSubtitle>
            {error ||
              "Usage data is unavailable — the AI usage table may not be migrated yet."}
          </CardSubtitle>
        </CardHeader>
      </Card>
    );
  }

  const totals = usage?.totals || { runs: 0, credits: 0, costUsd: 0, activeUsers: 0 };
  const trend = usage?.trend || [];
  const costPerUser = totals.activeUsers > 0 ? totals.costUsd / totals.activeUsers : 0;

  const kpis = [
    { label: "AI runs", value: formatNumber(totals.runs), hint: `${formatNumber(totals.credits)} credits` },
    { label: "Provider spend", value: formatUsd(totals.costUsd), hint: "what these runs cost us" },
    { label: "Users using AI", value: formatNumber(totals.activeUsers), hint: "ran at least one action" },
    { label: "Spend per user", value: formatUsd(costPerUser), hint: "average" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">AI usage</h2>
        <p className="text-sm text-muted-foreground">
          First-party data from this app — not Google Analytics. Covers{" "}
          {formatMonth(usage?.periodKey)}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{kpi.value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{kpi.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By feature</CardTitle>
            <CardSubtitle>Which AI tools people actually use, and what they cost.</CardSubtitle>
          </CardHeader>
          <CardContent>
            <UsageList
              rows={(usage?.byFeature || []).map((row) => ({
                label: FEATURE_LABELS[row.feature] || row.feature,
                runs: row.runs,
                costUsd: row.costUsd,
              }))}
              emptyLabel="No AI usage this month."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
            <CardSubtitle>Spend per provider model — ranked by cost.</CardSubtitle>
          </CardHeader>
          <CardContent>
            <UsageList
              rows={(usage?.byModel || []).map((row) => ({
                label: row.model,
                runs: row.runs,
                costUsd: row.costUsd,
              }))}
              emptyLabel="No AI usage this month."
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI runs per day</CardTitle>
          <CardSubtitle>Last 30 days across all AI features.</CardSubtitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI runs in the last 30 days.</p>
          ) : trend.length === 1 ? (
            // Sparkline needs at least two points; state the single day plainly.
            <p className="text-sm text-muted-foreground">
              {formatNumber(trend[0].runs)} runs on {trend[0].day} — the only day with AI
              activity so far.
            </p>
          ) : (
            <div className="space-y-2">
              <Sparkline values={trend.map((point) => point.runs)} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{trend[0]?.day}</span>
                <span>
                  peak {formatNumber(Math.max(...trend.map((point) => point.runs)))} runs/day
                </span>
                <span>{trend[trend.length - 1]?.day}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
