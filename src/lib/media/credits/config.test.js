import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CREDIT_COSTS,
  DEFAULT_MODEL_PRICES_MICROS,
  DEFAULT_MONTHLY_CREDIT_ALLOWANCE,
  MAX_CREDIT_COST,
  MAX_MONTHLY_CREDIT_ALLOWANCE,
  MEDIA_CREDIT_FEATURES,
  SUPPORTED_MEDIA_CREDIT_FEATURES,
  normalizeCreditInteger,
  normalizeMediaCreditFeature,
  normalizeMediaCreditSettings,
  resolveCreditCost,
  resolveModelPriceMicros,
  resolveMonthlyAllowance,
  resolvePeriodKey,
  resolvePeriodResetAt,
} from "./config.js";

test("image-to-layers is no longer a supported feature", () => {
  assert.deepEqual(SUPPORTED_MEDIA_CREDIT_FEATURES, [
    "edit-image",
    "ai-expand",
    "upscale",
    "object-removal",
    "ai-tools",
  ]);
  assert.equal(normalizeMediaCreditFeature("image-to-layers"), "");
});

test("normalizeMediaCreditFeature accepts known features and rejects everything else", () => {
  assert.equal(normalizeMediaCreditFeature("edit-image"), "edit-image");
  assert.equal(normalizeMediaCreditFeature("  upscale  "), "upscale");
  assert.equal(normalizeMediaCreditFeature("not-a-feature"), "");
  assert.equal(normalizeMediaCreditFeature(null), "");
});

test("normalizeCreditInteger rejects unusable values instead of clamping them", () => {
  assert.equal(normalizeCreditInteger(12, { fallback: 5 }), 12);
  assert.equal(normalizeCreditInteger("7", { fallback: 5 }), 7);
  assert.equal(normalizeCreditInteger(3.9, { fallback: 5 }), 3);
  // A typo must not silently become a huge allowance, and negatives are invalid.
  assert.equal(normalizeCreditInteger(-1, { fallback: 5 }), 5);
  assert.equal(normalizeCreditInteger("abc", { fallback: 5 }), 5);
  assert.equal(normalizeCreditInteger(null, { fallback: 5 }), 5);
  assert.equal(normalizeCreditInteger("", { fallback: 5 }), 5);
  assert.equal(normalizeCreditInteger(999, { fallback: 5, max: 100 }), 5);
});

test("normalizeMediaCreditSettings fills every field from defaults", () => {
  const settings = normalizeMediaCreditSettings();
  assert.equal(settings.monthlyAllowance, DEFAULT_MONTHLY_CREDIT_ALLOWANCE);
  assert.deepEqual(settings.costs, DEFAULT_CREDIT_COSTS);
  assert.equal(settings.modelPrices["google/nano-banana"], 39_000);
  // Every supported feature must have a cost, so the guard never sees undefined.
  for (const feature of SUPPORTED_MEDIA_CREDIT_FEATURES) {
    assert.equal(typeof settings.costs[feature], "number");
  }
});

test("normalizeMediaCreditSettings keeps valid overrides and drops bad ones", () => {
  const settings = normalizeMediaCreditSettings({
    monthlyAllowance: 250,
    costs: { "edit-image": 12, upscale: -3, "not-a-feature": 99 },
    modelPrices: { "google/nano-banana": 45_000, "unknown/model": 1 },
  });

  assert.equal(settings.monthlyAllowance, 250);
  assert.equal(settings.costs["edit-image"], 12);
  // An invalid override falls back to the default rather than becoming free.
  assert.equal(settings.costs.upscale, DEFAULT_CREDIT_COSTS.upscale);
  // Unknown keys are dropped entirely.
  assert.equal(settings.costs["not-a-feature"], undefined);
  assert.equal(settings.modelPrices["google/nano-banana"], 45_000);
  assert.equal(settings.modelPrices["unknown/model"], undefined);
});

test("out-of-range settings fall back to defaults", () => {
  const settings = normalizeMediaCreditSettings({
    monthlyAllowance: MAX_MONTHLY_CREDIT_ALLOWANCE + 1,
    costs: { "edit-image": MAX_CREDIT_COST + 1 },
  });
  assert.equal(settings.monthlyAllowance, DEFAULT_MONTHLY_CREDIT_ALLOWANCE);
  assert.equal(settings.costs["edit-image"], DEFAULT_CREDIT_COSTS["edit-image"]);
});

test("resolveCreditCost reads the configured cost", () => {
  const settings = { mediaCredits: { costs: { "edit-image": 20 } } };
  assert.equal(resolveCreditCost(settings, MEDIA_CREDIT_FEATURES.EDIT_IMAGE), 20);
  // Unconfigured features fall back to their default cost.
  assert.equal(
    resolveCreditCost(settings, MEDIA_CREDIT_FEATURES.UPSCALE),
    DEFAULT_CREDIT_COSTS.upscale
  );
  assert.equal(resolveCreditCost(settings, "not-a-feature"), 0);
  assert.equal(resolveCreditCost(undefined, MEDIA_CREDIT_FEATURES.EDIT_IMAGE), 8);
});

test("resolveMonthlyAllowance lets a per-user override win", () => {
  const settings = { mediaCredits: { monthlyAllowance: 100 } };
  assert.equal(resolveMonthlyAllowance(settings), 100);
  assert.equal(resolveMonthlyAllowance(settings, { userAllowance: 500 }), 500);
  // Zero is a real value (this account gets no AI), not "unset".
  assert.equal(resolveMonthlyAllowance(settings, { userAllowance: 0 }), 0);
  // Null means "no override" and must fall through to the global default.
  assert.equal(resolveMonthlyAllowance(settings, { userAllowance: null }), 100);
  assert.equal(resolveMonthlyAllowance(settings, { userAllowance: -5 }), 100);
});

test("resolveModelPriceMicros reads the configured price table", () => {
  assert.equal(resolveModelPriceMicros({}, "google/nano-banana"), 39_000);
  assert.equal(
    resolveModelPriceMicros(
      { mediaCredits: { modelPrices: { "google/nano-banana": 1_000 } } },
      "google/nano-banana"
    ),
    1_000
  );
  assert.equal(resolveModelPriceMicros({}, "unknown/model"), 0);
  assert.equal(resolveModelPriceMicros({}, ""), 0);
});

test("period keys and resets are computed in UTC", () => {
  assert.equal(resolvePeriodKey(new Date("2026-08-03T07:00:00Z")), "2026-08");
  assert.equal(resolvePeriodKey(new Date("2026-01-31T23:59:59Z")), "2026-01");
  assert.equal(
    resolvePeriodResetAt(new Date("2026-08-03T07:00:00Z")).toISOString(),
    "2026-09-01T00:00:00.000Z"
  );
  // December must roll into the next year.
  assert.equal(
    resolvePeriodResetAt(new Date("2026-12-15T12:00:00Z")).toISOString(),
    "2027-01-01T00:00:00.000Z"
  );
});

test("every selectable model has a provider price", async () => {
  // A model offered in the dashboard but missing from the price table would show
  // "$0 per run" and silently under-report spend.
  const [edit, expand, upscale, removal] = await Promise.all([
    import("../editImageByPrompt/models.js"),
    import("../aiExpand/models.js"),
    import("../imageUpscale/models.js"),
    import("../objectRemoval/models.js"),
  ]);

  const selectableIds = [
    ...edit.SUPPORTED_EDIT_IMAGE_MODEL_IDS,
    ...expand.SUPPORTED_AI_EXPAND_MODEL_IDS,
    ...upscale.SUPPORTED_IMAGE_UPSCALE_MODEL_IDS,
    ...removal.SUPPORTED_OBJECT_REMOVAL_MODEL_IDS,
  ];

  const missing = selectableIds.filter((id) => !(id in DEFAULT_MODEL_PRICES_MICROS));
  assert.deepEqual(missing, [], `models missing a price: ${missing.join(", ")}`);
});
