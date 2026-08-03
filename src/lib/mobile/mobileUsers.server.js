import prisma from "@/lib/prisma";
import { normalizeEmail, sanitizeDisplayName } from "@/lib/auth/utils";
import { INDEFINITE_BAN_UNTIL, isMobileUserBanned } from "@/lib/mobile/mobileUserBan";
import { normalizeMobileUserRole } from "@/lib/mobile/mobileUserRoles";
import { resolveMonthlyAllowance, resolvePeriodKey } from "@/lib/media/credits/config.js";
import { getMobileAppSettings } from "@/lib/settings/mobileAppSettings.server";

// Admin-side CRUD for mobile app accounts (MobileUser + its identities,
// sessions, devices and favorites). Mobile accounts are normally created by a
// social sign-in (see lib/mobile/userAuth.server.js); everything here is the
// dashboard's manual counterpart to that flow.

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

export function mapMobileUserForApi(user, extras = {}) {
  const hasOwnAllowance = user.creditAllowance !== null && user.creditAllowance !== undefined;
  // The wallet is only reportable when the caller actually read it. Without the
  // spend figure, even a user with their own allowance would show a full balance
  // that is not real — so omit `credits` rather than guess.
  const walletReadable =
    extras.defaultCreditAllowance !== null && extras.defaultCreditAllowance !== undefined;
  const creditAllowance = hasOwnAllowance
    ? Number(user.creditAllowance)
    : Number(extras.defaultCreditAllowance || 0);
  const creditsUsed = Number(extras.creditsUsed || 0);

  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    emailVerified: Boolean(user.emailVerified),
    role: normalizeMobileUserRole(user.role),
    banned: isMobileUserBanned(user),
    bannedUntil: toIso(user.bannedUntil),
    // null = this account uses the global monthly allowance from app settings.
    creditAllowance: user.creditAllowance ?? null,
    // This month's AI wallet, or null when it could not be read. `custom` marks an
    // account with its own allowance so the dashboard can flag it instead of it
    // looking like a data error.
    credits: walletReadable
      ? {
          allowance: creditAllowance,
          used: creditsUsed,
          remaining: Math.max(0, creditAllowance - creditsUsed),
          custom: hasOwnAllowance,
        }
      : null,
    lastLoginAt: toIso(user.lastLoginAt),
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
    providers: extras.providers || [],
    deviceCount: extras.deviceCount || 0,
    sessionCount: extras.sessionCount || 0,
    favoriteCount: extras.favoriteCount || 0,
  };
}

// Reject a second account on the same address. `normalizedEmail` is only
// indexed (not unique) in the schema because social sign-ins may legitimately
// arrive without one, so uniqueness is enforced here instead.
async function assertEmailAvailable(normalizedEmail, exceptUserId) {
  if (!normalizedEmail) return;
  const conflict = await prisma.mobileUser.findFirst({
    where: {
      normalizedEmail,
      ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  if (conflict) {
    throw httpError("Another mobile user already uses this email.", 409);
  }
}

function buildSearchWhere(search) {
  const term = String(search || "").trim();
  if (!term) return {};

  const or = [
    { name: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
  ];
  // Let admins paste a user id straight from logs or a push campaign.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term)) {
    or.push({ id: term });
  }

  return { OR: or };
}

// "active" covers both a null ban and one that has already run out, matching
// isMobileUserBanned().
function buildStatusWhere(status) {
  const now = new Date();
  if (status === "banned") return { bannedUntil: { gt: now } };
  if (status === "active") {
    return { OR: [{ bannedUntil: null }, { bannedUntil: { lte: now } }] };
  }
  return {};
}

/**
 * This month's credit spend per user, plus the global default allowance.
 *
 * Deliberately fail-soft: the credit wallet is supplementary information on the
 * users page, so a missing MediaUsage table (migration not yet applied, or a dev
 * server still holding a Prisma client generated before it existed) must not take
 * the whole user list down. Callers get no balances and the UI renders a dash.
 */
async function collectCreditUsage(ids, now) {
  try {
    const [creditSpend, settings] = await Promise.all([
      prisma.mediaUsage.groupBy({
        by: ["mobileUserId"],
        where: { mobileUserId: { in: ids }, periodKey: resolvePeriodKey(now) },
        _sum: { credits: true },
      }),
      getMobileAppSettings(),
    ]);

    return {
      usedByUser: new Map(
        creditSpend.map((row) => [row.mobileUserId, Number(row._sum.credits || 0)])
      ),
      defaultAllowance: resolveMonthlyAllowance(settings),
      available: true,
    };
  } catch (error) {
    console.error("Failed to read AI credit usage for the user list", error);
    return { usedByUser: new Map(), defaultAllowance: null, available: false };
  }
}

async function collectUserExtras(ids) {
  if (ids.length === 0) {
    return new Map();
  }

  const now = new Date();
  // One grouped query for the whole page rather than a balance lookup per row.
  const [identities, devices, sessions, favorites, credits] = await Promise.all([
    prisma.mobileIdentity.findMany({
      where: { mobileUserId: { in: ids } },
      select: { mobileUserId: true, provider: true },
    }),
    prisma.mobileDeviceToken.groupBy({
      by: ["mobileUserId"],
      where: { mobileUserId: { in: ids }, disabledAt: null },
      _count: { _all: true },
    }),
    prisma.mobileRefreshToken.groupBy({
      by: ["mobileUserId"],
      where: { mobileUserId: { in: ids }, revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
    }),
    prisma.mobileFavoriteTemplate.groupBy({
      by: ["mobileUserId"],
      where: { mobileUserId: { in: ids } },
      _count: { _all: true },
    }),
    collectCreditUsage(ids, now),
  ]);

  const providersByUser = new Map();
  identities.forEach((identity) => {
    const list = providersByUser.get(identity.mobileUserId) || [];
    if (!list.includes(identity.provider)) {
      list.push(identity.provider);
    }
    providersByUser.set(identity.mobileUserId, list);
  });

  const countOf = (rows) => new Map(rows.map((row) => [row.mobileUserId, row._count._all]));
  const deviceCounts = countOf(devices);
  const sessionCounts = countOf(sessions);
  const favoriteCounts = countOf(favorites);

  return new Map(
    ids.map((id) => [
      id,
      {
        providers: (providersByUser.get(id) || []).sort(),
        deviceCount: deviceCounts.get(id) || 0,
        sessionCount: sessionCounts.get(id) || 0,
        favoriteCount: favoriteCounts.get(id) || 0,
        creditsUsed: credits.usedByUser.get(id) || 0,
        // null when the wallet could not be read, so the mapper omits the balance
        // entirely rather than reporting a misleading "0 credits left".
        defaultCreditAllowance: credits.available ? credits.defaultAllowance : null,
      },
    ])
  );
}

export async function listMobileUsers({
  page = 1,
  perPage = 20,
  search = "",
  status = "all",
  role = "all",
} = {}) {
  // Both fragments can carry their own OR, so they have to be AND-ed rather
  // than spread into one object.
  const where = {
    AND: [
      buildSearchWhere(search),
      buildStatusWhere(status),
      role === "all" ? {} : { role: normalizeMobileUserRole(role) },
    ],
  };
  const skip = Math.max(page - 1, 0) * perPage;

  const [total, users] = await Promise.all([
    prisma.mobileUser.count({ where }),
    prisma.mobileUser.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
  ]);

  const extras = await collectUserExtras(users.map((user) => user.id));

  return {
    total,
    users: users.map((user) => mapMobileUserForApi(user, extras.get(user.id))),
  };
}

export async function getMobileUserDetail(id) {
  const user = await prisma.mobileUser.findUnique({
    where: { id },
    include: {
      identities: { orderBy: { createdAt: "asc" } },
      deviceTokens: { orderBy: { lastSeenAt: "desc" }, take: 25 },
      refreshTokens: { orderBy: { createdAt: "desc" }, take: 25 },
      favorites: {
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { template: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  if (!user) {
    throw httpError("Mobile user not found.", 404);
  }

  const extras = await collectUserExtras([user.id]);
  const now = Date.now();

  return {
    ...mapMobileUserForApi(user, extras.get(user.id)),
    identities: user.identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      email: identity.email || null,
      emailVerified: Boolean(identity.emailVerified),
      displayName: identity.displayName || null,
      createdAt: toIso(identity.createdAt),
    })),
    devices: user.deviceTokens.map((device) => ({
      id: device.id,
      platform: device.platform,
      appVersion: device.appVersion || null,
      // The raw FCM token is a push credential — only expose a short suffix so
      // admins can match a row to a device without leaking a sendable token.
      tokenSuffix: String(device.token || "").slice(-6),
      disabledAt: toIso(device.disabledAt),
      lastSeenAt: toIso(device.lastSeenAt),
    })),
    sessions: user.refreshTokens.map((token) => ({
      id: token.id,
      userAgent: token.userAgent || null,
      ipAddress: token.ipAddress || null,
      active: !token.revokedAt && token.expiresAt.getTime() > now,
      expiresAt: toIso(token.expiresAt),
      revokedAt: toIso(token.revokedAt),
      lastUsedAt: toIso(token.lastUsedAt),
      createdAt: toIso(token.createdAt),
    })),
    favorites: user.favorites.map((favorite) => ({
      id: favorite.id,
      templateId: favorite.templateId,
      templateName: favorite.template?.name || null,
      templateSlug: favorite.template?.slug || null,
      createdAt: toIso(favorite.createdAt),
    })),
  };
}

export async function createMobileUser({
  name = "",
  email = "",
  emailVerified = false,
  role = "user",
} = {}) {
  const normalizedEmail = email ? normalizeEmail(email) : null;
  const displayName = name ? sanitizeDisplayName(name) : null;

  if (!normalizedEmail && !displayName) {
    throw httpError("A name or an email is required.", 400);
  }

  await assertEmailAvailable(normalizedEmail, null);

  const user = await prisma.mobileUser.create({
    data: {
      name: displayName,
      email: normalizedEmail,
      normalizedEmail,
      emailVerified: Boolean(normalizedEmail && emailVerified),
      role: normalizeMobileUserRole(role),
    },
  });

  return mapMobileUserForApi(user, { providers: [] });
}

/**
 * `name`/`email`/`emailVerified`/`ban` are only touched when the caller sends
 * them, so omitting a field leaves it alone while sending an empty string
 * clears it.
 *
 * @param {{ id: string, name?: string, email?: string, emailVerified?: boolean, role?: string, ban?: boolean, revokeSessions?: boolean }} input
 */
export async function updateMobileUser(input) {
  const { id, name, email, emailVerified, role, ban, revokeSessions, creditAllowance } =
    input;

  const user = await prisma.mobileUser.findUnique({ where: { id } });
  if (!user) {
    throw httpError("Mobile user not found.", 404);
  }

  const data = {};

  if (name !== undefined) {
    data.name = name ? sanitizeDisplayName(name) : null;
  }

  if (email !== undefined) {
    const normalizedEmail = email ? normalizeEmail(email) : null;
    await assertEmailAvailable(normalizedEmail, user.id);
    data.email = normalizedEmail;
    data.normalizedEmail = normalizedEmail;
    // An account with no address cannot have a verified one.
    if (!normalizedEmail) {
      data.emailVerified = false;
    }
  }

  if (emailVerified !== undefined && data.emailVerified === undefined) {
    const nextEmail = email !== undefined ? email : user.email;
    data.emailVerified = Boolean(nextEmail && emailVerified);
  }

  if (role !== undefined) {
    data.role = normalizeMobileUserRole(role);
  }

  if (ban !== undefined) {
    data.bannedUntil = ban ? INDEFINITE_BAN_UNTIL : null;
  }

  if (creditAllowance !== undefined) {
    // null clears the override so the account falls back to the global allowance;
    // 0 is a real value meaning "this account gets no AI credits".
    data.creditAllowance =
      creditAllowance === null ? null : Math.max(0, Math.floor(Number(creditAllowance)));
  }

  const updated = Object.keys(data).length
    ? await prisma.mobileUser.update({ where: { id }, data })
    : user;

  // A ban has to cut off access the user already holds, not just future logins:
  // refresh tokens are revoked and push devices disabled. Access tokens are
  // short-lived JWTs, and the auth layer rejects banned users on every request
  // anyway (see verifyMobileAccessToken).
  if (revokeSessions || ban === true) {
    await revokeMobileUserSessions(id);
  }

  const extras = await collectUserExtras([updated.id]);
  return mapMobileUserForApi(updated, extras.get(updated.id));
}

// Signs the user out of every device: refresh tokens are revoked (access tokens
// are short-lived JWTs and expire on their own) and push tokens are disabled so
// a removed device stops receiving campaigns.
export async function revokeMobileUserSessions(id) {
  const [sessions, devices] = await prisma.$transaction([
    prisma.mobileRefreshToken.updateMany({
      where: { mobileUserId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.mobileDeviceToken.updateMany({
      where: { mobileUserId: id, disabledAt: null },
      data: { disabledAt: new Date() },
    }),
  ]);

  return {
    revokedSessions: sessions.count,
    disabledDevices: devices.count,
  };
}

export async function deleteMobileUser({ id }) {
  const user = await prisma.mobileUser.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!user) {
    throw httpError("Mobile user not found.", 404);
  }

  // Identities, refresh tokens, device tokens and favorites all cascade.
  await prisma.mobileUser.delete({ where: { id } });
}
