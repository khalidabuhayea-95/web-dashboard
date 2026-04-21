import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwords";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/tokens";
import {
  normalizeDashboardRole,
  normalizeEmail,
  sanitizeDisplayName,
} from "@/lib/auth/utils";
import { createLogger } from "@/lib/logging/logger.js";

const SYSTEM_ADMIN = {
  name: "khalid AbuHayea",
  email: "khalidabuhayea@gmail.com",
  password: "Rtyu$56789",
  role: "admin",
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const logger = createLogger("auth.dashboard-users");

let ensureSystemAdminPromise = null;

export async function ensureLegacyDashboardUsersMigrated({ force = false } = {}) {
  if (force) {
    logger.info("Legacy dashboard-user migration was requested, but legacy auth import has been removed.");
  }

  return {
    legacyCount: 0,
    created: 0,
    updated: 0,
    merged: 0,
    skipped: 0,
  };
}

export function mapDashboardUserForApi(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    app_role: user.role,
    banned_until: user.bannedUntil?.toISOString() || null,
    created_at: user.createdAt.toISOString(),
    is_system_admin: Boolean(user.isSystemAdmin),
  };
}

export async function ensureSystemAdmin() {
  if (ensureSystemAdminPromise) {
    return ensureSystemAdminPromise;
  }

  ensureSystemAdminPromise = (async () => {
    await ensureLegacyDashboardUsersMigrated();
    const normalizedEmail = normalizeEmail(SYSTEM_ADMIN.email);
    const existing = await prisma.dashboardUser.findUnique({
      where: { normalizedEmail },
    });

    if (!existing) {
      const passwordHash = await hashPassword(SYSTEM_ADMIN.password);
      return prisma.dashboardUser.create({
        data: {
          name: SYSTEM_ADMIN.name,
          email: SYSTEM_ADMIN.email,
          normalizedEmail,
          passwordHash,
          role: SYSTEM_ADMIN.role,
          isSystemAdmin: true,
        },
      });
    }

    if (
      existing.role !== "admin" ||
      !existing.isSystemAdmin ||
      existing.name !== SYSTEM_ADMIN.name
    ) {
      return prisma.dashboardUser.update({
        where: { id: existing.id },
        data: {
          name: SYSTEM_ADMIN.name,
          role: "admin",
          isSystemAdmin: true,
        },
      });
    }

    return existing;
  })();

  try {
    return await ensureSystemAdminPromise;
  } finally {
    ensureSystemAdminPromise = null;
  }
}

export async function findDashboardUserByEmail(email) {
  await ensureLegacyDashboardUsersMigrated();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return prisma.dashboardUser.findUnique({
    where: { normalizedEmail },
  });
}

export async function findDashboardUsersByIds(ids = []) {
  await ensureLegacyDashboardUsersMigrated();
  const uniqueIds = Array.from(
    new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) {
    return [];
  }

  return prisma.dashboardUser.findMany({
    where: {
      id: {
        in: uniqueIds,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      normalizedEmail: true,
    },
  });
}

export async function listDashboardUsers({ page = 1, perPage = 20 }) {
  await ensureLegacyDashboardUsersMigrated();
  const skip = Math.max(page - 1, 0) * perPage;
  const [total, users] = await Promise.all([
    prisma.dashboardUser.count(),
    prisma.dashboardUser.findMany({
      orderBy: [{ isSystemAdmin: "desc" }, { createdAt: "asc" }],
      skip,
      take: perPage,
    }),
  ]);

  return {
    total,
    users: users.map(mapDashboardUserForApi),
  };
}

export async function createDashboardInvite({ email, createdByUserId }) {
  await ensureLegacyDashboardUsersMigrated();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const [existingUser] = await Promise.all([
    prisma.dashboardUser.findUnique({ where: { normalizedEmail } }),
    prisma.dashboardInviteToken.updateMany({
      where: {
        normalizedEmail,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        consumedAt: new Date(),
      },
    }),
  ]);

  if (existingUser?.isSystemAdmin) {
    throw new Error("The system admin cannot receive a setup link.");
  }

  const rawToken = createOpaqueToken();
  const tokenHash = hashOpaqueToken(rawToken);
  const invite = await prisma.dashboardInviteToken.create({
    data: {
      email: normalizedEmail,
      normalizedEmail,
      tokenHash,
      role: normalizeDashboardRole(existingUser?.role || "designer"),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdByUserId,
    },
  });

  return {
    invite,
    token: rawToken,
    mode: existingUser ? "setup" : "register",
    existingUserId: existingUser?.id || null,
  };
}

export async function getValidDashboardInvite(rawToken) {
  const tokenHash = hashOpaqueToken(rawToken);
  const invite = await prisma.dashboardInviteToken.findUnique({
    where: { tokenHash },
  });

  if (!invite) return null;
  if (invite.consumedAt) return null;
  if (invite.expiresAt.getTime() <= Date.now()) return null;
  return invite;
}

export async function registerDashboardUserFromInvite({
  token,
  name,
  email,
  password,
}) {
  const invite = await getValidDashboardInvite(token);
  if (!invite) {
    throw new Error("This registration link is invalid or expired.");
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || normalizedEmail !== invite.normalizedEmail) {
    throw new Error("The registration email must match the invited email.");
  }

  const existingUser = await prisma.dashboardUser.findUnique({
    where: { normalizedEmail },
  });
  if (existingUser?.isSystemAdmin) {
    throw new Error("The system admin cannot use a setup link.");
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const nextUser = existingUser
      ? await tx.dashboardUser.update({
          where: { id: existingUser.id },
          data: {
            name: sanitizeDisplayName(name, existingUser.name || normalizedEmail),
            email: normalizedEmail,
            normalizedEmail,
            passwordHash,
            role: normalizeDashboardRole(existingUser.role || invite.role),
            bannedUntil: null,
          },
        })
      : await tx.dashboardUser.create({
          data: {
            name: sanitizeDisplayName(name),
            email: normalizedEmail,
            normalizedEmail,
            passwordHash,
            role: normalizeDashboardRole(invite.role),
          },
        });

    await tx.dashboardInviteToken.update({
      where: { id: invite.id },
      data: { consumedAt: new Date() },
    });

    return nextUser;
  });

  return user;
}

export async function updateDashboardUser({
  id,
  email,
  password,
  ban,
  actingUserId,
}) {
  const user = await prisma.dashboardUser.findUnique({ where: { id } });
  if (!user) {
    throw new Error("User not found.");
  }

  if (user.isSystemAdmin) {
    if (email && normalizeEmail(email) !== user.normalizedEmail) {
      throw new Error("The system admin email cannot be changed.");
    }
    if (password) {
      throw new Error("The system admin password cannot be changed.");
    }
    if (ban === true) {
      throw new Error("The system admin cannot be banned.");
    }
  }

  const data = {};
  if (email) {
    const normalizedEmail = normalizeEmail(email);
    const conflict = await prisma.dashboardUser.findUnique({
      where: { normalizedEmail },
    });
    if (conflict && conflict.id !== user.id) {
      throw new Error("Another dashboard user already uses this email.");
    }
    data.email = normalizedEmail;
    data.normalizedEmail = normalizedEmail;
  }
  if (password) {
    data.passwordHash = await hashPassword(password);
  }
  if (typeof ban === "boolean") {
    data.bannedUntil = ban ? new Date("9999-12-31T23:59:59.000Z") : null;
  }

  if (Object.keys(data).length === 0) {
    return user;
  }

  if (actingUserId && user.id === actingUserId && ban === true) {
    throw new Error("You cannot ban your own account.");
  }

  return prisma.dashboardUser.update({
    where: { id },
    data,
  });
}

export async function deleteDashboardUser({ id, actingUserId }) {
  const user = await prisma.dashboardUser.findUnique({ where: { id } });
  if (!user) {
    throw new Error("User not found.");
  }
  if (user.isSystemAdmin) {
    throw new Error("The system admin cannot be deleted.");
  }
  if (actingUserId && user.id === actingUserId) {
    throw new Error("You cannot delete your own account.");
  }

  await prisma.dashboardUser.delete({
    where: { id },
  });
}
