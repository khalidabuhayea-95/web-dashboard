export const AI_EXPAND_MODEL_DEFINITIONS = [
  {
    id: "allenhooo/lama",
    label: "LaMa",
    provider: "replicate",
    defaultVersion: "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72",
    kind: "mask-fill",
  },
  {
    id: "luma/reframe-image",
    label: "Luma Reframe Image",
    provider: "replicate",
    defaultVersion: "216c39650aa40806006ffb948f3f01b6eee1e2a73a5ebd3727be3f52ba5a0b77",
    kind: "luma-reframe",
  },
  {
    id: "bria/expand-image",
    label: "Bria Expand Image",
    provider: "replicate",
    defaultVersion: "4c30b242c0c7cf9f1425a581a1b4fc4d830527063a90d8f6547b0aa343493c1b",
    kind: "bria-expand",
  },
];

export const SUPPORTED_AI_EXPAND_MODEL_IDS = AI_EXPAND_MODEL_DEFINITIONS.map(
  (definition) => definition.id
);

export const DEFAULT_AI_EXPAND_MODEL_ID = "bria/expand-image";

export function normalizeAiExpandModelId(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_AI_EXPAND_MODEL_IDS.includes(normalized) ? normalized : "";
}

export function getAiExpandModelDefinition(modelId) {
  const normalized = normalizeAiExpandModelId(modelId);
  return (
    AI_EXPAND_MODEL_DEFINITIONS.find((definition) => definition.id === normalized) || null
  );
}
