import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  handleApiError,
  handleForbidden,
  handleUnauthorized,
  handleBadRequest,
  handleValidationError,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

const ADMIN_USERS_READ_LIMIT = {
  limit: 60,
  windowMs: 60_000,
};
const ADMIN_USERS_WRITE_LIMIT = {
  limit: 30,
  windowMs: 60_000,
};

// Validation schemas
const adminUsersListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

const inviteUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "editor"]).default("editor"),
  redirectTo: z.string().url().optional(),
});

const updateUserSchema = z.object({
  id: z.string().min(1, "User id is required"),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["admin", "editor"]).optional(),
  ban: z.boolean().optional(),
});

const deleteUserSchema = z.object({
  id: z.string().min(1, "User id is required"),
});

function parseAdminEmails(value?: string): string[] | null {
  if (!value) return null;
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function isAuthorized(user: { id: string; email?: string }) {
  const allowEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  const allowDomain = process.env.ADMIN_EMAIL_DOMAIN?.toLowerCase();

  if (!allowEmails && !allowDomain) {
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

  const email = user?.email?.toLowerCase();
  if (!email) return false;

  if (allowEmails?.includes(email)) return true;
  if (allowDomain && email.endsWith(`@${allowDomain}`)) return true;

  return false;
}

function applyAdminRateLimit(
  request: NextRequest,
  userId: string | undefined,
  scope: string,
  config: { limit: number; windowMs: number }
) {
  const rateLimitState = checkRateLimit({
    scope: `api:admin:users:${scope}`,
    identifier: userId || resolveRequestIp(request),
    limit: config.limit,
    windowMs: config.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse(
      "Too many admin user requests. Please retry shortly.",
      rateLimitState
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return handleUnauthorized();
    }

    const readRateLimited = applyAdminRateLimit(
      request,
      data.user.id,
      "list",
      ADMIN_USERS_READ_LIMIT
    );
    if (readRateLimited) return readRateLimited;

    if (!(await isAuthorized(data.user))) {
      return handleForbidden("Not an admin user");
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = adminUsersListSchema.safeParse(searchParams);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { page, perPage } = parsed.data;

    const admin = createAdminClient();
    const { data: usersData, error: listError } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (listError) {
      return handleApiError(listError, "Failed to list users");
    }

    const userIds = usersData.users.map((user: any) => user.id);
    const rolesMap = new Map<string, string>();

    if (userIds.length > 0) {
      const { data: rolesData } = await admin
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds);

      rolesData?.forEach((row: { user_id: string; role: string }) => {
        rolesMap.set(row.user_id, row.role);
      });
    }

    const users = usersData.users.map((user: any) => ({
      ...user,
      app_role: rolesMap.get(user.id) ?? "editor",
    }));

    logger.info("Admin users listed", {
      userId: data.user.id,
      page,
      perPage,
      count: users.length,
    });

    return NextResponse.json({
      users,
      page,
      perPage,
      total: usersData.total,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve users");
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return handleUnauthorized();
    }

    const writeRateLimited = applyAdminRateLimit(
      request,
      data.user.id,
      "create",
      ADMIN_USERS_WRITE_LIMIT
    );
    if (writeRateLimited) return writeRateLimited;

    if (!(await isAuthorized(data.user))) {
      return handleForbidden("Not an admin user");
    }

    const body = await request.json();
    const parsed = inviteUserSchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { email, role, redirectTo } = parsed.data;

    const admin = createAdminClient();
    const { data: invited, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (inviteError) {
      return handleApiError(inviteError, "Failed to invite user");
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
        return handleApiError(roleError, "Failed to set user role");
      }
    }

    logger.info("User invited", {
      email,
      role,
      invitedBy: data.user.id,
    });

    return NextResponse.json({ user: invited?.user ?? null });
  } catch (error) {
    return handleApiError(error, "Failed to invite user");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return handleUnauthorized();
    }

    const writeRateLimited = applyAdminRateLimit(
      request,
      data.user.id,
      "update",
      ADMIN_USERS_WRITE_LIMIT
    );
    if (writeRateLimited) return writeRateLimited;

    if (!(await isAuthorized(data.user))) {
      return handleForbidden("Not an admin user");
    }

    const body = await request.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { id, email, password, role, ban } = parsed.data;

    const admin = createAdminClient();
    const { data: updated, error: updateError } =
      await admin.auth.admin.updateUserById(id, {
        email,
        password,
        ban_duration:
          typeof ban === "boolean" ? (ban ? "876600h" : "none") : undefined,
      });

    if (updateError) {
      return handleApiError(updateError, "Failed to update user");
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
        return handleApiError(roleError, "Failed to update user role");
      }
    }

    logger.info("User updated", {
      userId: id,
      updatedBy: data.user.id,
      fields: Object.keys(parsed.data).filter((k) => k !== "id"),
    });

    return NextResponse.json({ user: updated.user });
  } catch (error) {
    return handleApiError(error, "Failed to update user");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return handleUnauthorized();
    }

    const writeRateLimited = applyAdminRateLimit(
      request,
      data.user.id,
      "delete",
      ADMIN_USERS_WRITE_LIMIT
    );
    if (writeRateLimited) return writeRateLimited;

    if (!(await isAuthorized(data.user))) {
      return handleForbidden("Not an admin user");
    }

    const id = request.nextUrl.searchParams.get("id");
    const parsed = deleteUserSchema.safeParse({ id });
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const admin = createAdminClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(parsed.data.id);

    if (deleteError) {
      return handleApiError(deleteError, "Failed to delete user");
    }

    logger.info("User deleted", {
      userId: parsed.data.id,
      deletedBy: data.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Failed to delete user");
  }
}
