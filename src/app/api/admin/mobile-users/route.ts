import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createMobileUser,
  deleteMobileUser,
  listMobileUsers,
  updateMobileUser,
} from "@/lib/mobile/mobileUsers.server";
import { handleApiError, handleValidationError } from "@/lib/api/errors";
import { MOBILE_USER_ROLE_VALUES } from "@/lib/mobile/mobileUserRoles";
import { logger } from "@/lib/logging/logger";

import { requireMobileUsersAdmin } from "./_shared";

export const runtime = "nodejs";

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional().default(""),
  status: z.enum(["all", "active", "banned"]).optional().default("all"),
  role: z.enum(["all", "user", "tester"]).optional().default("all"),
});

const roleField = z.enum(MOBILE_USER_ROLE_VALUES as [string, ...string[]]);

const emailField = z.union([z.string().email("Invalid email address"), z.literal("")]);

const createSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: emailField.optional(),
  emailVerified: z.boolean().optional(),
  role: roleField.optional(),
});

const updateSchema = z.object({
  id: z.string().uuid("Invalid mobile user id"),
  name: z.string().trim().max(120).optional(),
  email: emailField.optional(),
  emailVerified: z.boolean().optional(),
  role: roleField.optional(),
  ban: z.boolean().optional(),
  revokeSessions: z.boolean().optional(),
  // null clears the per-user override (fall back to the global monthly allowance).
  creditAllowance: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireMobileUsersAdmin(request, "list", { limit: 60 });
    if ("error" in auth) return auth.error;

    const parsed = listSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const { page, perPage, search, status, role } = parsed.data;
    const { total, users } = await listMobileUsers({ page, perPage, search, status, role });

    return NextResponse.json({ users, page, perPage, total });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve mobile users");
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireMobileUsersAdmin(request, "create");
    if ("error" in auth) return auth.error;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const user = await createMobileUser(parsed.data);

    logger.info("Mobile user created", {
      mobileUserId: user.id,
      createdBy: auth.session.userId,
    });

    return NextResponse.json({ user });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to create mobile user"
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireMobileUsersAdmin(request, "update");
    if ("error" in auth) return auth.error;

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return handleValidationError(parsed.error.issues);
    }

    const user = await updateMobileUser(parsed.data);

    logger.info("Mobile user updated", {
      mobileUserId: user.id,
      updatedBy: auth.session.userId,
      revokedSessions: Boolean(parsed.data.revokeSessions),
      ban: parsed.data.ban,
      role: parsed.data.role,
    });

    return NextResponse.json({ user });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to update mobile user"
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireMobileUsersAdmin(request, "delete");
    if ("error" in auth) return auth.error;

    const id = String(request.nextUrl.searchParams.get("id") || "").trim();
    if (!id) {
      return handleValidationError([
        { path: ["id"], message: "Mobile user id is required", code: "custom" },
      ]);
    }

    await deleteMobileUser({ id });

    logger.info("Mobile user deleted", {
      mobileUserId: id,
      deletedBy: auth.session.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to delete mobile user"
    );
  }
}
