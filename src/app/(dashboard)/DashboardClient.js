"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Download,
  FilePlus2,
  Files,
  Layers,
  LibraryBig,
  MailCheck,
  PenTool,
  PieChart,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Tags,
  TrendingUp,
  TriangleAlert,
  Type,
  UserCheck,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import {
  AreaChart,
  CHART_PALETTE,
  ChartCard,
  DonutChart,
  HorizontalBarList,
  Legend,
  StackedBarChart,
  StatCard,
  StatCardSkeleton,
} from "@/components/dashboard/charts";

function fmt(value) {
  return (Number(value) || 0).toLocaleString();
}

function SectionHeader({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={16} strokeWidth={2.25} className="text-muted-foreground" aria-hidden="true" /> : null}
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export default function DashboardClient({ role }) {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/stats");
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || "Failed to load stats.");
      }
      const payload = await response.json();
      setStats(payload);
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Failed to load stats.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (role !== "admin") {
      return;
    }
    loadStats();
  }, [role, loadStats]);

  const charts = stats?.charts;

  const draftTemplates = stats
    ? Math.max((stats.totalTemplates || 0) - (stats.publishedTemplates || 0), 0)
    : 0;
  const publishRatePct = stats?.publishRate?.created7d
    ? Math.round((stats.publishRate.published7d / stats.publishRate.created7d) * 100)
    : null;
  const verifiedPct = stats?.emailVerified?.total
    ? Math.round((stats.emailVerified.verified / stats.emailVerified.total) * 100)
    : null;
  const lookbackCount = stats?.importJobs?.lookbackCount ?? 0;
  const lookbackFailed = stats?.importJobs?.lookbackFailedCount ?? 0;
  const importSuccessPct =
    lookbackCount > 0 ? Math.round(((lookbackCount - lookbackFailed) / lookbackCount) * 100) : null;
  const queueDepth = (stats?.importJobs?.pending ?? 0) + (stats?.importJobs?.running ?? 0);
  const lookbackHours = stats?.importJobs?.lookbackHours ?? 24;

  const acquisitionSeries = [
    { key: "dashboard", label: "Dashboard", color: "var(--chart-1)" },
    { key: "mobile", label: "Mobile", color: "var(--chart-3)" },
  ];
  const verificationSeries = [
    { key: "verified", label: "Verified", color: "var(--chart-1)" },
    { key: "unverified", label: "Unverified", color: "var(--chart-4)" },
  ];
  const importSeries = [
    { key: "succeeded", label: "Succeeded", color: "var(--chart-1)" },
    { key: "failed", label: "Failed", color: "var(--destructive)" },
    { key: "queued", label: "Queued", color: "var(--chart-4)" },
  ];

  const mobileFunnelData = (charts?.mobileVerificationFunnel || []).map((d) => ({
    day: d.day,
    verified: d.verified || 0,
    unverified: Math.max((d.total || 0) - (d.verified || 0), 0),
  }));

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardSubtitle>Overview</CardSubtitle>
              <CardTitle>Workspace pulse</CardTitle>
              <div className="mt-2 text-sm text-muted-foreground">
                {role === "admin"
                  ? "Monitor growth, analytics, and operational health."
                  : "Ship new templates and keep the library current."}
              </div>
            </div>
            {role === "admin" ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span
                      className="absolute inline-flex h-full w-full rounded-full opacity-60"
                      style={{ background: "var(--chart-1)" }}
                    />
                    <span
                      className="relative inline-flex h-2 w-2 rounded-full"
                      style={{ background: "var(--chart-1)" }}
                    />
                  </span>
                  Live
                </span>
                <Button
                  variant="secondary"
                  onClick={loadStats}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5"
                >
                  <RefreshCw size={14} strokeWidth={2.25} className={refreshing ? "animate-spin" : undefined} />
                  Refresh
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button as="a" href="/templates" variant="secondary">
            View templates
          </Button>
          <Button as="a" href="/editor-pro">
            Open Editor
          </Button>
        </CardContent>
      </Card>

      {role === "admin" ? (
        !stats ? (
          status && !refreshing ? (
            <div className="text-sm text-muted-foreground">{status}</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <StatCardSkeleton key={i} />
              ))}
            </div>
          )
        ) : (
          <div className="space-y-7">
            {status ? <div className="text-sm text-destructive">{status}</div> : null}

            {/* Library & content */}
            <section className="space-y-3">
              <SectionHeader icon={LibraryBig} title="Library & content" />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <StatCard icon={Files} accent="var(--chart-3)" label="Total templates" value={fmt(stats.totalTemplates)} />
                <StatCard
                  icon={BadgeCheck}
                  accent="var(--chart-2)"
                  label="Published templates"
                  value={fmt(stats.publishedTemplates)}
                  hint={`${fmt(draftTemplates)} drafts`}
                />
                <StatCard
                  icon={FilePlus2}
                  accent="var(--chart-1)"
                  label="New templates (7d)"
                  value={fmt(stats.templatesLast7Days)}
                  delta={{
                    current: stats.templateMomentum?.thisWeek,
                    previous: stats.templateMomentum?.lastWeek,
                  }}
                  hint="vs prior 7d"
                />
                <StatCard
                  icon={Send}
                  accent="var(--chart-5)"
                  label="Publish rate (7d)"
                  value={publishRatePct === null ? "—" : `${publishRatePct}%`}
                  hint={`${fmt(stats.publishRate?.published7d)} of ${fmt(stats.publishRate?.created7d)} created`}
                />
                <StatCard
                  icon={PenTool}
                  accent="var(--chart-3)"
                  label="Active designers (30d)"
                  value={fmt(stats.activeDesigners30d)}
                  hint="edited in last 30d"
                />
                <StatCard icon={Type} accent="var(--chart-4)" label="Fonts ready" value={fmt(stats.fontsReady)} />
              </div>
            </section>

            {/* People & growth */}
            <section className="space-y-3">
              <SectionHeader icon={UsersRound} title="People & growth" />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <StatCard icon={Users} accent="var(--chart-1)" label="Dashboard users" value={fmt(stats.totalUsers)} />
                <StatCard icon={UserCheck} accent="var(--chart-3)" label="Active editors" value={fmt(stats.activeEditors)} />
                <StatCard icon={Smartphone} accent="var(--chart-2)" label="Mobile users" value={fmt(stats.emailVerified?.total)} />
                <StatCard
                  icon={UserPlus}
                  accent="var(--chart-1)"
                  label="New mobile users (7d)"
                  value={fmt(stats.mobileUsers7d?.thisWeek)}
                  delta={{
                    current: stats.mobileUsers7d?.thisWeek,
                    previous: stats.mobileUsers7d?.lastWeek,
                  }}
                  hint="vs prior 7d"
                />
                <StatCard
                  icon={MailCheck}
                  accent="var(--chart-2)"
                  label="Mobile email verified"
                  value={verifiedPct === null ? "—" : `${verifiedPct}%`}
                  hint={`${fmt(stats.emailVerified?.verified)} verified`}
                />
              </div>
            </section>

            {/* Import pipeline */}
            <section className="space-y-3">
              <SectionHeader icon={Download} title="Import pipeline" hint={`last ${lookbackHours}h`} />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <StatCard icon={Download} accent="var(--chart-3)" label={`Imports (${lookbackHours}h)`} value={fmt(lookbackCount)} />
                <StatCard
                  icon={TriangleAlert}
                  accent={lookbackFailed > 0 ? "var(--destructive)" : "var(--chart-4)"}
                  label={`Failures (${lookbackHours}h)`}
                  value={fmt(lookbackFailed)}
                />
                <StatCard
                  icon={Activity}
                  accent="var(--chart-2)"
                  label="Success rate"
                  value={importSuccessPct === null ? "—" : `${importSuccessPct}%`}
                  hint={`${fmt(lookbackCount)} jobs`}
                />
                <StatCard
                  icon={Layers}
                  accent={stats.importJobsStalled > 0 ? "var(--destructive)" : "var(--chart-4)"}
                  label="Queue"
                  value={fmt(queueDepth)}
                  hint={`${fmt(stats.importJobs?.pending)} pending · ${fmt(stats.importJobs?.running)} running`}
                />
              </div>
            </section>

            {/* Trends */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard icon={TrendingUp} title="Template creation trend" subtitle="New templates per day · last 30d">
                <AreaChart
                  data={charts?.templateCreationTrend}
                  ariaLabel="Template creation trend, new templates per day over the last 30 days"
                />
              </ChartCard>
              <ChartCard
                icon={UsersRound}
                title="User acquisition"
                subtitle="New signups per day · last 30d"
                actions={<Legend series={acquisitionSeries} />}
              >
                <StackedBarChart
                  data={charts?.userAcquisition}
                  series={acquisitionSeries}
                  ariaLabel="User acquisition by day, dashboard vs mobile signups, last 30 days"
                />
              </ChartCard>
            </section>

            {/* Composition & funnel */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ChartCard icon={PieChart} title="Template status">
                <DonutChart
                  data={(charts?.templateStatusBreakdown || []).map((d) => ({
                    label: d.status,
                    count: d.count,
                  }))}
                />
              </ChartCard>
              <ChartCard icon={Tags} title="Top categories" subtitle="By template volume">
                <HorizontalBarList
                  items={(charts?.topCategories || []).map((d) => ({
                    label: d.category,
                    value: d.count,
                  }))}
                  color={CHART_PALETTE}
                  emptyMessage="No templates yet"
                />
              </ChartCard>
              <ChartCard
                icon={ShieldCheck}
                title="Mobile signups vs verified"
                subtitle="Last 30d"
                actions={<Legend series={verificationSeries} />}
              >
                <StackedBarChart
                  data={mobileFunnelData}
                  series={verificationSeries}
                  ariaLabel="Mobile signups versus verified accounts per day, last 30 days"
                />
              </ChartCard>
            </section>

            {/* Operations & library */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard
                icon={Activity}
                title="Import jobs timeline"
                subtitle="Last 7d"
                actions={
                  <div className="flex items-center gap-5 text-right">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Queue</div>
                      <div className="text-sm font-semibold tabular-nums">{fmt(queueDepth)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stalled</div>
                      <div
                        className="text-sm font-semibold tabular-nums"
                        style={{ color: stats.importJobsStalled > 0 ? "var(--destructive)" : undefined }}
                      >
                        {fmt(stats.importJobsStalled)}
                      </div>
                    </div>
                  </div>
                }
              >
                <Legend series={importSeries} />
                <div className="mt-3">
                  <StackedBarChart
                    data={charts?.importJobsTimeline}
                    series={importSeries}
                    ariaLabel="Import jobs by status per day, succeeded, failed and queued, last 7 days"
                  />
                </div>
              </ChartCard>
              <ChartCard icon={Type} title="Font sources" subtitle="Families by origin">
                <HorizontalBarList
                  items={(charts?.fontSources || []).map((d) => ({
                    label: d.source,
                    value: d.count,
                  }))}
                  color="var(--chart-3)"
                  emptyMessage="No fonts yet"
                />
              </ChartCard>
            </section>
          </div>
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent>
              <div className="text-xs text-muted-foreground">Templates</div>
              <div className="mt-2 text-lg font-semibold">
                Keep templates current
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Review existing templates and keep them aligned with brand
                needs.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-xs text-muted-foreground">Editor</div>
              <div className="mt-2 text-lg font-semibold">
                Build new templates
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Use Editor to draft new layouts for your teams.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
