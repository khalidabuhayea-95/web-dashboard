// Credit wallet for the paid AI media features.
//
// Every mobile user gets one monthly credit balance. Each AI operation deducts a
// per-feature number of credits, so a user can spend their allowance however they
// like — many cheap upscales, or a few expensive edits.
//
// Why a wallet and not raw request counts: the short-window rate limiter
// (src/lib/security/rateLimit.server.js) only caps bursts. At 6 requests / 5
// minutes a single account can still issue ~1,700 runs/day, which on a $0.039/run
// model is ~$67/day from one user. The wallet is the actual spend ceiling.
//
// Credit pricing anchor: 1 credit ≈ $0.0005 of provider cost, so the default
// 1,000-credit free allowance is worth about $0.40 of Replicate spend per user
// per month. ★2026-08-31: credits were inflated x10 across the board (allowances,
// per-run costs, ledger history) purely for perception — "١٠٬٠٠٠ نقطة" reads as
// generous where "١٠٠٠" read as stingy. Purchasing power did not change; per-run
// costs were simultaneously REBASED from actual provider prices (below) so every
// run is individually profitable. The values here are only the fallback used
// before an admin saves settings — the live numbers are edited in /mobile-settings.

export const MEDIA_CREDIT_FEATURES = {
  EDIT_IMAGE: "edit-image",
  AI_EXPAND: "ai-expand",
  UPSCALE: "upscale",
  OBJECT_REMOVAL: "object-removal",
  TASHKEEL: "tashkeel",
  // One bucket for the whole AI Tools tab (templates + magic tools). The
  // per-run price is NOT this feature's configured cost — each tool carries its
  // own creditCost, passed to the wallet as an override. This entry exists so
  // the spend report can group the tab, and so a default exists if a tool ever
  // reports no cost of its own.
  AI_TOOLS: "ai-tools",
};

export const SUPPORTED_MEDIA_CREDIT_FEATURES = Object.values(MEDIA_CREDIT_FEATURES);

/** Human labels for the dashboard. */
export const MEDIA_CREDIT_FEATURE_LABELS = {
  [MEDIA_CREDIT_FEATURES.EDIT_IMAGE]: "Edit image by prompt",
  [MEDIA_CREDIT_FEATURES.AI_EXPAND]: "AI expand",
  [MEDIA_CREDIT_FEATURES.UPSCALE]: "Upscale",
  [MEDIA_CREDIT_FEATURES.OBJECT_REMOVAL]: "Object removal",
  [MEDIA_CREDIT_FEATURES.TASHKEEL]: "Arabic diacritization (تشكيل)",
  [MEDIA_CREDIT_FEATURES.AI_TOOLS]: "AI tools (templates + magic tools)",
};

export const DEFAULT_MONTHLY_CREDIT_ALLOWANCE = 1_000;

// Monthly allowance for Nayroz Plus subscribers (subscriptionTier "plus").
// Worst-case provider exposure = allowance x $0.0004/credit (the nano-banana
// class is the most provider-expensive per credit) = $4.00/mo, just under the
// $4.99 monthly plan's ~$4.24 net-of-store-cut revenue. Like the free
// allowance, the live number is edited in /mobile-settings — this is only the
// pre-settings fallback.
export const DEFAULT_PLUS_MONTHLY_CREDIT_ALLOWANCE = 10_000;

// Nayroz Pro (subscriptionTier "pro"): 5x the Plus allowance at $24.99/mo
// placeholder pricing. Worst-case exposure $20.00/mo vs ~$21.24 net — profitable
// even if a subscriber burns the entire allowance on the priciest tool.
export const DEFAULT_PRO_MONTHLY_CREDIT_ALLOWANCE = 50_000;

// Credits deducted per successful run. Rebased 2026-08-31 from the provider
// prices below at the $0.0005/credit anchor, with margin: the charge must
// exceed the provider cost on EVERY run (28% over on the $0.039 nano-banana
// class, more on cheaper models), so no mix of usage can be sold at a loss.
export const DEFAULT_CREDIT_COSTS = {
  [MEDIA_CREDIT_FEATURES.EDIT_IMAGE]: 100, // ~$0.039 provider, $0.050 charged
  [MEDIA_CREDIT_FEATURES.AI_EXPAND]: 100, // ~$0.040 provider, $0.050 charged
  [MEDIA_CREDIT_FEATURES.UPSCALE]: 20, // ≤$0.006 provider, $0.010 charged
  [MEDIA_CREDIT_FEATURES.OBJECT_REMOVAL]: 10, // ~$0.0005 provider, $0.005 charged
  // The cheapest action we sell: a second of CPU on our own worker. Priced so
  // it reads as "almost free" next to an image run, not so it earns anything.
  [MEDIA_CREDIT_FEATURES.TASHKEEL]: 5,
  [MEDIA_CREDIT_FEATURES.AI_TOOLS]: 100, // fallback only — each tool prices itself
};

// Provider cost per run, in micro-dollars (1_000_000 = $1). Verified against the
// Replicate model pages on 2026-08-02. Values marked ESTIMATE are per-second
// community models where the run cost depends on runtime. These feed the spend
// report only — they never gate a request.
export const DEFAULT_MODEL_PRICES_MICROS = {
  "google/nano-banana": 39_000,
  "qwen/qwen-image-edit-plus": 30_000,
  "black-forest-labs/flux-kontext-pro": 40_000,
  "prunaai/p-image-upscale": 5_000,
  "recraft-ai/recraft-crisp-upscale": 6_000,
  "cjwbw/real-esrgan": 4_400, // ESTIMATE (T4, ~20s)
  "google/upscaler": 20_000,
  "nightmareai/real-esrgan": 2_000,
  "alexgenovese/upscaler": 4_000, // ESTIMATE (T4, per-second)
  "allenhooo/lama": 520, // ESTIMATE (T4, ~3s)
  "selfhost/fine-tashkeel": 200, // ESTIMATE (text op, ~1 CPU-second; $0 on a local/dev box)
  "selfhost/real-esrgan": 1_000, // ESTIMATE (our worker: ~1.5 GPU-seconds; $0 on a local/dev box)
  "selfhost/lama": 2_000, // ESTIMATE (our worker: serverless GPU-seconds; $0 while a local/dev box serves it)
  "zylim0702/remove-object": 910, // ESTIMATE (T4, ~5s)
  "bria/eraser": 40_000,
  "bria/expand-image": 40_000,
  "luma/reframe-image": 10_000,
  // AI-templates catalog models (see src/lib/aiTemplates/models.js), added
  // 2026-08-12 from vendor pricing pages — ESTIMATEs where the page shows a
  // range rather than a flat per-image rate.
  "qwen/qwen-image": 20_000, // ESTIMATE (~$0.02/image)
  "ideogram-ai/ideogram-v4-turbo": 30_000,
  "ideogram-ai/ideogram-v4-balanced": 60_000,
  "bytedance/seedream-4.5": 40_000,
  "google/nano-banana-pro": 134_000, // 1K/2K tier
  // Magic Tools specialist models (see src/lib/magicTools/models.js).
  "tencentarc/gfpgan": 3_200,
  "selfhost/gfpgan": 1_500, // ESTIMATE (our worker: ~1.5 GPU-seconds; $0 on a local/dev box)
  "flux-kontext-apps/restore-image": 40_000,
  "arielreplicate/deoldify_image": 12_000, // ESTIMATE (per-second community model)
  "local/background-remover": 0, // self-hosted, no provider cost
};

// Reference prices for the store products, in whole cents. ★These NEVER reach
// the app: Apple and Google own what a user is charged, and the paywall always
// renders the store's own localized price. They exist so the dashboard can
// compute margin against an allowance, and so a price change is recorded
// somewhere a report can read.
export const DEFAULT_REFERENCE_PRICES_CENTS = {
  plus_monthly: 499,
  plus_yearly: 3_999,
  pro_monthly: 2_499,
  pro_yearly: 24_999,
};

export const REFERENCE_PRICE_KEYS = Object.keys(DEFAULT_REFERENCE_PRICES_CENTS);

export const MAX_REFERENCE_PRICE_CENTS = 10_000_00; // $10,000

export const MAX_MONTHLY_CREDIT_ALLOWANCE = 1_000_000;
export const MAX_CREDIT_COST = 10_000;
export const MAX_MODEL_PRICE_MICROS = 100_000_000; // $100/run

export function normalizeMediaCreditFeature(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_MEDIA_CREDIT_FEATURES.includes(normalized) ? normalized : "";
}

/**
 * Coerces a stored/submitted integer into range, falling back when unusable.
 * Rejects NaN, negatives and values past `max` rather than silently clamping a
 * typo into a huge allowance.
 */
export function normalizeCreditInteger(value, { fallback = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return fallback;
  return Math.floor(parsed);
}

/**
 * Normalizes the `mediaCredits` settings blob, filling every missing field with a
 * default so callers never have to null-check.
 */
export function normalizeMediaCreditSettings(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  const costsSource =
    source.costs && typeof source.costs === "object" && !Array.isArray(source.costs)
      ? source.costs
      : {};
  const costs = {};
  for (const feature of SUPPORTED_MEDIA_CREDIT_FEATURES) {
    costs[feature] = normalizeCreditInteger(costsSource[feature], {
      fallback: DEFAULT_CREDIT_COSTS[feature],
      max: MAX_CREDIT_COST,
    });
  }

  const pricesSource =
    source.modelPrices &&
    typeof source.modelPrices === "object" &&
    !Array.isArray(source.modelPrices)
      ? source.modelPrices
      : {};
  const modelPrices = {};
  for (const [modelId, defaultPrice] of Object.entries(DEFAULT_MODEL_PRICES_MICROS)) {
    modelPrices[modelId] = normalizeCreditInteger(pricesSource[modelId], {
      fallback: defaultPrice,
      max: MAX_MODEL_PRICE_MICROS,
    });
  }

  const pricesSourceRef =
    source.referencePrices &&
    typeof source.referencePrices === "object" &&
    !Array.isArray(source.referencePrices)
      ? source.referencePrices
      : {};
  const referencePrices = {};
  for (const [key, fallback] of Object.entries(DEFAULT_REFERENCE_PRICES_CENTS)) {
    referencePrices[key] = normalizeCreditInteger(pricesSourceRef[key], {
      fallback,
      max: MAX_REFERENCE_PRICE_CENTS,
    });
  }

  return {
    referencePrices,
    monthlyAllowance: normalizeCreditInteger(source.monthlyAllowance, {
      fallback: DEFAULT_MONTHLY_CREDIT_ALLOWANCE,
      max: MAX_MONTHLY_CREDIT_ALLOWANCE,
    }),
    plusMonthlyAllowance: normalizeCreditInteger(source.plusMonthlyAllowance, {
      fallback: DEFAULT_PLUS_MONTHLY_CREDIT_ALLOWANCE,
      max: MAX_MONTHLY_CREDIT_ALLOWANCE,
    }),
    proMonthlyAllowance: normalizeCreditInteger(source.proMonthlyAllowance, {
      fallback: DEFAULT_PRO_MONTHLY_CREDIT_ALLOWANCE,
      max: MAX_MONTHLY_CREDIT_ALLOWANCE,
    }),
    costs,
    modelPrices,
  };
}

/** Credits charged for one run of a feature. */
export function resolveCreditCost(settings, feature) {
  const normalized = normalizeMediaCreditFeature(feature);
  if (!normalized) return 0;
  return normalizeMediaCreditSettings(settings?.mediaCredits).costs[normalized];
}

/**
 * Monthly allowance for a user. Precedence: personal override (admins can hand
 * a specific account more or fewer credits — it beats the subscription too, so
 * support can fix an account without touching billing) > subscription tier
 * ("plus" → plusMonthlyAllowance) > free default.
 */
export function resolveMonthlyAllowance(settings, { userAllowance = null, tier = "free" } = {}) {
  if (userAllowance !== null && userAllowance !== undefined) {
    const parsed = Number(userAllowance);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  const normalized = normalizeMediaCreditSettings(settings?.mediaCredits);
  if (tier === "pro") return normalized.proMonthlyAllowance;
  return tier === "plus" ? normalized.plusMonthlyAllowance : normalized.monthlyAllowance;
}

/** Provider cost of one run in micro-dollars, for the spend report. */
export function resolveModelPriceMicros(settings, modelId) {
  const normalized = String(modelId || "").trim();
  if (!normalized) return 0;
  const prices = normalizeMediaCreditSettings(settings?.mediaCredits).modelPrices;
  return prices[normalized] ?? 0;
}

/** UTC period bucket a usage row belongs to, e.g. "2026-08". */
export function resolvePeriodKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Start of the next UTC month — when the allowance resets. */
export function resolvePeriodResetAt(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
