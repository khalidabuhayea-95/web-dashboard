export const SUPPORTED_MOBILE_DEVICE_TYPES = ["android", "ios"];

const APP_VERSION_CODE_PATTERN = /^\d+$/;
const PLATFORM_SETTING_KEYS = new Set([
  "minimumSupportedVersion",
  "enableCache",
  "redirectLink",
]);
const ROOT_SETTING_KEYS = new Set(["android", "ios", "updatedAt"]);

export class MobileAppSettingsValidationError extends Error {}

function sanitizeString(value) {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStoredVersion(value) {
  const normalized = normalizeVersionCodeInput(value);
  return normalized === null ? null : normalized;
}

function sanitizeOptionalLink(value) {
  const normalized = sanitizeString(value);
  return normalized || null;
}

function assertPlainObject(value, message) {
  if (!isPlainObject(value)) {
    throw new MobileAppSettingsValidationError(message);
  }
}

function assertNoUnsupportedKeys(value, allowedKeys, scopeLabel) {
  const unsupported = Object.keys(value || {}).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    throw new MobileAppSettingsValidationError(
      `Unsupported ${scopeLabel} setting key: ${unsupported[0]}`
    );
  }
}

function normalizeStoredPlatformSettings(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    minimumSupportedVersion: sanitizeStoredVersion(source.minimumSupportedVersion),
    enableCache: Boolean(source.enableCache),
    redirectLink: sanitizeOptionalLink(source.redirectLink),
  };
}

function mergePlatformSettings(currentSettings, input, platformLabel) {
  if (typeof input === "undefined") {
    return normalizeStoredPlatformSettings(currentSettings);
  }

  assertPlainObject(input, `Invalid ${platformLabel} settings payload`);
  assertNoUnsupportedKeys(input, PLATFORM_SETTING_KEYS, `${platformLabel} platform`);

  const current = normalizeStoredPlatformSettings(currentSettings);
  const nextVersionInput =
    "minimumSupportedVersion" in input
      ? input.minimumSupportedVersion
      : current.minimumSupportedVersion;

  const nextVersion = normalizeVersionCodeInput(nextVersionInput);

  return {
    minimumSupportedVersion: nextVersion,
    enableCache: "enableCache" in input ? Boolean(input.enableCache) : current.enableCache,
    redirectLink: "redirectLink" in input ? sanitizeOptionalLink(input.redirectLink) : current.redirectLink,
  };
}

export function normalizeMobileDeviceType(value) {
  const normalized = sanitizeString(value).toLowerCase();
  return SUPPORTED_MOBILE_DEVICE_TYPES.includes(normalized) ? normalized : "";
}

function normalizeVersionCodeInput(value) {
  const raw = sanitizeString(value);
  if (!raw) return null;
  if (!APP_VERSION_CODE_PATTERN.test(raw)) {
    throw new MobileAppSettingsValidationError(
      "Version code must be an integer"
    );
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MobileAppSettingsValidationError(
      "Version code must be a non-negative integer"
    );
  }

  return parsed;
}

export function isValidMobileAppVersion(value) {
  try {
    return normalizeVersionCodeInput(value) !== null;
  } catch {
    return false;
  }
}

export function compareMobileAppVersions(leftVersion, rightVersion) {
  const left = normalizeVersionCodeInput(leftVersion);
  const right = normalizeVersionCodeInput(rightVersion);
  if (left === null || right === null) {
    throw new MobileAppSettingsValidationError("App version must be an integer version code");
  }
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeStoredMobileAppSettings(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    android: normalizeStoredPlatformSettings(source.android),
    ios: normalizeStoredPlatformSettings(source.ios),
    updatedAt: sanitizeString(source.updatedAt) || new Date().toISOString(),
  };
}

export function mergeMobileAppSettingsInput(currentSettings, input = {}) {
  const current = normalizeStoredMobileAppSettings(currentSettings);
  assertPlainObject(input, "Invalid mobile app settings payload");
  assertNoUnsupportedKeys(input, ROOT_SETTING_KEYS, "mobile app");

  return {
    android: mergePlatformSettings(current.android, input.android, "android"),
    ios: mergePlatformSettings(current.ios, input.ios, "ios"),
    updatedAt: new Date().toISOString(),
  };
}

export function resolveMobileAppSettingsDecision(settings, { deviceType, appVersion } = {}) {
  const normalizedDeviceType = normalizeMobileDeviceType(deviceType);
  if (!normalizedDeviceType) {
    throw new MobileAppSettingsValidationError(
      "deviceType must be one of: android, ios"
    );
  }

  const normalizedAppVersion = normalizeVersionCodeInput(appVersion);
  if (normalizedAppVersion === null) {
    throw new MobileAppSettingsValidationError(
      "appVersion must be an integer version code"
    );
  }

  const normalizedSettings = normalizeStoredMobileAppSettings(settings);
  const platformSettings = normalizedSettings[normalizedDeviceType];
  const minimumSupportedVersion = sanitizeString(platformSettings?.minimumSupportedVersion);
  const forceUpdate = minimumSupportedVersion
    ? compareMobileAppVersions(normalizedAppVersion, minimumSupportedVersion) < 0
    : false;

  return {
    deviceType: normalizedDeviceType,
    appVersion: normalizedAppVersion,
    forceUpdate,
    enableCache: Boolean(platformSettings?.enableCache),
    redirectLink: sanitizeOptionalLink(platformSettings?.redirectLink),
  };
}
