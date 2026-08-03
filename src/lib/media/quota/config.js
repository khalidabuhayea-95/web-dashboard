// Monthly per-user quotas for the paid AI media features.
//
// The short-window rate limiter (src/lib/security/rateLimit.server.js) only caps
// bursts: at 6 requests / 5 minutes a single account can still issue ~1,700 calls
// a day, which on a $0.039/run model is ~$67/day from one user. These quotas are
// the actual spend ceiling.
//
// Limits are cost-weighted on purpose: the near-free features stay generous so
// the app feels open, while the expensive generative ones are capped tightly.
// Every limit can be overridden per-environment without a redeploy — see
// MEDIA_QUOTA_ENV_KEYS below. Set a limit to `unlimited` to disable the cap, or
// to `0` to turn the feature off entirely.

export const MEDIA_QUOTA_FEATURES = {
  EDIT_IMAGE: "edit-image",
  AI_EXPAND: "ai-expand",
  IMAGE_TO_LAYERS: "image-to-layers",
  UPSCALE: "upscale",
  OBJECT_REMOVAL: "object-removal",
};

export const SUPPORTED_MEDIA_QUOTA_FEATURES = Object.values(MEDIA_QUOTA_FEATURES);

// Monthly allowance per mobile user, per feature.
const DEFAULT_MONTHLY_LIMITS = {
  [MEDIA_QUOTA_FEATURES.EDIT_IMAGE]: 15,
  [MEDIA_QUOTA_FEATURES.AI_EXPAND]: 10,
  [MEDIA_QUOTA_FEATURES.IMAGE_TO_LAYERS]: 5,
  [MEDIA_QUOTA_FEATURES.UPSCALE]: 50,
  [MEDIA_QUOTA_FEATURES.OBJECT_REMOVAL]: 100,
};

const MEDIA_QUOTA_ENV_KEYS = {
  [MEDIA_QUOTA_FEATURES.EDIT_IMAGE]: "MEDIA_QUOTA_EDIT_IMAGE",
  [MEDIA_QUOTA_FEATURES.AI_EXPAND]: "MEDIA_QUOTA_AI_EXPAND",
  [MEDIA_QUOTA_FEATURES.IMAGE_TO_LAYERS]: "MEDIA_QUOTA_IMAGE_TO_LAYERS",
  [MEDIA_QUOTA_FEATURES.UPSCALE]: "MEDIA_QUOTA_UPSCALE",
  [MEDIA_QUOTA_FEATURES.OBJECT_REMOVAL]: "MEDIA_QUOTA_OBJECT_REMOVAL",
};

// Provider cost per run, in micro-dollars (1_000_000 = $1). Verified against the
// Replicate model pages on 2026-08-02; values marked ESTIMATE are per-second
// community models where the run cost depends on runtime.
export const MODEL_COST_MICROS = {
  "google/nano-banana": 39_000,
  "qwen/qwen-image-edit-plus": 30_000,
  "black-forest-labs/flux-kontext-pro": 40_000,
  "qwen/qwen-image-layered": 30_000, // + PER_LAYER_COST_MICROS per output layer
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
};

// qwen/qwen-image-layered bills a base run fee plus a per-output-image fee.
export const PER_LAYER_COST_MICROS = 10_000;

function parseLimit(rawValue, fallback) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "unlimited" || normalized === "-1") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function normalizeMediaQuotaFeature(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_MEDIA_QUOTA_FEATURES.includes(normalized) ? normalized : "";
}

/**
 * Monthly allowance for a feature. Returns `null` for "unlimited" and `0` for
 * "feature disabled".
 *
 * @param {string} feature
 * @returns {number | null}
 */
export function getMonthlyQuotaLimit(feature) {
  const normalized = normalizeMediaQuotaFeature(feature);
  if (!normalized) return 0;
  const fallback = DEFAULT_MONTHLY_LIMITS[normalized] ?? 0;
  return parseLimit(process.env[MEDIA_QUOTA_ENV_KEYS[normalized]], fallback);
}

/**
 * Estimated provider cost of one run, in micro-dollars. `outputCount` only
 * matters for models that bill per output image (qwen-image-layered).
 *
 * @param {string} modelId
 * @param {{ outputCount?: number }} [options]
 * @returns {number}
 */
export function estimateRunCostMicros(modelId, { outputCount = 1 } = {}) {
  const normalized = String(modelId || "").trim();
  const base = MODEL_COST_MICROS[normalized] ?? 0;
  if (normalized === "qwen/qwen-image-layered") {
    const layers = Math.max(1, Math.floor(Number(outputCount) || 1));
    return base + layers * PER_LAYER_COST_MICROS;
  }
  return base;
}

/** UTC period bucket a usage row belongs to, e.g. "2026-08". */
export function resolvePeriodKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Start of the next UTC month — when the current allowance resets. */
export function resolvePeriodResetAt(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
