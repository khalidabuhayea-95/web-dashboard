// Model registry for the one-tap Magic Tools (admin API + runner + UI).
//
// Separate from src/lib/aiTemplates/models.js on purpose. That registry answers
// "can this model take a reference photo / run from a prompt alone", because a
// template's input kind decides both. A magic tool is always image in, image
// out — what varies here is whether the model takes a PROMPT at all. Upscalers,
// face restorers and colorizers do not; they are configured through numbers.
//
// Schemas verified against the Replicate API on 2026-08-13 — every model names
// its image input differently, which is the whole reason this metadata exists.
//
// `requiresPrompt`  — the tool must carry prompt text (and the admin UI demands it).
// `inputImageKey`   — the input field that receives the user's photo.
// `extraInput`      — registry defaults, overridden per tool by `modelOptions`.
// `optionFields`    — knobs the dashboard exposes for that model's modelOptions.
// `priceMicros`     — cost per run in millionths of a dollar, for margin maths.

export const MAGIC_TOOL_MODEL_DEFINITIONS = [
  {
    id: "google/nano-banana",
    label: "Nano Banana (instruction edit)",
    provider: "replicate",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    requiresPrompt: true,
    // The user's photo must come back at its own size, not reframed.
    extraInput: { output_format: "png", aspect_ratio: "match_input_image" },
    optionFields: [],
    priceMicros: 39_000,
    notes: "Understands the picture. For tools that need judgement, not just pixels.",
  },
  {
    id: "nightmareai/real-esrgan",
    label: "Real-ESRGAN (upscale + sharpen)",
    provider: "replicate",
    promptKey: null,
    inputImageKey: "image",
    imageIsArray: false,
    requiresPrompt: false,
    extraInput: { scale: 2, face_enhance: true },
    optionFields: [
      { key: "scale", label: "Upscale factor", type: "number", min: 1, max: 10 },
      { key: "face_enhance", label: "Enhance faces", type: "boolean" },
    ],
    priceMicros: 2_000,
    notes: "97M runs. Pennies per hundred images — the margin case for cheap tools.",
  },
  {
    id: "tencentarc/gfpgan",
    label: "GFPGAN (face restoration)",
    provider: "replicate",
    promptKey: null,
    inputImageKey: "img",
    imageIsArray: false,
    requiresPrompt: false,
    extraInput: { version: "v1.4", scale: 2 },
    optionFields: [{ key: "scale", label: "Upscale factor", type: "number", min: 1, max: 4 }],
    priceMicros: 3_200,
    notes: "Rebuilds degraded faces specifically. Leaves the rest of the frame alone.",
  },
  {
    id: "flux-kontext-apps/restore-image",
    label: "FLUX Restore (old photos)",
    provider: "replicate",
    promptKey: null,
    inputImageKey: "input_image",
    imageIsArray: false,
    requiresPrompt: false,
    extraInput: { output_format: "png" },
    optionFields: [],
    priceMicros: 40_000,
    notes: "Scratches, tears and fading in one pass.",
  },
  {
    id: "arielreplicate/deoldify_image",
    label: "DeOldify (colorize)",
    provider: "replicate",
    promptKey: null,
    inputImageKey: "input_image",
    imageIsArray: false,
    requiresPrompt: false,
    extraInput: { model_name: "Stable", render_factor: 35 },
    optionFields: [
      {
        key: "model_name",
        label: "Colour style",
        type: "enum",
        values: ["Stable", "Artistic"],
      },
      { key: "render_factor", label: "Render factor", type: "number", min: 10, max: 45 },
    ],
    priceMicros: 12_000,
    notes: "Stable keeps skin tones honest; Artistic is punchier but can miss people.",
  },
  {
    // Runs in-process through src/lib/media/backgroundRemoval — no API call, no
    // per-run cost, and the user's photo never leaves the server.
    id: "local/background-remover",
    label: "Background remover (self-hosted)",
    provider: "local",
    promptKey: null,
    inputImageKey: null,
    imageIsArray: false,
    requiresPrompt: false,
    extraInput: {},
    optionFields: [],
    priceMicros: 0,
    notes:
      "Free: our own rembg service (u2net), with the edge-flood remover as fallback. Returns a transparent PNG.",
  },
];

export const MAGIC_TOOL_MODEL_IDS = MAGIC_TOOL_MODEL_DEFINITIONS.map((definition) => definition.id);

export const DEFAULT_MAGIC_TOOL_MODEL_ID = "google/nano-banana";

export function normalizeMagicToolModelId(value) {
  const normalized = String(value || "").trim();
  return MAGIC_TOOL_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getMagicToolModelDefinition(modelId) {
  const normalized = normalizeMagicToolModelId(modelId);
  return MAGIC_TOOL_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null;
}

// A prompt-less model silently ignores prompt text, so a tool pointed at one
// with a prompt written for nano-banana would quietly stop doing what its
// wording says. Callers surface this instead.
export function magicToolModelIncompatibility(modelId, prompt) {
  const definition = getMagicToolModelDefinition(modelId);
  if (!definition) return "Unsupported model";
  const hasPrompt = Boolean(String(prompt || "").trim());
  if (definition.requiresPrompt && !hasPrompt) {
    return `${definition.label} needs an instruction — write the prompt for this tool.`;
  }
  if (!definition.requiresPrompt && hasPrompt) {
    return `${definition.label} takes no instruction — clear the prompt, it would be ignored.`;
  }
  return "";
}

// Merges registry defaults with the tool's own knobs, dropping any key the
// model does not declare so a stale option cannot fail the prediction.
export function resolveMagicToolOptions(definition, modelOptions) {
  const allowed = new Set((definition.optionFields || []).map((field) => field.key));
  const overrides = {};
  if (modelOptions && typeof modelOptions === "object" && !Array.isArray(modelOptions)) {
    for (const [key, value] of Object.entries(modelOptions)) {
      if (allowed.has(key) && value !== null && value !== undefined) overrides[key] = value;
    }
  }
  return { ...(definition.extraInput || {}), ...overrides };
}

export function buildMagicToolModelInput(definition, prompt, imageDataUri, modelOptions) {
  const input = resolveMagicToolOptions(definition, modelOptions);
  if (definition.promptKey && String(prompt || "").trim()) {
    input[definition.promptKey] = String(prompt).trim();
  }
  if (definition.inputImageKey && imageDataUri) {
    input[definition.inputImageKey] = definition.imageIsArray ? [imageDataUri] : imageDataUri;
  }
  return input;
}
