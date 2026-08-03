import { BetaAnalyticsDataClient } from "@google-analytics/data";

import {
  getAnalyticsCredentials,
  getAnalyticsSettings,
} from "@/lib/settings/analyticsSettings.server";
import { logger } from "@/lib/logging/logger";

// Server-side GA4 reporting for /analytics. Everything the page renders comes
// through here, so no viewer needs a Google session of their own.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// GA4's Data API bills each request against a daily property quota. The page is
// admin-only, so a short server-side cache keeps us far clear of the ceiling
// while still feeling live. Realtime gets its own, much shorter window.
const CACHE_TTL_MS = 5 * 60 * 1000;
const REALTIME_TTL_MS = 15 * 1000;
const cache = new Map();

/** Thrown when the caller needs to act (no key, no access, API disabled). */
export class AnalyticsSetupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AnalyticsSetupError";
    this.code = code;
  }
}

function toNum(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** GA4 returns `date` as YYYYMMDD; the charts want YYYY-MM-DD. */
function normalizeGaDate(value) {
  const raw = String(value || "");
  if (!/^\d{8}$/.test(raw)) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Dense ascending axis of `days` UTC dates ending `endOffset` days back — GA4
 * omits zero-traffic days entirely, which would otherwise render as a chart
 * that silently skips gaps.
 */
function buildDayAxis(days, endOffset = 1) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const axis = [];
  for (let i = days + endOffset - 1; i >= endOffset; i -= 1) {
    axis.push(new Date(todayUtc - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return axis;
}

function metricValues(row) {
  return (row?.metricValues || []).map((m) => toNum(m.value));
}

function dimensionValues(row) {
  return (row?.dimensionValues || []).map((d) => d.value ?? "");
}

function rowsOf(report) {
  return report?.rows || [];
}

/** Percentage change, or null when there is no baseline to compare against. */
function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Merge rows sharing a display name, summing their metrics.
 *
 * GA4 can return several rows whose dimension values all surface as the same
 * label — most visibly "(not set)", which arrives once per distinct underlying
 * value. Rendering those separately shows the reader two identical names with
 * different numbers, so fold them together before they reach the table.
 */
function mergeByName(entries, metricKeys) {
  const merged = new Map();
  for (const entry of entries) {
    const existing = merged.get(entry.name);
    if (!existing) {
      merged.set(entry.name, { ...entry });
      continue;
    }
    for (const key of metricKeys) {
      existing[key] += entry[key];
    }
  }
  return [...merged.values()];
}

/** Map a ranked single-dimension report into named rows, merged and sorted. */
function rankedRows(report, keys) {
  const [primaryKey] = keys;
  return mergeByName(
    rowsOf(report).map((row) => {
      const values = metricValues(row);
      const entry = { name: dimensionValues(row)[0] || "(not set)" };
      keys.forEach((key, index) => {
        entry[key] = values[index] ?? 0;
      });
      return entry;
    }),
    keys,
  ).sort((a, b) => b[primaryKey] - a[primaryKey]);
}

let clientPromise = null;
let clientKey = "";

async function getClient(credentials) {
  // Rebuild only when the credentials actually change; the gRPC client is
  // expensive to construct and holds a connection pool.
  const key = credentials.clientEmail;
  if (clientPromise && clientKey === key) return clientPromise;
  clientKey = key;
  clientPromise = Promise.resolve(
    new BetaAnalyticsDataClient({
      credentials: {
        client_email: credentials.clientEmail,
        // Keys pasted through a form often arrive with escaped newlines.
        private_key: credentials.privateKey.replace(/\\n/g, "\n"),
      },
    }),
  );
  return clientPromise;
}

/** Translate a gRPC failure into actionable setup copy where we can. */
function rethrowSetupError(error, credentials, propertyId) {
  const code = error?.code;
  const detail = String(error?.message || "");

  // GA returns PERMISSION_DENIED for two very different problems, and the fixes
  // live in different consoles — so keep them apart rather than sending
  // everyone to Property access management.
  if (code === 7 && /has not been used in project|is disabled/i.test(detail)) {
    throw new AnalyticsSetupError(
      "The Google Analytics Data API is not enabled for this Google Cloud project. " +
        "Enable analyticsdata.googleapis.com, then retry in a few minutes.",
      "API_DISABLED",
    );
  }
  // 7 = PERMISSION_DENIED, 5 = NOT_FOUND (wrong / inaccessible property).
  if (code === 7 || code === 5) {
    throw new AnalyticsSetupError(
      `${credentials.clientEmail} cannot read GA4 property ${propertyId}. ` +
        "Add it as a Viewer under Admin → Property access management.",
      "NO_ACCESS",
    );
  }
  logger.error("GA4 Data API request failed", { message: detail, code, propertyId });
  throw error;
}

async function resolveContext() {
  const [settings, credentials] = await Promise.all([
    getAnalyticsSettings(),
    getAnalyticsCredentials(),
  ]);
  if (!credentials) {
    throw new AnalyticsSetupError(
      "No service account is configured for the GA4 Data API.",
      "NO_CREDENTIALS",
    );
  }
  return {
    settings,
    credentials,
    property: `properties/${settings.propertyId}`,
    client: await getClient(credentials),
  };
}

// Headline metrics, in the order the batch returns them.
const HEADLINE_METRICS = [
  "activeUsers",
  "newUsers",
  "sessions",
  "screenPageViews",
  "engagedSessions",
  "engagementRate",
  "averageSessionDuration",
  "eventCount",
];

/**
 * Live snapshot of the last 30 minutes, split by platform. Cached briefly and
 * fetched separately from the main summary so the page can poll it without
 * re-running fourteen reports.
 */
export async function fetchRealtimeSnapshot({ force = false } = {}) {
  const cacheKey = "realtime";
  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const { client, property, credentials, settings } = await resolveContext();

  let response;
  let byMinute;
  try {
    [[response], [byMinute]] = await Promise.all([
      client.runRealtimeReport({
        property,
        dimensions: [{ name: "platform" }],
        metrics: [{ name: "activeUsers" }],
      }),
      client.runRealtimeReport({
        property,
        dimensions: [{ name: "minutesAgo" }],
        metrics: [{ name: "activeUsers" }],
        limit: 30,
      }),
    ]);
  } catch (error) {
    rethrowSetupError(error, credentials, settings.propertyId);
  }

  const platforms = rankedRows(response, ["users"]);
  const minuteMap = new Map(
    rowsOf(byMinute).map((row) => [toNum(dimensionValues(row)[0]), metricValues(row)[0] ?? 0]),
  );
  // minutesAgo counts backwards; flip it so the chart reads left-to-right.
  const timeline = Array.from({ length: 30 }, (_, index) => ({
    minutesAgo: 29 - index,
    users: minuteMap.get(29 - index) ?? 0,
  }));

  const value = {
    activeUsers: platforms.reduce((sum, row) => sum + row.users, 0),
    platforms,
    timeline,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, { value, expiresAt: Date.now() + REALTIME_TTL_MS });
  return value;
}

/**
 * Everything the dashboard renders for a given window: headline totals with
 * period-over-period deltas, daily series for the current and previous period,
 * and the ranked breakdowns (pages, streams, geography, tech, acquisition,
 * events, engagement-by-hour).
 */
export async function fetchAnalyticsSummary({ days = 28, force = false } = {}) {
  const windowDays = Math.min(Math.max(Number(days) || 28, 7), 365);
  const cacheKey = `summary:${windowDays}`;

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const { settings, credentials, property, client } = await resolveContext();

  const currentRange = { startDate: `${windowDays}daysAgo`, endDate: "yesterday" };
  const previousRange = {
    startDate: `${windowDays * 2}daysAgo`,
    endDate: `${windowDays + 1}daysAgo`,
  };
  const headlineMetrics = HEADLINE_METRICS.map((name) => ({ name }));

  const timeSeries = (range) => ({
    dateRanges: [range],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "activeUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "newUsers" },
    ],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 400,
  });

  // Ranked breakdown: one dimension, ordered by its leading metric.
  const breakdown = (dimension, metrics, limit = 10) => ({
    dateRanges: [currentRange],
    dimensions: [{ name: dimension }],
    metrics: metrics.map((name) => ({ name })),
    orderBys: [{ metric: { metricName: metrics[0] }, desc: true }],
    limit,
  });

  let batches;
  try {
    // A batch caps at five reports, so this goes out as three concurrent batches.
    batches = await Promise.all([
      client.batchRunReports({
        property,
        requests: [
          { dateRanges: [currentRange], metrics: headlineMetrics },
          { dateRanges: [previousRange], metrics: headlineMetrics },
          timeSeries(currentRange),
          timeSeries(previousRange),
          // unifiedScreenName spans web pages and app screens, so this stays
          // meaningful on a property that mixes both.
          breakdown("unifiedScreenName", ["screenPageViews", "activeUsers"]),
        ],
      }),
      client.batchRunReports({
        property,
        requests: [
          breakdown("streamName", ["activeUsers", "screenPageViews"]),
          breakdown("country", ["activeUsers", "sessions"]),
          breakdown("deviceCategory", ["activeUsers", "sessions"]),
          breakdown("sessionSourceMedium", ["sessions", "activeUsers"]),
          breakdown("eventName", ["eventCount", "activeUsers"], 12),
        ],
      }),
      client.batchRunReports({
        property,
        requests: [
          breakdown("newVsReturning", ["activeUsers", "sessions"], 5),
          breakdown("operatingSystem", ["activeUsers", "sessions"], 8),
          breakdown("appVersion", ["activeUsers", "sessions"], 8),
          breakdown("city", ["activeUsers", "sessions"], 8),
          {
            dateRanges: [currentRange],
            dimensions: [{ name: "dayOfWeek" }, { name: "hour" }],
            metrics: [{ name: "activeUsers" }],
            limit: 200,
          },
        ],
      }),
    ]);
  } catch (error) {
    rethrowSetupError(error, credentials, settings.propertyId);
  }

  const [core, ranked, deep] = batches.map(([res]) => res?.reports || []);
  const [currentTotals, previousTotals, dailyReport, previousDailyReport, pagesReport] = core;
  const [streamsReport, countryReport, deviceReport, sourceReport, eventsReport] = ranked;
  const [returningReport, osReport, appVersionReport, cityReport, hourReport] = deep;

  const cur = metricValues(rowsOf(currentTotals)[0]);
  const prev = metricValues(rowsOf(previousTotals)[0]);
  const totals = {};
  HEADLINE_METRICS.forEach((name, index) => {
    const value = cur[index] ?? 0;
    const baseline = prev[index] ?? 0;
    totals[name] = { value, previous: baseline, changePct: pctChange(value, baseline) };
  });

  const seriesFrom = (report, axis) => {
    const byDate = new Map(
      rowsOf(report).map((row) => {
        const [activeUsers, sessions, screenPageViews, newUsers] = metricValues(row);
        return [
          normalizeGaDate(dimensionValues(row)[0]),
          { activeUsers, sessions, screenPageViews, newUsers },
        ];
      }),
    );
    return axis.map((date) => ({
      date,
      activeUsers: byDate.get(date)?.activeUsers ?? 0,
      sessions: byDate.get(date)?.sessions ?? 0,
      screenPageViews: byDate.get(date)?.screenPageViews ?? 0,
      newUsers: byDate.get(date)?.newUsers ?? 0,
    }));
  };

  const daily = seriesFrom(dailyReport, buildDayAxis(windowDays));
  // Aligned index-for-index with `daily` so the chart can overlay them.
  const previousDaily = seriesFrom(
    previousDailyReport,
    buildDayAxis(windowDays, windowDays + 1),
  );

  // dayOfWeek is "0".."6" (Sunday-first), hour is "00".."23".
  const activityByHour = rowsOf(hourReport).map((row) => {
    const [day, hour] = dimensionValues(row);
    return { day: toNum(day), hour: toNum(hour), users: metricValues(row)[0] ?? 0 };
  });

  const value = {
    propertyId: settings.propertyId,
    credentialSource: credentials.source,
    windowDays,
    totals,
    daily,
    previousDaily,
    topPages: rankedRows(pagesReport, ["views", "users"]),
    streams: rankedRows(streamsReport, ["users", "views"]),
    countries: rankedRows(countryReport, ["users", "sessions"]),
    cities: rankedRows(cityReport, ["users", "sessions"]),
    devices: rankedRows(deviceReport, ["users", "sessions"]),
    operatingSystems: rankedRows(osReport, ["users", "sessions"]),
    appVersions: rankedRows(appVersionReport, ["users", "sessions"]),
    sources: rankedRows(sourceReport, ["sessions", "users"]),
    events: rankedRows(eventsReport, ["count", "users"]),
    newVsReturning: rankedRows(returningReport, ["users", "sessions"]),
    activityByHour,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Drop cached summaries — used after settings change. */
export function clearAnalyticsSummaryCache() {
  cache.clear();
}
