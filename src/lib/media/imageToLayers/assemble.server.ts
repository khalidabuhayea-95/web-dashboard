import {
  toMobileProjectSlim,
  toMobileTemplateDetailSlim,
} from "@/lib/templates/mobileProject";

import type { DecomposeImageToLayersResult } from "./index.server";

// Each decomposed RGBA layer becomes a full-canvas Fabric image object. The
// layer's alpha defines its visible shape, so position is always (0,0) at full
// size and z-order follows the array index. Feeding these through the existing
// `toMobileTemplateDetailSlim` converter yields exactly the same response shape
// as GET /api/mobile/templates/{id}.
function buildFabricObjectsFromLayers(
  layers: DecomposeImageToLayersResult["layers"],
  canvasWidth: number,
  canvasHeight: number
) {
  return layers.map((layer, index) => ({
    id: `layer-${index}`,
    type: "image",
    layerType: "image",
    layerName: index === 0 ? "Background" : `Layer ${index}`,
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    originX: "left",
    originY: "top",
    opacity: 1,
    layerLocked: false,
    layerHidden: false,
    src: layer.url,
    sourceWidth: layer.width || canvasWidth,
    sourceHeight: layer.height || canvasHeight,
    sourceHasAlpha: Boolean(layer.sourceHasAlpha),
  }));
}

export type AssembleImageLayersOptions = {
  title?: string;
  // Editable text objects (Fabric format) to overlay above the raster layers,
  // e.g. from the OCR stage. Rendered on top, in array order.
  textObjects?: Record<string, unknown>[];
};

function buildSyntheticTemplate(
  result: DecomposeImageToLayersResult,
  { title = "Imported image", textObjects = [] }: AssembleImageLayersOptions
) {
  const objects = [
    ...buildFabricObjectsFromLayers(result.layers, result.canvasWidth, result.canvasHeight),
    ...textObjects,
  ];

  // The bottom layer (index 0) is an opaque full-canvas background image, so it
  // fully covers the page background; a neutral solid keeps the data valid.
  const fabricData = {
    version: "7.0.0",
    background: { type: "color", color: "#FFFFFF" },
    objects,
  };

  const syntheticTemplate = {
    id: `img2layers-${result.predictionId || "draft"}`,
    name: title,
    version: 1,
    canvasSize: { width: result.canvasWidth, height: result.canvasHeight },
    category: "general",
    subCategory: "general",
    data: fabricData,
  };

  return { syntheticTemplate, fabricData };
}

// Full template-detail shape (same as GET /api/mobile/templates/{id}) — for the
// "create a new design from an image" use case.
export function assembleImageLayersTemplate(
  result: DecomposeImageToLayersResult,
  options: AssembleImageLayersOptions = {}
) {
  const { syntheticTemplate, fabricData } = buildSyntheticTemplate(result, options);
  return toMobileTemplateDetailSlim(syntheticTemplate, { fabricData });
}

export type AssembledImageLayers = {
  canvasWidth: number;
  canvasHeight: number;
  layers: Record<string, unknown>[];
};

// Just the layer list (in the editor's mobile layer format) — for the "explode
// one existing layer into many" use case. The caller positions the group into
// the source layer's region; `canvasWidth`/`canvasHeight` give the coordinate
// space the layer transforms live in.
export function assembleImageLayers(
  result: DecomposeImageToLayersResult,
  options: AssembleImageLayersOptions = {}
): AssembledImageLayers {
  const { syntheticTemplate, fabricData } = buildSyntheticTemplate(result, options);
  const project = toMobileProjectSlim(syntheticTemplate, { fabricData });
  return {
    canvasWidth: project.canvasWidth,
    canvasHeight: project.canvasHeight,
    layers: project.layers,
  };
}
