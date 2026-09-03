export const IMAGE_UPSCALE_MODEL_DEFINITIONS = [
  {
    // Real-ESRGAN x4plus on our own worker (ai-worker/pipelines/upscale.py) —
    // the very weights the Replicate entries below wrap, so this is a cost
    // change, not a quality one.
    id: "selfhost/real-esrgan",
    label: "Real-ESRGAN (خادمنا)",
    provider: "selfhost",
    defaultVersion: "real-esrgan-x4plus",
    kind: "real-esrgan-scale",
  },
  {
    id: "prunaai/p-image-upscale",
    label: "Pruna Image Upscale",
    provider: "replicate",
    defaultVersion: "80dc6fbdb8433a6878adb3c0908290e88ad5943b3d729a9155cc8dbd143c1d5d",
    kind: "pruna",
  },
  {
    id: "recraft-ai/recraft-crisp-upscale",
    label: "Recraft Crisp Upscale",
    provider: "replicate",
    defaultVersion: "2177c1e3a177f5a76c632e467c32b413e424c23d84e43f7b036a965e305f6557",
    kind: "recraft-crisp",
  },
  {
    id: "cjwbw/real-esrgan",
    label: "Real-ESRGAN (cjwbw)",
    provider: "replicate",
    defaultVersion: "d0ee3d708c9b911f122a4ad90046c5d26a0293b99476d697f6bb7f2e251ce2d4",
    kind: "cjwbw-esrgan",
  },
  {
    id: "google/upscaler",
    label: "Google Upscaler",
    provider: "replicate",
    defaultVersion: "76a1667e31f011c9c79f104281cfbf0c6545d91320a958f8471808eb4c94b302",
    kind: "google",
  },
  {
    id: "nightmareai/real-esrgan",
    label: "Real-ESRGAN (nightmareai)",
    provider: "replicate",
    defaultVersion: "b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
    kind: "real-esrgan-scale",
  },
  {
    id: "alexgenovese/upscaler",
    label: "AlexGenovese Upscaler",
    provider: "replicate",
    defaultVersion: "4f7eb3da655b5182e559d50a0437440f242992d47e5e20bd82829a79dee61ff3",
    kind: "real-esrgan-scale",
  },
];

export const SUPPORTED_IMAGE_UPSCALE_MODEL_IDS = IMAGE_UPSCALE_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_IMAGE_UPSCALE_MODEL_ID = "prunaai/p-image-upscale";

export function normalizeImageUpscaleModelId(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_IMAGE_UPSCALE_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getImageUpscaleModelDefinition(modelId) {
  const normalized = normalizeImageUpscaleModelId(modelId);
  return (
    IMAGE_UPSCALE_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}
