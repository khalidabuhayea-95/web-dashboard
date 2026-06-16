import prisma from "@/lib/prisma";

import {
  MobileAppSettingsValidationError,
  compareMobileAppVersions,
  isValidMobileAppVersion,
  mergeMobileAppSettingsInput,
  normalizeMobileDeviceType,
  normalizeStoredMobileAppSettings,
  resolveMobileAppSettingsDecision,
  resolveMobileAiExpandModel,
  resolveMobileEditImageModel,
  resolveMobileObjectRemovalModel,
  resolveMobileUpscaleModel,
} from "./mobileAppSettings";

const MOBILE_APP_SETTINGS_KEY = "mobile_app_settings_v1";

export async function getMobileAppSettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: MOBILE_APP_SETTINGS_KEY },
      select: { value: true },
    });

    if (!record?.value) {
      return normalizeStoredMobileAppSettings();
    }

    return normalizeStoredMobileAppSettings(record.value);
  } catch {
    return normalizeStoredMobileAppSettings();
  }
}

export async function saveMobileAppSettings(input = {}) {
  const current = await getMobileAppSettings();
  const next = mergeMobileAppSettingsInput(current, input);

  await prisma.appSetting.upsert({
    where: { key: MOBILE_APP_SETTINGS_KEY },
    create: {
      key: MOBILE_APP_SETTINGS_KEY,
      value: next,
    },
    update: {
      value: next,
    },
  });

  return next;
}

export {
  MobileAppSettingsValidationError,
  compareMobileAppVersions,
  isValidMobileAppVersion,
  normalizeMobileDeviceType,
  normalizeStoredMobileAppSettings,
  resolveMobileAppSettingsDecision,
  resolveMobileAiExpandModel,
  resolveMobileEditImageModel,
  resolveMobileObjectRemovalModel,
  resolveMobileUpscaleModel,
};
