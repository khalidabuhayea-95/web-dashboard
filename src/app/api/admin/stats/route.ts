import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getImportJobStatusSummary } from "@/lib/tools/importJobsStore.server";
import { getMediaUsageStats } from "@/lib/media/credits/index.server";
import { getDashboardSession, Roles } from "@/lib/auth/roles";
import { ensureLegacyDashboardUsersMigrated } from "@/lib/auth/dashboardUsers.server";
import prisma from "@/lib/prisma";
import { handleApiError, handleUnauthorized, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

const ADMIN_STATS_LIMIT = {
  limit: 60,
  windowMs: 60_000,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Coerce a raw SQL aggregate (which may arrive as bigint/string) to a finite number. */
function toNum(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Normalize a Postgres `::date` value (Date | string) to a `YYYY-MM-DD` key. */
function normalizeDay(value: unknown): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
}

/** Build a dense ascending axis of the last `days` UTC dates (oldest first), inclusive of today. */
function buildDayAxis(days: number): string[] {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const axis: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    axis.push(new Date(todayUtc - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return axis;
}

/**
 * Zero-fill a sparse day-bucketed result set against a fixed window so charts
 * render a continuous axis. `fields` lists the numeric columns to carry over.
 */
function zeroFillDays<T extends { day: string }>(
  rows: Array<Record<string, unknown>>,
  days: number,
  fields: string[],
): T[] {
  const byDay = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    byDay.set(normalizeDay(row.day), row);
  }
  return buildDayAxis(days).map((day) => {
    const row = byDay.get(day);
    const filled: Record<string, unknown> = { day };
    for (const field of fields) {
      filled[field] = toNum(row?.[field]);
    }
    return filled as T;
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getDashboardSession();
    if (!session?.userId) {
      return handleUnauthorized();
    }

    const rateLimitState = checkRateLimit({
      scope: "api:admin:stats:read",
      identifier: session.userId || resolveRequestIp(request),
      limit: ADMIN_STATS_LIMIT.limit,
      windowMs: ADMIN_STATS_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse("Too many stats requests. Please retry shortly.", rateLimitState);
    }

    if (session.role !== Roles.ADMIN) {
      return handleForbidden("Not an admin user");
    }

    await ensureLegacyDashboardUsersMigrated();

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalUsers, totalTemplates, templatesLast7Days, activeEditors] = await Promise.all([
      prisma.dashboardUser.count(),
      prisma.template.count(),
      prisma.template.count({
        where: { createdAt: { gte: weekAgo } },
      }),
      prisma.dashboardUser.count({
        where: {
          role: Roles.DESIGNER,
          OR: [{ bannedUntil: null }, { bannedUntil: { lte: new Date() } }],
        },
      }),
    ]);

    let importJobs = {
      total: 0,
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      lookbackCount: 0,
      lookbackFailedCount: 0,
      lookbackHours: 24,
    };

    try {
      importJobs = await getImportJobStatusSummary({ lookbackHours: 24 });
    } catch (_error) {
      logger.warn("Import jobs summary unavailable", {
        userId: session.userId,
      });
      // Import jobs table might not exist in environments where migrations haven't run yet.
    }

    // --- Expanded analytics -------------------------------------------------
    // GROUP A: Prisma + Template/Mobile/Font raw SQL. These hit always-present
    // tables. NOTE: there are no @@map directives in schema.prisma, so Postgres
    // table names are PascalCase and columns camelCase — every identifier in raw
    // SQL must be double-quoted. Every COUNT casts ::int to avoid BigInt
    // serialization errors.
    const [
      templateMomentumRows,
      publishRateRows,
      publishedTemplates,
      mobileMomentumRows,
      emailVerifiedRows,
      activeDesignersRows,
      fontsReady,
      templateCreationRows,
      templateStatusGroups,
      topCategoryGroups,
      dashboardSignupRows,
      mobileSignupRows,
      mobileVerificationRows,
      fontSourceGroups,
    ] = await Promise.all([
      prisma.$queryRaw<Array<{ this_week: number; last_week: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS this_week,
          COUNT(*) FILTER (
            WHERE "createdAt" >= NOW() - INTERVAL '14 days'
              AND "createdAt" < NOW() - INTERVAL '7 days'
          )::int AS last_week
        FROM "Template"
      `,
      prisma.$queryRaw<Array<{ published_7d: number; created_7d: number }>>`
        SELECT
          COUNT(*) FILTER (
            WHERE "publishedAt" IS NOT NULL
              AND "publishedAt" >= NOW() - INTERVAL '7 days'
          )::int AS published_7d,
          COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS created_7d
        FROM "Template"
      `,
      prisma.template.count({ where: { status: "published" } }),
      prisma.$queryRaw<Array<{ this_week: number; last_week: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS this_week,
          COUNT(*) FILTER (
            WHERE "createdAt" >= NOW() - INTERVAL '14 days'
              AND "createdAt" < NOW() - INTERVAL '7 days'
          )::int AS last_week
        FROM "MobileUser"
      `,
      prisma.$queryRaw<Array<{ total: number; verified: number }>>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE "emailVerified" = true)::int AS verified
        FROM "MobileUser"
      `,
      prisma.$queryRaw<Array<{ active_designers: number }>>`
        SELECT COUNT(DISTINCT "actorId")::int AS active_designers
        FROM "TemplateRevision"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
      `,
      prisma.fontFamily.count({ where: { status: "ready" } }),
      prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS count
        FROM "Template"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.template.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.template.groupBy({
        by: ["category"],
        _count: { _all: true },
        orderBy: { _count: { category: "desc" } },
        take: 5,
      }),
      prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS count
        FROM "DashboardUser"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS count
        FROM "MobileUser"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.$queryRaw<Array<{ day: Date; total: number; verified: number }>>`
        SELECT
          date_trunc('day', "createdAt")::date AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE "emailVerified" = true)::int AS verified
        FROM "MobileUser"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.fontFamily.groupBy({
        by: ["source"],
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
      }),
    ]);

    // GROUP B: import_jobs raw SQL — snake_case table that may not exist yet.
    // Guarded independently so a missing table never breaks the rest.
    let importJobsTimeline: Array<{ day: string; succeeded: number; failed: number; queued: number }> =
      [];
    let importJobsStalled = 0;
    try {
      const [timelineRows, stalledRows] = await Promise.all([
        prisma.$queryRaw<
          Array<{ day: Date; succeeded: number; failed: number; queued: number }>
        >`
          SELECT
            date_trunc('day', created_at)::date AS day,
            COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE status IN ('pending', 'running'))::int AS queued
          FROM import_jobs
          WHERE created_at >= NOW() - INTERVAL '7 days'
          GROUP BY 1
          ORDER BY 1 ASC
        `,
        prisma.$queryRaw<Array<{ stalled: number }>>`
          SELECT COUNT(*)::int AS stalled
          FROM import_jobs
          WHERE status = 'running'
            AND updated_at < NOW() - INTERVAL '5 minutes'
        `,
      ]);
      importJobsTimeline = zeroFillDays(timelineRows, 7, ["succeeded", "failed", "queued"]);
      importJobsStalled = toNum(stalledRows?.[0]?.stalled);
    } catch (_error) {
      logger.warn("Import jobs timeline unavailable", { userId: session.userId });
      // Same rationale as the importJobs summary guard above.
    }

    // Merge the two independent signup series on the shared day axis.
    const dashboardByDay = new Map(
      dashboardSignupRows.map((row) => [normalizeDay(row.day), toNum(row.count)]),
    );
    const mobileByDay = new Map(
      mobileSignupRows.map((row) => [normalizeDay(row.day), toNum(row.count)]),
    );
    const userAcquisition = buildDayAxis(30).map((day) => ({
      day,
      dashboard: dashboardByDay.get(day) ?? 0,
      mobile: mobileByDay.get(day) ?? 0,
    }));

    const templateMomentum = {
      thisWeek: toNum(templateMomentumRows?.[0]?.this_week),
      lastWeek: toNum(templateMomentumRows?.[0]?.last_week),
    };
    const mobileUsers7d = {
      thisWeek: toNum(mobileMomentumRows?.[0]?.this_week),
      lastWeek: toNum(mobileMomentumRows?.[0]?.last_week),
    };
    const publishRate = {
      published7d: toNum(publishRateRows?.[0]?.published_7d),
      created7d: toNum(publishRateRows?.[0]?.created_7d),
    };
    const emailVerified = {
      total: toNum(emailVerifiedRows?.[0]?.total),
      verified: toNum(emailVerifiedRows?.[0]?.verified),
    };

    const charts = {
      templateCreationTrend: zeroFillDays(templateCreationRows, 30, ["count"]),
      templateStatusBreakdown: templateStatusGroups
        .map((group) => ({ status: group.status, count: toNum(group._count?._all) }))
        .sort((a, b) => b.count - a.count),
      topCategories: topCategoryGroups.map((group) => ({
        category: group.category,
        count: toNum(group._count?._all),
      })),
      userAcquisition,
      mobileVerificationFunnel: zeroFillDays(mobileVerificationRows, 30, ["total", "verified"]),
      importJobsTimeline,
      fontSources: fontSourceGroups.map((group) => ({
        source: group.source,
        count: toNum(group._count?._all),
      })),
    };

    // Self-contained and fail-soft, so it cannot break the rest of the payload.
    const aiUsage = await getMediaUsageStats({ trendDays: 30 });

    logger.info("Admin stats retrieved", {
      userId: session.userId,
    });

    return NextResponse.json({
      aiUsage,
      totalUsers,
      totalTemplates,
      templatesLast7Days,
      activeEditors,
      importJobs,
      templateMomentum,
      publishRate,
      publishedTemplates,
      mobileUsers7d,
      emailVerified,
      activeDesigners30d: toNum(activeDesignersRows?.[0]?.active_designers),
      fontsReady,
      importJobsStalled,
      charts,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve admin stats");
  }
}
