import { NextRequest, NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getImportJobStatusSummary } from "@/lib/tools/importJobsStore.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import prisma from "@/lib/prisma";
import { handleApiError, handleUnauthorized, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

const ADMIN_STATS_LIMIT = {
  limit: 60,
  windowMs: 60_000,
};

async function isAuthorized(user: { id: string }): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    return data?.role === "admin";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return handleUnauthorized();
    }

    const rateLimitState = checkRateLimit({
      scope: "api:admin:stats:read",
      identifier: data.user.id || resolveRequestIp(request),
      limit: ADMIN_STATS_LIMIT.limit,
      windowMs: ADMIN_STATS_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse("Too many stats requests. Please retry shortly.", rateLimitState);
    }

    if (!(await isAuthorized(data.user))) {
      return handleForbidden("Not an admin user");
    }

    const admin = createAdminClient();
    const { data: usersData } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    const totalUsers = usersData?.total ?? 0;
    const totalTemplates = await prisma.template.count();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const templatesLast7Days = await prisma.template.count({
      where: { createdAt: { gte: weekAgo } },
    });

    const { data: editorRoles } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "editor");

    const activeEditors = editorRoles?.length ?? 0;
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
        userId: data.user.id,
      });
      // Import jobs table might not exist in environments where migrations haven't run yet.
    }

    logger.info("Admin stats retrieved", {
      userId: data.user.id,
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
