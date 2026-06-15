import assert from "node:assert/strict";
import test from "node:test";

import {
  MobileAppSettingsValidationError,
  compareMobileAppVersions,
  mergeMobileAppSettingsInput,
  resolveMobileAiExpandModel,
  normalizeStoredMobileAppSettings,
  resolveMobileAppSettingsDecision,
  resolveMobileObjectRemovalModel,
  resolveMobileUpscaleModel,
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
  assert.equal(settings.objectRemovalModel, null);
  assert.equal(settings.aiExpandModel, null);
  assert.equal(settings.upscaleModel, null);
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
    objectRemovalModel: "zylim0702/remove-object",
    aiExpandModel: "luma/reframe-image",
  });

  assert.deepEqual(
    resolveMobileAppSettingsDecision(settings, {
      deviceType: "ANDROID",
      appVersion: "204",
      defaultObjectRemovalModel: "allenhooo/lama",
    }),
    {
      deviceType: "android",
      appVersion: 204,
      forceUpdate: true,
      enableCache: true,
      redirectLink: "https://play.google.com/store/apps/details?id=com.example",
      objectRemovalModel: "zylim0702/remove-object",
      aiExpandModel: "luma/reframe-image",
      upscaleModel: "prunaai/p-image-upscale",
    }
  );

  assert.deepEqual(
    resolveMobileAppSettingsDecision(settings, {
      deviceType: "android",
      appVersion: "205",
      defaultObjectRemovalModel: "allenhooo/lama",
    }),
    {
      deviceType: "android",
      appVersion: 205,
      forceUpdate: false,
      enableCache: true,
      redirectLink: "https://play.google.com/store/apps/details?id=com.example",
      objectRemovalModel: "zylim0702/remove-object",
      aiExpandModel: "luma/reframe-image",
      upscaleModel: "prunaai/p-image-upscale",
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
    objectRemovalModel: "allenhooo/lama",
    aiExpandModel: "bria/expand-image",
  });

  const next = mergeMobileAppSettingsInput(current, {
    android: {
      minimumSupportedVersion: "120",
      enableCache: true,
      redirectLink: "  https://example.com/android-update  ",
    },
    objectRemovalModel: "zylim0702/remove-object",
    aiExpandModel: "bria/expand-image",
  });

  assert.deepEqual(next.android, {
    minimumSupportedVersion: 120,
    enableCache: true,
    redirectLink: "https://example.com/android-update",
  });
  assert.deepEqual(next.ios, current.ios);
  assert.equal(next.objectRemovalModel, "zylim0702/remove-object");
  assert.equal(next.aiExpandModel, "bria/expand-image");
  assert.ok(next.updatedAt);
});

test("resolveMobileObjectRemovalModel falls back to the provided default model", () => {
  const settings = normalizeStoredMobileAppSettings({
    android: {
      minimumSupportedVersion: 100,
      enableCache: true,
    },
  });

  assert.equal(
    resolveMobileObjectRemovalModel(settings, {
      defaultObjectRemovalModel: "bria/eraser",
    }),
    "bria/eraser"
  );
});

test("resolveMobileAiExpandModel falls back to the provided default model", () => {
  const settings = normalizeStoredMobileAppSettings();

  assert.equal(
    resolveMobileAiExpandModel(settings, {
      defaultAiExpandModel: "bria/expand-image",
    }),
    "bria/expand-image"
  );
});

test("resolveMobileUpscaleModel falls back to the provided default model", () => {
  const settings = normalizeStoredMobileAppSettings();

  assert.equal(
    resolveMobileUpscaleModel(settings, {
      defaultUpscaleModel: "google/upscaler",
    }),
    "google/upscaler"
  );
});

test("mergeMobileAppSettingsInput stores and normalizes the upscale model", () => {
  const next = mergeMobileAppSettingsInput(normalizeStoredMobileAppSettings(), {
    upscaleModel: "nightmareai/real-esrgan",
  });
  assert.equal(next.upscaleModel, "nightmareai/real-esrgan");

  const rejected = mergeMobileAppSettingsInput(normalizeStoredMobileAppSettings(), {
    upscaleModel: "not-a-real-model",
  });
  assert.equal(rejected.upscaleModel, null);
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
