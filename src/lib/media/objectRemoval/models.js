export const OBJECT_REMOVAL_MODEL_DEFINITIONS = [
  {
    // Our own worker (ai-worker/) running big-LaMa — same weights as
    // allenhooo/lama but on hardware we control. Selectable from the admin
    // model order once SELFHOST_AI_URL is set.
    id: "selfhost/lama",
    label: "LaMa (خادمنا)",
    provider: "selfhost",
    defaultVersion: "big-lama",
    inputImageKey: "image",
    inputMaskKey: "mask",
  },
  {
    id: "allenhooo/lama",
    label: "LaMa",
    provider: "replicate",
    defaultVersion: "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72",
    inputImageKey: "image",
    inputMaskKey: "mask",
  },
  {
    id: "zylim0702/remove-object",
    label: "Remove Object",
    provider: "replicate",
    defaultVersion: "0e3a841c913f597c1e4c321560aa69e2bc1f15c65f8c366caafc379240efd8ba",
    inputImageKey: "image",
    inputMaskKey: "mask",
  },
  {
    id: "bria/eraser",
    label: "Bria Eraser",
    provider: "replicate",
    defaultVersion: "893e924eecc119a0c5fbfa5d98401118dcbf0662574eb8d2c01be5749756cbd4",
    inputImageKey: "image_url",
    inputMaskKey: "mask_url",
  },
];

export const SUPPORTED_OBJECT_REMOVAL_MODEL_IDS = OBJECT_REMOVAL_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_OBJECT_REMOVAL_MODEL_ID = "allenhooo/lama";

export function normalizeObjectRemovalModelId(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_OBJECT_REMOVAL_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getObjectRemovalModelDefinition(modelId) {
  const normalized = normalizeObjectRemovalModelId(modelId);
  return (
    OBJECT_REMOVAL_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}

export function normalizeObjectRemovalModelOrder(value, { allowEmpty = true } = {}) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];

  for (const entry of source) {
    const modelId = normalizeObjectRemovalModelId(entry);
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    normalized.push(modelId);
  }

  if (!normalized.length && !allowEmpty) {
    return [DEFAULT_OBJECT_REMOVAL_MODEL_ID];
  }

  return normalized;
}
