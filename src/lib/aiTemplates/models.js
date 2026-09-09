// Model registry for the AI Templates catalog (renderer + admin API + UI).
//
// This is deliberately separate from src/lib/media/editImageByPrompt/models.js:
// that file is the allowlist for the MOBILE edit-image route and must stay
// edit-capable-only, while this catalog also carries text-to-image models for
// generation-only templates. Schemas verified against the Replicate API on
// 2026-08-12 — each model names its image input differently, which is the
// whole reason this metadata exists.
//
// `supportsImageInput`  — can take a reference photo (identity-locked edits).
// `supportsTextToImage` — can run from a prompt alone (reference "none").
// `extraInput`          — static extras for edit runs. Every edit-capable model
//                         pins aspect_ratio to the INPUT frame: an AI tool must
//                         hand back the user's photo at its own size, never
//                         reframed to a poster ratio.
// `t2iExtraInput`       — static extras for prompt-only runs (card aspect 3:4).
// `priceMicros`         — per-image cost estimate for spend maths, from vendor
//                         pricing pages 2026-08-12; the model page is canonical.
//
// ★THE CATALOG RUNS ON EXACTLY TWO MODELS, and a template picks one by a single
// question: does its IMAGE have to contain Arabic text?
//   no  → google/nano-banana    $0.039 → 100 credits
//   yes → google/nano-banana-2  $0.067 → 175 credits
// There is no "premium" tier. 175 is a floor, not a suggestion: nano-banana-2
// breaks even at 134 credits ($0.0005/credit anchor), so an Arabic template
// left at 100 sells every render at a loss — a Plus subscriber burning their
// whole 10,000-credit allowance that way costs $6.70 against $4.24 of net
// revenue. The models below this line stay registered for bake-offs only.

export const AI_TEMPLATE_MODEL_DEFINITIONS = [
  {
    id: "google/nano-banana",
    label: "Nano Banana (Gemini 2.5 Flash Image)",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    supportsImageInput: true,
    supportsTextToImage: true,
    extraInput: { output_format: "png", aspect_ratio: "match_input_image" },
    t2iExtraInput: { output_format: "png", aspect_ratio: "3:4" },
    priceMicros: 39_000,
    notes: "Current default. Best face identity in edits; weak Arabic lettering.",
  },
  {
    id: "qwen/qwen-image-edit-plus",
    label: "Qwen-Image-Edit Plus",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image",
    imageIsArray: true,
    supportsImageInput: true,
    supportsTextToImage: false,
    extraInput: { output_format: "png" },
    t2iExtraInput: {},
    priceMicros: 30_000,
    notes: "Instruction edits, Apache-2.0 family. Bake off identity vs nano-banana.",
  },
  {
    id: "black-forest-labs/flux-kontext-pro",
    label: "FLUX.1 Kontext [pro]",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "input_image",
    imageIsArray: false,
    supportsImageInput: true,
    supportsTextToImage: false,
    extraInput: { aspect_ratio: "match_input_image", output_format: "png" },
    t2iExtraInput: {},
    priceMicros: 40_000,
    notes: "Edit-focused; no Arabic claims.",
  },
  {
    id: "qwen/qwen-image",
    label: "Qwen-Image (text-to-image)",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image",
    imageIsArray: false,
    supportsImageInput: true,
    supportsTextToImage: true,
    extraInput: { output_format: "png" },
    t2iExtraInput: { output_format: "png", aspect_ratio: "3:4" },
    priceMicros: 20_000,
    notes:
      "Typography leader (EN/ZH; Arabic tested 2026-08-13: gibberish). Image input is strength-based img2img, not an instruction edit — expect weaker identity than the edit models.",
  },
  // Arabic bake-off 2026-08-13 (same bilingual banner prompt on 7 models):
  // v3-turbo, qwen-image, qwen-image-2 and seedream-4.5 all rendered Arabic as
  // gibberish; only the ideogram v4 family and nano-banana-pro survived. v4
  // renders headlines correctly but is unreliable on digits/fine print (turbo
  // wrote "00%" + one wrong dot; balanced spelled everything right but swapped
  // ٥٠ for ٧٥), so use it for cheap generated Arabic art where exact numbers
  // don't matter — nano-banana-pro stays the only fully reliable Arabic model.
  {
    id: "ideogram-ai/ideogram-v4-turbo",
    label: "Ideogram v4 Turbo",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image",
    imageIsArray: false,
    supportsImageInput: false, // text-to-image only
    supportsTextToImage: true,
    extraInput: {},
    t2iExtraInput: { aspect_ratio: "3:4" },
    priceMicros: 30_000,
    notes:
      "Cheapest usable Arabic: headlines render correctly, but digits/fine print are unreliable. Generation only.",
  },
  {
    id: "ideogram-ai/ideogram-v4-balanced",
    label: "Ideogram v4 Balanced",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image",
    imageIsArray: false,
    supportsImageInput: false, // text-to-image only
    supportsTextToImage: true,
    extraInput: {},
    t2iExtraInput: { aspect_ratio: "3:4" },
    priceMicros: 60_000,
    notes:
      "Arabic spelling accurate in testing but may swap numerals — verify any digits. Generation only.",
  },
  {
    id: "bytedance/seedream-4.5",
    label: "Seedream 4.5",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    supportsImageInput: true,
    supportsTextToImage: true,
    extraInput: { aspect_ratio: "match_input_image" },
    t2iExtraInput: { aspect_ratio: "3:4" },
    priceMicros: 40_000,
    notes:
      "Strong spatial/world knowledge; EN/ZH text focus (Arabic tested 2026-08-13: gibberish). Outputs 2K.",
  },
  {
    // ★The Arabic default. On 2026-09-03 this rendered «حج مبرور وسعي مشكور»
    // correctly on 5/5 runs of the real Hajj template, held the reference face,
    // and did it in 8.5–10.9s — against seedream-5-pro's 57–100s, one run of
    // which hung for 571s. It costs $0.022 more per image and is worth it.
    // `resolution: "1K"` is pinned even though 1K is today's default: the 2K
    // tier costs $0.101, and a vendor-side default flip must not silently
    // inflate our bill — which is exactly what seedream-5-pro's 2K default did.
    id: "google/nano-banana-2",
    label: "Nano Banana 2 (نص عربي — الأسرع)",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    supportsImageInput: true,
    supportsTextToImage: true,
    extraInput: { output_format: "png", resolution: "1K", aspect_ratio: "match_input_image" },
    t2iExtraInput: { output_format: "png", resolution: "1K", aspect_ratio: "3:4" },
    priceMicros: 67_000,
    notes:
      "Use for every template whose IMAGE must contain Arabic text. Spells Arabic correctly, ~10s, holds identity as well as nano-banana. Keep resolution at 1K ($0.067; 2K $0.101, 4K $0.151) and upscale with our own worker.",
  },
  {
    // The only model that officially trains on Arabic text (RTL + joined
    // letters), and the one that got "عيد مبارك" right in the 2026-09-02
    // bake-off where nano-banana wrote "عصيناك" and seedream-4.5 "الهْ عطان".
    // `size: "1K"` is pinned deliberately: the model DEFAULTS to 2K, which
    // Replicate bills at $0.09 instead of $0.05 for output our own upscaler
    // can produce for free.
    id: "bytedance/seedream-5-pro",
    label: "Seedream 5.0 Pro (نص عربي)",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    supportsImageInput: true,
    supportsTextToImage: true,
    extraInput: { size: "1K", aspect_ratio: "match_input_image" },
    t2iExtraInput: { size: "1K", aspect_ratio: "3:4" },
    priceMicros: 50_000,
    notes:
      "SUPERSEDED by google/nano-banana-2 for Arabic — kept as the fallback if that ever regresses. Spells Arabic correctly but is SLOW and erratic: measured 57s/58s/58s/75s/95s/100s and one run that hung 571s on an input that had just finished in 58s. The wait is upstream (ByteDance), not resolution: 4.0MP took 57.4s while 2.0MP took 74.6s. Keep size at 1K.",
  },
  {
    id: "google/nano-banana-pro",
    label: "Nano Banana Pro (Gemini 3 Pro Image)",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    supportsImageInput: true,
    supportsTextToImage: true,
    extraInput: { output_format: "png", aspect_ratio: "match_input_image" },
    t2iExtraInput: { output_format: "png", aspect_ratio: "3:4" },
    priceMicros: 134_000,
    notes:
      "Arabic-correct and takes image input, but $0.15 at BOTH 1K and 2K — pinning resolution saves nothing here — and its latency spread is wide: 21s to 110s over 8 measured runs. nano-banana-2 matches its Arabic accuracy while being faster and cheaper; keep this only for hero art that needs Pro-grade rendering.",
  },
];

export const AI_TEMPLATE_MODEL_IDS = AI_TEMPLATE_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_AI_TEMPLATE_MODEL_ID = "google/nano-banana";

export function normalizeAiTemplateModelId(value) {
  const normalized = String(value || "").trim();
  return AI_TEMPLATE_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getAiTemplateModelDefinition(modelId) {
  const normalized = normalizeAiTemplateModelId(modelId);
  return (
    AI_TEMPLATE_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}

// Assembles the provider payload for one run. When imageDataUri is null the
// run is a pure generation: prompt only, card-shape extras, and never a sample
// photo the model would then try to edit.
export function buildAiTemplateModelInput(definition, prompt, imageDataUri) {
  return {
    [definition.promptKey]: prompt,
    ...(imageDataUri
      ? { [definition.inputImageKey]: definition.imageIsArray ? [imageDataUri] : imageDataUri }
      : {}),
    ...((imageDataUri ? definition.extraInput : definition.t2iExtraInput) || {}),
  };
}

// A template's model must be able to run it: an input-locked template needs a
// model that accepts a reference photo, a generation-only template needs
// text-to-image. Returns "" when compatible, else a human-readable reason.
export function aiTemplateModelIncompatibility(modelId, referenceKind) {
  const definition = getAiTemplateModelDefinition(modelId);
  if (!definition) return "Unsupported model";
  if (referenceKind === "none" && !definition.supportsTextToImage) {
    return `${definition.label} cannot generate from a prompt alone — pick an input photo kind or another model`;
  }
  if (referenceKind !== "none" && !definition.supportsImageInput) {
    return `${definition.label} cannot edit an input photo — set the input kind to "none" or another model`;
  }
  return "";
}
