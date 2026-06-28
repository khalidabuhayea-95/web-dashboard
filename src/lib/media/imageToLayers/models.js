// Models that decompose a single flat image into multiple RGBA layers.
// qwen/qwen-image-layered is an official always-on Replicate model, so it runs
// by bare slug (a pinned version is optional).
export const IMAGE_TO_LAYERS_MODEL_DEFINITIONS = [
  {
    id: "qwen/qwen-image-layered",
    label: "Qwen Image Layered",
    provider: "replicate",
    defaultVersion: "",
    inputImageKey: "image",
    layerCountKey: "num_layers",
    extraInput: {
      go_fast: true,
      description: "auto",
      output_format: "png",
      output_quality: 95,
    },
  },
];

export const SUPPORTED_IMAGE_TO_LAYERS_MODEL_IDS = IMAGE_TO_LAYERS_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_IMAGE_TO_LAYERS_MODEL_ID = "qwen/qwen-image-layered";

// qwen-image-layered accepts 2-8 layers; over-requesting tends to produce
// duplicate/hallucinated layers, so default conservatively.
export const MIN_IMAGE_TO_LAYERS_COUNT = 2;
export const MAX_IMAGE_TO_LAYERS_COUNT = 8;
export const DEFAULT_IMAGE_TO_LAYERS_COUNT = 4;

export function normalizeImageToLayersModelId(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_IMAGE_TO_LAYERS_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getImageToLayersModelDefinition(modelId) {
  const normalized = normalizeImageToLayersModelId(modelId);
  return (
    IMAGE_TO_LAYERS_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}

export function normalizeLayerCount(value, fallback = DEFAULT_IMAGE_TO_LAYERS_COUNT) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(MAX_IMAGE_TO_LAYERS_COUNT, Math.max(MIN_IMAGE_TO_LAYERS_COUNT, numeric));
}
