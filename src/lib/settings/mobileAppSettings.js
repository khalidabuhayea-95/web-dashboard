import {
  DEFAULT_AI_EXPAND_MODEL_ID,
  normalizeAiExpandModelId,
} from "../media/aiExpand/models.js";
import {
  DEFAULT_OBJECT_REMOVAL_MODEL_ID,
  normalizeObjectRemovalModelId,
  normalizeObjectRemovalModelOrder,
} from "../media/objectRemoval/models.js";

export const SUPPORTED_MOBILE_DEVICE_TYPES = ["android", "ios"];

const APP_VERSION_CODE_PATTERN = /^\d+$/;
const PLATFORM_SETTING_KEYS = new Set([
  "minimumSupportedVersion",
  "enableCache",
  "redirectLink",
]);
const ROOT_SETTING_KEYS = new Set([
  "android",
  "ios",
  "objectRemovalModel",
  "aiExpandModel",
  "updatedAt",
]);

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

function sanitizeObjectRemovalModel(value) {
  const normalized = normalizeObjectRemovalModelId(value);
  return normalized || null;
}

function sanitizeAiExpandModel(value) {
  const normalized = normalizeAiExpandModelId(value);
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

function resolveLegacyPlatformObjectRemovalModel(source) {
  const androidOrder = normalizeObjectRemovalModelOrder(source?.android?.objectRemovalModelOrder, {
    allowEmpty: true,
  });
  if (androidOrder.length > 0) {
    return androidOrder[0];
  }

  const iosOrder = normalizeObjectRemovalModelOrder(source?.ios?.objectRemovalModelOrder, {
    allowEmpty: true,
  });
  if (iosOrder.length > 0) {
    return iosOrder[0];
  }

  return null;
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
  const objectRemovalModel =
    sanitizeObjectRemovalModel(source.objectRemovalModel) ||
    resolveLegacyPlatformObjectRemovalModel(source);
  const aiExpandModel = sanitizeAiExpandModel(source.aiExpandModel);
  return {
    android: normalizeStoredPlatformSettings(source.android),
    ios: normalizeStoredPlatformSettings(source.ios),
    objectRemovalModel,
    aiExpandModel,
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
    objectRemovalModel:
      "objectRemovalModel" in input
        ? sanitizeObjectRemovalModel(input.objectRemovalModel)
        : current.objectRemovalModel,
    aiExpandModel:
      "aiExpandModel" in input
        ? sanitizeAiExpandModel(input.aiExpandModel)
        : current.aiExpandModel,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveMobileAppSettingsDecision(
  settings,
  {
    deviceType,
    appVersion,
    defaultObjectRemovalModel = DEFAULT_OBJECT_REMOVAL_MODEL_ID,
    defaultAiExpandModel = DEFAULT_AI_EXPAND_MODEL_ID,
  } = {}
) {
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
    objectRemovalModel: resolveMobileObjectRemovalModel(settings, {
      defaultObjectRemovalModel,
    }),
    aiExpandModel: resolveMobileAiExpandModel(settings, {
      defaultAiExpandModel,
    }),
  };
}

export function resolveMobileObjectRemovalModel(
  settings,
  { defaultObjectRemovalModel = DEFAULT_OBJECT_REMOVAL_MODEL_ID } = {}
) {
  const normalizedSettings = normalizeStoredMobileAppSettings(settings);
  return (
    sanitizeObjectRemovalModel(normalizedSettings.objectRemovalModel) ||
    sanitizeObjectRemovalModel(defaultObjectRemovalModel) ||
    DEFAULT_OBJECT_REMOVAL_MODEL_ID
  );
}

export function resolveMobileAiExpandModel(
  settings,
  { defaultAiExpandModel = DEFAULT_AI_EXPAND_MODEL_ID } = {}
) {
  const normalizedSettings = normalizeStoredMobileAppSettings(settings);
  return (
    sanitizeAiExpandModel(normalizedSettings.aiExpandModel) ||
    sanitizeAiExpandModel(defaultAiExpandModel) ||
    DEFAULT_AI_EXPAND_MODEL_ID
  );
}
