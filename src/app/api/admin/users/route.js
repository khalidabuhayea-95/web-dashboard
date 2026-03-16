import { NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ADMIN_USERS_READ_LIMIT = {
  limit: 60,
  windowMs: 60_000,
};
const ADMIN_USERS_WRITE_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};

function parseAdminEmails(value) {
  if (!value) return null;
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function getUserRole(admin, userId) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data?.role ?? null;
}

async function isAuthorized(user) {
  const allowEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  const allowDomain = process.env.ADMIN_EMAIL_DOMAIN?.toLowerCase();

  if (!allowEmails && !allowDomain) {
    const admin = createAdminClient();
    const role = await getUserRole(admin, user.id);
    return role === "admin";
  }

  const email = user?.email?.toLowerCase();
  if (!email) return false;

  if (allowEmails?.includes(email)) return true;
  if (allowDomain && email.endsWith(`@${allowDomain}`)) return true;

  return false;
}

function applyAdminRateLimit(request, userId, scope, config) {
  const rateLimitState = checkRateLimit({
    scope: `api:admin:users:${scope}`,
    identifier: userId || resolveRequestIp(request),
    limit: config.limit,
    windowMs: config.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse("Too many admin user requests. Please retry shortly.", rateLimitState);
  }
  return null;
}

export async function GET(request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const readRateLimited = applyAdminRateLimit(request, data.user.id, "list", ADMIN_USERS_READ_LIMIT);
  if (readRateLimited) return readRateLimited;

  if (!(await isAuthorized(data.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(Number(searchParams.get("page") || 1), 1);
  const perPage = Math.min(
    Math.max(Number(searchParams.get("perPage") || 20), 1),
    100
  );

  const admin = createAdminClient();
  const { data: usersData, error: listError } = await admin.auth.admin.listUsers(
    {
      page,
      perPage,
    }
  );

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const userIds = usersData.users.map((user) => user.id);
  const rolesMap = new Map();

  if (userIds.length > 0) {
    const { data: rolesData } = await admin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);

    rolesData?.forEach((row) => {
      rolesMap.set(row.user_id, row.role);
    });
  }

  const users = usersData.users.map((user) => ({
    ...user,
    app_role: rolesMap.get(user.id) ?? "editor",
  }));

  return NextResponse.json({
    users,
    page,
    perPage,
    total: usersData.total,
  });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const writeRateLimited = applyAdminRateLimit(request, data.user.id, "create", ADMIN_USERS_WRITE_LIMIT);
  if (writeRateLimited) return writeRateLimited;

  if (!(await isAuthorized(data.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = typeof body?.role === "string" ? body.role : "editor";
  const redirectTo =
    typeof body?.redirectTo === "string" && body.redirectTo.trim().length > 0
      ? body.redirectTo.trim()
      : undefined;

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  if (invited?.user?.id) {
    const { error: roleError } = await admin.from("user_roles").upsert(
      {
        user_id: invited.user.id,
        role,
      },
      { onConflict: "user_id" }
    );

    if (roleError) {
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ user: invited?.user ?? null });
}

export async function PATCH(request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const writeRateLimited = applyAdminRateLimit(request, data.user.id, "update", ADMIN_USERS_WRITE_LIMIT);
  if (writeRateLimited) return writeRateLimited;

  if (!(await isAuthorized(data.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const id = typeof body?.id === "string" ? body.id : "";
  const email = typeof body?.email === "string" ? body.email.trim() : undefined;
  const password =
    typeof body?.password === "string" && body.password.length > 0
      ? body.password
      : undefined;
  const role = typeof body?.role === "string" ? body.role : undefined;
  const ban =
    typeof body?.ban === "boolean" ? body.ban : undefined;

  if (!id) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: updated, error: updateError } =
    await admin.auth.admin.updateUserById(id, {
      email,
      password,
      ban_duration:
        typeof ban === "boolean" ? (ban ? "876600h" : "none") : undefined,
    });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (role) {
    const { error: roleError } = await admin.from("user_roles").upsert(
      {
        user_id: id,
        role,
      },
      { onConflict: "user_id" }
    );

    if (roleError) {
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ user: updated.user });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const writeRateLimited = applyAdminRateLimit(request, data.user.id, "delete", ADMIN_USERS_WRITE_LIMIT);
  if (writeRateLimited) return writeRateLimited;

  if (!(await isAuthorized(data.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: deleteError } = await admin.auth.admin.deleteUser(id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
