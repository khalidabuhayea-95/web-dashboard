import prisma from "@/lib/prisma";

// Stores mobile devices' FCM registration tokens, captured via the mobile auth
// APIs. Token persistence must never break an auth flow, so writes swallow
// errors and return null.

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase() === "ios" ? "ios" : "android";
}

// Build a Prisma `where` fragment from a platforms filter. Empty or both
// platforms means "no filter" (target every platform).
export function platformWhere(platforms) {
  const list = Array.isArray(platforms)
    ? platforms.map((p) => String(p || "").trim().toLowerCase()).filter((p) => p === "android" || p === "ios")
    : [];
  const unique = Array.from(new Set(list));
  if (unique.length === 0 || unique.length >= 2) return {};
  return { platform: unique[0] };
}

export async function upsertDeviceToken({ mobileUserId, token, platform, appVersion } = {}) {
  const tokenValue = String(token || "").trim();
  const ownerId = String(mobileUserId || "").trim();
  if (!tokenValue || !ownerId) return null;

  const data = {
    mobileUserId: ownerId,
    platform: normalizePlatform(platform),
    appVersion: appVersion ? String(appVersion).slice(0, 60) : null,
    lastSeenAt: new Date(),
    disabledAt: null,
  };

  try {
    // Unique by token: a device that re-logs in as a different user is reassigned.
    return await prisma.mobileDeviceToken.upsert({
      where: { token: tokenValue },
      create: { token: tokenValue, ...data },
      update: data,
    });
  } catch {
    return null;
  }
}

export async function deactivateDeviceToken(token) {
  const tokenValue = String(token || "").trim();
  if (!tokenValue) return;
  try {
    await prisma.mobileDeviceToken.updateMany({
      where: { token: tokenValue },
      data: { disabledAt: new Date() },
    });
  } catch {
    /* ignore */
  }
}

export async function deactivateTokens(tokens) {
  const list = (tokens || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (!list.length) return;
  try {
    await prisma.mobileDeviceToken.updateMany({
      where: { token: { in: list } },
      data: { disabledAt: new Date() },
    });
  } catch {
    /* ignore */
  }
}

// Both return device "entries" — { token, platform } — so sends can attribute
// success/failure per platform.
export async function getActiveTokensForUserIds(userIds, platforms) {
  const ids = (userIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return [];
  const rows = await prisma.mobileDeviceToken.findMany({
    where: { mobileUserId: { in: ids }, disabledAt: null, ...platformWhere(platforms) },
    select: { token: true, platform: true },
  });
  return rows.map((row) => ({ token: row.token, platform: normalizePlatform(row.platform) }));
}

export async function getAllActiveTokens(platforms) {
  const rows = await prisma.mobileDeviceToken.findMany({
    where: { disabledAt: null, ...platformWhere(platforms) },
    select: { token: true, platform: true },
  });
  return rows.map((row) => ({ token: row.token, platform: normalizePlatform(row.platform) }));
}

export async function countActiveDevices() {
  try {
    return await prisma.mobileDeviceToken.count({ where: { disabledAt: null } });
  } catch {
    return 0;
  }
}

// Active device counts broken down by platform (for reachability hints in the UI).
export async function countActiveDevicesByPlatform() {
  try {
    const rows = await prisma.mobileDeviceToken.groupBy({
      by: ["platform"],
      where: { disabledAt: null },
      _count: { _all: true },
    });
    const counts = { android: 0, ios: 0, total: 0 };
    for (const row of rows) {
      const platform = row.platform === "ios" ? "ios" : "android";
      counts[platform] += row._count._all;
      counts.total += row._count._all;
    }
    return counts;
  } catch {
    return { android: 0, ios: 0, total: 0 };
  }
}

export async function countActiveDevicesForUserIds(userIds) {
  const ids = (userIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return 0;
  try {
    return await prisma.mobileDeviceToken.count({
      where: { mobileUserId: { in: ids }, disabledAt: null },
    });
  } catch {
    return 0;
  }
}
