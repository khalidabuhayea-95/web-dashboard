import assert from "node:assert/strict";
import test from "node:test";

import {
  MobileAppSettingsValidationError,
  compareMobileAppVersions,
  mergeMobileAppSettingsInput,
  normalizeStoredMobileAppSettings,
  resolveMobileAppSettingsDecision,
} from "./mobileAppSettings.js";

test("normalizeStoredMobileAppSettings returns safe defaults when no settings exist", () => {
  const settings = normalizeStoredMobileAppSettings();

  assert.deepEqual(settings.android, {
    minimumSupportedVersion: null,
    enableCache: false,
    redirectLink: null,
  });
  assert.deepEqual(settings.ios, {
    minimumSupportedVersion: null,
    enableCache: false,
    redirectLink: null,
  });
  assert.ok(settings.updatedAt);
});

test("compareMobileAppVersions compares integer version codes", () => {
  assert.equal(compareMobileAppVersions(12, 12), 0);
  assert.equal(compareMobileAppVersions("12", "13"), -1);
  assert.equal(compareMobileAppVersions(20, 19), 1);
});

test("resolveMobileAppSettingsDecision enables force update only below minimum version", () => {
  const settings = normalizeStoredMobileAppSettings({
    android: {
      minimumSupportedVersion: 205,
      enableCache: true,
      redirectLink: "https://play.google.com/store/apps/details?id=com.example",
    },
  });

  assert.deepEqual(
    resolveMobileAppSettingsDecision(settings, {
      deviceType: "ANDROID",
      appVersion: "204",
    }),
    {
      deviceType: "android",
      appVersion: 204,
      forceUpdate: true,
      enableCache: true,
      redirectLink: "https://play.google.com/store/apps/details?id=com.example",
    }
  );

  assert.deepEqual(
    resolveMobileAppSettingsDecision(settings, {
      deviceType: "android",
      appVersion: "205",
    }),
    {
      deviceType: "android",
      appVersion: 205,
      forceUpdate: false,
      enableCache: true,
      redirectLink: "https://play.google.com/store/apps/details?id=com.example",
    }
  );
});

test("mergeMobileAppSettingsInput preserves untouched values and updates changed ones", () => {
  const current = normalizeStoredMobileAppSettings({
    android: {
      minimumSupportedVersion: 100,
      enableCache: false,
      redirectLink: "https://play.google.com/store/apps/details?id=com.example",
    },
    ios: {
      minimumSupportedVersion: 300,
      enableCache: true,
      redirectLink: null,
    },
  });

  const next = mergeMobileAppSettingsInput(current, {
    android: {
      minimumSupportedVersion: "120",
      enableCache: true,
      redirectLink: "  https://example.com/android-update  ",
    },
  });

  assert.deepEqual(next.android, {
    minimumSupportedVersion: 120,
    enableCache: true,
    redirectLink: "https://example.com/android-update",
  });
  assert.deepEqual(next.ios, current.ios);
  assert.ok(next.updatedAt);
});

test("invalid versions are rejected during save/evaluation flows", () => {
  assert.throws(
    () =>
      mergeMobileAppSettingsInput(normalizeStoredMobileAppSettings(), {
        android: { minimumSupportedVersion: "1.2.0" },
      }),
    MobileAppSettingsValidationError
  );

  assert.throws(
    () =>
      resolveMobileAppSettingsDecision(normalizeStoredMobileAppSettings(), {
        deviceType: "ios",
        appVersion: "1a",
      }),
    MobileAppSettingsValidationError
  );
});
