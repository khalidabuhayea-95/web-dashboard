import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getImportJobStatusSummary } from "@/lib/tools/importJobsStore.server";
import { getDashboardSession, Roles } from "@/lib/auth/roles";
import { ensureLegacyDashboardUsersMigrated } from "@/lib/auth/dashboardUsers.server";
import prisma from "@/lib/prisma";
import { handleApiError, handleUnauthorized, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

const ADMIN_STATS_LIMIT = {
  limit: 60,
  windowMs: 60_000,
};

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

    logger.info("Admin stats retrieved", {
      userId: session.userId,
    });

    return NextResponse.json({
      totalUsers,
      totalTemplates,
      templatesLast7Days,
      activeEditors,
      importJobs,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve admin stats");
  }
}
