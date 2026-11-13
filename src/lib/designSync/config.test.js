import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DESIGN_STORAGE_LIMITS,
  MAX_DESIGN_MEDIA_FILE_BYTES,
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  expectedPartBytes,
  multipartPlan,
  normalizeDesignStorageSettings,
  resolveDesignStorageLimitBytes,
} from "./config.js";
import {
  mergeMobileAppSettingsInput,
  normalizeStoredMobileAppSettings,
} from "../settings/mobileAppSettings.js";

const GB = 1024 ** 3;

test("the defaults are 1 GB free, 20 GB Plus and 100 GB Pro", () => {
  assert.deepEqual(DEFAULT_DESIGN_STORAGE_LIMITS, { free: 1 * GB, plus: 20 * GB, pro: 100 * GB });
  assert.deepEqual(normalizeDesignStorageSettings(undefined).limitsBytes, DEFAULT_DESIGN_STORAGE_LIMITS);
});

test("a saved limit is kept; nonsense falls back to the default for that tier only", () => {
  const settings = normalizeDesignStorageSettings({ limitsBytes: { free: 5 * 1024 * 1024, plus: -4, pro: "abc" } });
  assert.deepEqual(settings.limitsBytes, { free: 5 * 1024 * 1024, plus: 20 * GB, pro: 100 * GB });
});

test("the limit is resolved by tier, and an unknown tier is free", () => {
  const settings = { designStorage: { limitsBytes: { free: 1, plus: 2, pro: 3 } } };
  assert.equal(resolveDesignStorageLimitBytes(settings, "free"), 1);
  assert.equal(resolveDesignStorageLimitBytes(settings, "plus"), 2);
  assert.equal(resolveDesignStorageLimitBytes(settings, "pro"), 3);
  assert.equal(resolveDesignStorageLimitBytes(settings, "enterprise"), 1);
  assert.equal(resolveDesignStorageLimitBytes(settings.designStorage, "pro"), 3);
});

test("mobile app settings always carry the storage limits", () => {
  assert.deepEqual(normalizeStoredMobileAppSettings({}).designStorage.limitsBytes, DEFAULT_DESIGN_STORAGE_LIMITS);
});

test("changing one tier's limit from the dashboard leaves the others alone", () => {
  const current = normalizeStoredMobileAppSettings({ designStorage: { limitsBytes: { free: 10, plus: 20, pro: 30 } } });
  const next = mergeMobileAppSettingsInput(current, { designStorage: { limitsBytes: { free: 99 } } });
  assert.deepEqual(next.designStorage.limitsBytes, { free: 99, plus: 20, pro: 30 });
  // A payload that does not mention storage does not reset it.
  const untouched = mergeMobileAppSettingsInput(next, { android: { enableCache: true } });
  assert.deepEqual(untouched.designStorage.limitsBytes, { free: 99, plus: 20, pro: 30 });
});

test("files over the threshold are cut in parts; smaller ones go up whole", () => {
  assert.equal(multipartPlan(MULTIPART_THRESHOLD_BYTES), null);
  assert.deepEqual(multipartPlan(MULTIPART_THRESHOLD_BYTES + 1), { partBytes: MULTIPART_PART_BYTES, partCount: 3 });
  assert.equal(multipartPlan(MAX_DESIGN_MEDIA_FILE_BYTES).partCount, 128, "2 GB is 128 parts of 16 MB");
});

test("every part is full size but the last", () => {
  const size = 40 * 1024 * 1024;
  const { partBytes, partCount } = multipartPlan(size);
  const sizes = Array.from({ length: partCount }, (_, index) => expectedPartBytes(size, partBytes, index + 1));
  assert.deepEqual(sizes, [16 * 1024 * 1024, 16 * 1024 * 1024, 8 * 1024 * 1024]);
  assert.equal(sizes.reduce((total, part) => total + part, 0), size);
  assert.equal(expectedPartBytes(size, partBytes, partCount + 1), 0);
});
