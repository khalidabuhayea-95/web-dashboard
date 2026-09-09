// Model registry for text-to-image generation (mobile route + admin settings).
//
// Separate from the AI-templates and Magic-Tools registries because this feature
// has no input image at all: the user types a sentence and gets a picture. What
// varies between these models is the aspect-ratio contract and whether the text
// encoder understands the prompt language.
//
// ★EVERY model here is English-only at the encoder. Arabic prompts are
// translated before the call (see translatePromptToEnglish) — measured
// 2026-09-03 at 0.4–1.1s through Google's free endpoint, which is what lets the
// $0.003 model serve an Arabic-speaking app. An Arabic-native encoder starts at
// $0.034 (nano-banana-2-lite), eleven times dearer, and the whole point of this
// feature is that a generated scene should cost almost nothing.
//
// `aspectRatios` — the app's picker offers exactly these, in this order.
// `priceMicros`  — per-image cost in millionths of a dollar.

// The picker in the app. Matches what a poster/story author actually needs.
export const IMAGE_GENERATION_ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16"];

export const IMAGE_GENERATION_MODEL_DEFINITIONS = [
  {
    // Verified 2026-09-03 on five Arabic prompts through the translation path:
    // 4.0–5.8s per image, photoreal 1024², prompts followed faithfully.
    // Known limit, by design not defect: any lettering it invents is nonsense
    // ("PAUNDE LUSTE PARFUM" on a perfume bottle). This feature sells SCENES.
    // Real words are the editor's text layers, or a text-capable model at 20x.
    id: "black-forest-labs/flux-schnell",
    label: "FLUX.1 schnell (الأرخص)",
    provider: "replicate",
    promptKey: "prompt",
    aspectRatioKey: "aspect_ratio",
    aspectRatios: IMAGE_GENERATION_ASPECT_RATIOS,
    // megapixels "1" is the 1024² tier; "0.25" halves the resolution for the
    // same price, so there is no reason to drop it.
    extraInput: { megapixels: "1", output_format: "png", num_outputs: 1, go_fast: true },
    priceMicros: 3_000,
    notes:
      "Default. $0.003/image, 4–6s. Apache-2.0, so it can move to our own worker later and cost nothing.",
  },
  {
    id: "google/imagen-4-fast",
    label: "Imagen 4 Fast",
    provider: "replicate",
    promptKey: "prompt",
    aspectRatioKey: "aspect_ratio",
    // Imagen only accepts these five; 4:5 and 2:3 are NOT among them, so the
    // app's picker must fall back to the nearest ratio when this model is on.
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    extraInput: { output_format: "jpg" },
    priceMicros: 20_000,
    notes: "Higher fidelity than schnell at ~7x the price. Missing the 4:5 and 2:3 ratios.",
  },
  {
    id: "google/nano-banana-2-lite",
    label: "Nano Banana 2 Lite (يفهم العربي مباشرة)",
    provider: "replicate",
    promptKey: "prompt",
    aspectRatioKey: "aspect_ratio",
    aspectRatios: IMAGE_GENERATION_ASPECT_RATIOS,
    extraInput: { output_format: "png" },
    priceMicros: 34_000,
    notes:
      "The escape hatch if the translation endpoint ever fails us: Gemini reads Arabic natively, so no translation step. Eleven times the cost of schnell.",
  },
];

export const IMAGE_GENERATION_MODEL_IDS = IMAGE_GENERATION_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_IMAGE_GENERATION_MODEL_ID = "black-forest-labs/flux-schnell";

export function getImageGenerationModelDefinition(modelId) {
  const normalized = String(modelId || "").trim();
  return (
    IMAGE_GENERATION_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}

export function normalizeImageGenerationModelId(value) {
  const normalized = String(value || "").trim();
  return IMAGE_GENERATION_MODEL_IDS.includes(normalized) ? normalized : "";
}

/**
 * The closest ratio the model actually supports. A picker offering 4:5 must not
 * silently produce a square when the admin switches to a model without it.
 */
export function resolveAspectRatio(definition, requested) {
  const wanted = String(requested || "").trim();
  const supported = definition?.aspectRatios || IMAGE_GENERATION_ASPECT_RATIOS;
  if (supported.includes(wanted)) return wanted;
  if (!wanted) return supported[0];

  const value = (ratio) => {
    const [w, h] = ratio.split(":").map(Number);
    return h > 0 ? w / h : 1;
  };
  const target = value(wanted);
  return supported.reduce((best, ratio) =>
    Math.abs(value(ratio) - target) < Math.abs(value(best) - target) ? ratio : best
  );
}

export function buildImageGenerationInput(definition, prompt, aspectRatio) {
  return {
    ...(definition.extraInput || {}),
    [definition.promptKey]: prompt,
    [definition.aspectRatioKey]: resolveAspectRatio(definition, aspectRatio),
  };
}
