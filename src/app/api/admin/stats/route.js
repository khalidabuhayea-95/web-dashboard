import { NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getImportJobStatusSummary } from "@/lib/tools/importJobsStore.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import prisma from "@/lib/prisma";

const ADMIN_STATS_LIMIT = {
  limit: 60,
  windowMs: 60_000,
};

async function isAuthorized(user) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  return data?.role === "admin";
}

export async function GET(request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    // Import jobs table might not exist in environments where migrations haven't run yet.
  }

  return NextResponse.json({
    totalUsers,
    totalTemplates,
    templatesLast7Days,
    activeEditors,
    importJobs,
  });
}
