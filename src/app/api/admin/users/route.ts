import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getDashboardSession, Roles } from "@/lib/auth/roles";
import {
  createDashboardInvite,
  deleteDashboardUser,
  listDashboardUsers,
  updateDashboardUser,
} from "@/lib/auth/dashboardUsers.server";
import {
  handleApiError,
  handleForbidden,
  handleUnauthorized,
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

const adminUsersListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

const inviteUserSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const updateUserSchema = z.object({
  id: z.string().min(1, "User id is required"),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  ban: z.boolean().optional(),
});

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

async function requireAdminSession(request: NextRequest, scope: string, config: { limit: number; windowMs: number }) {
  const session = await getDashboardSession();
  if (!session?.userId) {
    return { error: handleUnauthorized() };
  }

  const rateLimited = applyAdminRateLimit(request, session.userId, scope, config);
  if (rateLimited) {
    return { error: rateLimited };
  }

  if (session.role !== Roles.ADMIN) {
    return { error: handleForbidden("Not an admin user") };
  }

  return { session };
}

export async function GET(request: NextRequest) {
  try {
    const authState = await requireAdminSession(request, "list", ADMIN_USERS_READ_LIMIT);
    if (authState.error) return authState.error;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = adminUsersListSchema.safeParse(searchParams);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { page, perPage } = parsed.data;
    const { total, users } = await listDashboardUsers({ page, perPage });

    logger.info("Admin users listed", {
      userId: authState.session.userId,
      page,
      perPage,
      count: users.length,
    });

    return NextResponse.json({
      users,
      page,
      perPage,
      total,
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve users");
  }
}

export async function POST(request: NextRequest) {
  try {
    const authState = await requireAdminSession(request, "create", ADMIN_USERS_WRITE_LIMIT);
    if (authState.error) return authState.error;

    const body = await request.json();
    const parsed = inviteUserSchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { email } = parsed.data;
    const { invite, token, mode, existingUserId } = await createDashboardInvite({
      email,
      createdByUserId: authState.session.userId,
    });

    const inviteUrl = new URL("/register", request.nextUrl.origin);
    inviteUrl.searchParams.set("token", token);

    logger.info("Dashboard invite created", {
      email,
      invitedBy: authState.session.userId,
    });

    return NextResponse.json({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        mode,
        existingUserId,
        expiresAt: invite.expiresAt.toISOString(),
        url: inviteUrl.toString(),
      },
    });
  } catch (error) {
    return handleApiError(error, error instanceof Error ? error.message : "Failed to invite user");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authState = await requireAdminSession(request, "update", ADMIN_USERS_WRITE_LIMIT);
    if (authState.error) return authState.error;

    const body = await request.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const updated = await updateDashboardUser({
      ...parsed.data,
      actingUserId: authState.session.userId,
    });

    logger.info("Dashboard user updated", {
      targetUserId: updated.id,
      updatedBy: authState.session.userId,
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        app_role: updated.role,
        banned_until: updated.bannedUntil?.toISOString() || null,
        created_at: updated.createdAt.toISOString(),
        is_system_admin: updated.isSystemAdmin,
      },
    });
  } catch (error) {
    return handleApiError(error, error instanceof Error ? error.message : "Failed to update user");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authState = await requireAdminSession(request, "delete", ADMIN_USERS_WRITE_LIMIT);
    if (authState.error) return authState.error;

    const id = String(request.nextUrl.searchParams.get("id") || "").trim();
    if (!id) {
      return handleValidationError([
        { path: ["id"], message: "User id is required", code: "custom" },
      ]);
    }

    await deleteDashboardUser({
      id,
      actingUserId: authState.session.userId,
    });

    logger.info("Dashboard user deleted", {
      targetUserId: id,
      deletedBy: authState.session.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, error instanceof Error ? error.message : "Failed to delete user");
  }
}
