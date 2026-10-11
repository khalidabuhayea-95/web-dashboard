import prisma from "@/lib/prisma";
import { isInfrastructureError } from "@/lib/api/infrastructureErrors";

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
  } catch (error) {
    // Defaults are not the configured prices, gates and models — serving them as if they were
    // during an outage is the fabricated-200 failure of production audit H-24.
    if (isInfrastructureError(error)) throw error;
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
