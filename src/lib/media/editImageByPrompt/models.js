// Prompt-based image editing models on Replicate.
//
// Each model takes an existing image + a natural-language instruction and returns
// the edited image. The per-model input shape differs (this is the key gotcha):
//   - `inputImageKey`  : the input field that receives the source image URL.
//   - `imageIsArray`   : whether that field expects an array of URLs (vs a single string).
//   - `promptKey`      : the input field that receives the text instruction.
//   - `extraInput`     : static extra inputs to send (e.g. aspect ratio / output format).
//
// All three are official, always-on Replicate models, so they can be run by bare
// slug via `POST /models/{owner}/{name}/predictions` (no version hash required).
// `defaultVersion` is left empty for that reason; pin a version hash here (or via
// IMAGE_EDIT_REPLICATE_VERSION for the default model) for reproducible output.
export const EDIT_IMAGE_MODEL_DEFINITIONS = [
  {
    id: "google/nano-banana",
    label: "Nano Banana (Gemini 2.5 Flash Image)",
    provider: "replicate",
    defaultVersion: "",
    promptKey: "prompt",
    inputImageKey: "image_input",
    imageIsArray: true,
    extraInput: { output_format: "png" },
  },
  {
    id: "qwen/qwen-image-edit-plus",
    label: "Qwen-Image-Edit Plus",
    provider: "replicate",
    defaultVersion: "",
    promptKey: "prompt",
    inputImageKey: "image",
    imageIsArray: true,
    extraInput: { output_format: "png" },
  },
  {
    id: "black-forest-labs/flux-kontext-pro",
    label: "FLUX.1 Kontext [pro]",
    provider: "replicate",
    defaultVersion: "",
    promptKey: "prompt",
    inputImageKey: "input_image",
    imageIsArray: false,
    extraInput: { aspect_ratio: "match_input_image", output_format: "png" },
  },
];

export const SUPPORTED_EDIT_IMAGE_MODEL_IDS = EDIT_IMAGE_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_EDIT_IMAGE_MODEL_ID = "google/nano-banana";

export function normalizeEditImageModelId(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_EDIT_IMAGE_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getEditImageModelDefinition(modelId) {
  const normalized = normalizeEditImageModelId(modelId);
  return (
    EDIT_IMAGE_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}
