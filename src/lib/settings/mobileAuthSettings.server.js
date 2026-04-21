import prisma from "@/lib/prisma";

const MOBILE_AUTH_SETTINGS_KEY = "mobile_auth_settings_v1";

function sanitizeString(value) {
  return String(value || "").trim();
}

function sanitizeStringList(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((item) => sanitizeString(item)).filter(Boolean))
    );
  }

  return Array.from(
    new Set(
      sanitizeString(value)
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function sanitizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function maskSecret(value) {
  const source = sanitizeString(value);
  if (!source) return "";
  if (source.length <= 8) return "*".repeat(source.length);
  return `${source.slice(0, 4)}${"*".repeat(Math.max(4, source.length - 8))}${source.slice(-4)}`;
}

function normalizeStoredSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const bearer = source.bearer && typeof source.bearer === "object" ? source.bearer : {};
  const google = source.google && typeof source.google === "object" ? source.google : {};
  const facebook = source.facebook && typeof source.facebook === "object" ? source.facebook : {};
  const apple = source.apple && typeof source.apple === "object" ? source.apple : {};

  return {
    google: {
      enabled: Boolean(google.enabled),
      androidClientIds: sanitizeStringList(google.androidClientIds),
      iosClientIds: sanitizeStringList(google.iosClientIds),
    },
    facebook: {
      enabled: Boolean(facebook.enabled),
      appId: sanitizeString(facebook.appId),
      appSecret: sanitizeString(facebook.appSecret),
    },
    apple: {
      enabled: Boolean(apple.enabled),
      iosBundleIds: sanitizeStringList(apple.iosBundleIds),
    },
    bearer: {
      accessTokenSecret: sanitizeString(bearer.accessTokenSecret),
      accessTokenTtlMinutes: sanitizePositiveInt(bearer.accessTokenTtlMinutes, 60),
      refreshTokenSecret: sanitizeString(bearer.refreshTokenSecret),
      refreshTokenTtlDays: sanitizePositiveInt(bearer.refreshTokenTtlDays, 30),
    },
    updatedAt: sanitizeString(source.updatedAt) || new Date().toISOString(),
  };
}

export async function getMobileAuthSettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: MOBILE_AUTH_SETTINGS_KEY },
      select: { value: true },
    });
    if (!record?.value) {
      return normalizeStoredSettings();
    }
    return normalizeStoredSettings(record.value);
  } catch {
    return normalizeStoredSettings();
  }
}

export function toPublicMobileAuthSettings(settings) {
  const normalized = normalizeStoredSettings(settings);
  return {
    google: normalized.google,
    facebook: {
      enabled: normalized.facebook.enabled,
      appId: normalized.facebook.appId,
      appSecretConfigured: Boolean(normalized.facebook.appSecret),
      appSecretMasked: maskSecret(normalized.facebook.appSecret),
    },
    apple: normalized.apple,
    bearer: {
      accessTokenTtlMinutes: normalized.bearer.accessTokenTtlMinutes,
      accessTokenSecretConfigured: Boolean(normalized.bearer.accessTokenSecret),
      accessTokenSecretMasked: maskSecret(normalized.bearer.accessTokenSecret),
      refreshTokenTtlDays: normalized.bearer.refreshTokenTtlDays,
      refreshTokenSecretConfigured: Boolean(normalized.bearer.refreshTokenSecret),
      refreshTokenSecretMasked: maskSecret(normalized.bearer.refreshTokenSecret),
    },
    updatedAt: normalized.updatedAt,
  };
}

export async function saveMobileAuthSettings(input = {}) {
  const current = await getMobileAuthSettings();
  const next = normalizeStoredSettings({
    google: {
      enabled: input?.google?.enabled ?? current.google.enabled,
      androidClientIds: input?.google?.androidClientIds ?? current.google.androidClientIds,
      iosClientIds: input?.google?.iosClientIds ?? current.google.iosClientIds,
    },
    facebook: {
      enabled: input?.facebook?.enabled ?? current.facebook.enabled,
      appId: input?.facebook?.appId ?? current.facebook.appId,
      appSecret: sanitizeString(input?.facebook?.appSecret) || current.facebook.appSecret,
    },
    apple: {
      enabled: input?.apple?.enabled ?? current.apple.enabled,
      iosBundleIds: input?.apple?.iosBundleIds ?? current.apple.iosBundleIds,
    },
    bearer: {
      accessTokenSecret:
        sanitizeString(input?.bearer?.accessTokenSecret) || current.bearer.accessTokenSecret,
      accessTokenTtlMinutes:
        input?.bearer?.accessTokenTtlMinutes ?? current.bearer.accessTokenTtlMinutes,
      refreshTokenSecret:
        sanitizeString(input?.bearer?.refreshTokenSecret) || current.bearer.refreshTokenSecret,
      refreshTokenTtlDays:
        input?.bearer?.refreshTokenTtlDays ?? current.bearer.refreshTokenTtlDays,
    },
    updatedAt: new Date().toISOString(),
  });

  await prisma.appSetting.upsert({
    where: { key: MOBILE_AUTH_SETTINGS_KEY },
    create: {
      key: MOBILE_AUTH_SETTINGS_KEY,
      value: next,
    },
    update: {
      value: next,
    },
  });

  return next;
}
