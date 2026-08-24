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
// Credit pricing anchor: 1 credit ≈ $0.005 of provider cost, so the default
// 100-credit allowance is worth about $0.50 of Replicate spend per user per month.
// The values here are only the fallback used before an admin saves settings — the
// live numbers are edited in the dashboard (/mobile-settings).

export const MEDIA_CREDIT_FEATURES = {
  EDIT_IMAGE: "edit-image",
  AI_EXPAND: "ai-expand",
  UPSCALE: "upscale",
  OBJECT_REMOVAL: "object-removal",
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
  [MEDIA_CREDIT_FEATURES.AI_TOOLS]: "AI tools (templates + magic tools)",
};

export const DEFAULT_MONTHLY_CREDIT_ALLOWANCE = 100;

// Credits deducted per successful run, derived from provider cost at ~$0.005/credit.
export const DEFAULT_CREDIT_COSTS = {
  [MEDIA_CREDIT_FEATURES.EDIT_IMAGE]: 8, // ~$0.039
  [MEDIA_CREDIT_FEATURES.AI_EXPAND]: 8, // ~$0.040
  [MEDIA_CREDIT_FEATURES.UPSCALE]: 1, // ~$0.002
  [MEDIA_CREDIT_FEATURES.OBJECT_REMOVAL]: 1, // ~$0.0005
  [MEDIA_CREDIT_FEATURES.AI_TOOLS]: 8, // fallback only — each tool prices itself
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
  "flux-kontext-apps/restore-image": 40_000,
  "arielreplicate/deoldify_image": 12_000, // ESTIMATE (per-second community model)
  "local/background-remover": 0, // self-hosted, no provider cost
};

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

  return {
    monthlyAllowance: normalizeCreditInteger(source.monthlyAllowance, {
      fallback: DEFAULT_MONTHLY_CREDIT_ALLOWANCE,
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
 * Monthly allowance for a user — their personal override wins over the global
 * default, so a specific account can be given more (or fewer) credits.
 */
export function resolveMonthlyAllowance(settings, { userAllowance = null } = {}) {
  if (userAllowance !== null && userAllowance !== undefined) {
    const parsed = Number(userAllowance);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return normalizeMediaCreditSettings(settings?.mediaCredits).monthlyAllowance;
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
