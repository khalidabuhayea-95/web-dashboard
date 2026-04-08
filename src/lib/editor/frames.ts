export type FrameShapeKind = "rect" | "circle" | "polygon" | "star" | "burst";
export type FrameFitMode = "cover" | "contain" | "manual";
export type FrameContentKind = "image" | "video";

export interface FramePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  kind: FrameShapeKind;
  points?: number[];
  cornerRadius?: number;
  keywords: string[];
}

export interface FrameShape {
  presetId: string;
  kind: FrameShapeKind;
  points?: number[];
  cornerRadius?: number;
}

export interface FrameContent {
  kind: FrameContentKind;
  src: string;
  sourceWidth?: number;
  sourceHeight?: number;
  posterSrc?: string;
  videoStart?: number;
  videoEnd?: number;
  videoDuration?: number;
}

export interface FrameContentTransform {
  fit: FrameFitMode;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface FrameMediaLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_FRAME_CONTENT_TRANSFORM: FrameContentTransform = {
  fit: "cover",
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

function polygonPoints(
  sides: number,
  cx = 50,
  cy = 50,
  radius = 46,
  rotationDegrees = -90
) {
  const points: number[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = ((rotationDegrees + (360 / sides) * index) * Math.PI) / 180;
    points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return points;
}

function starPoints(
  pointsCount: number,
  cx = 50,
  cy = 50,
  outerRadius = 46,
  innerRadius = 22,
  rotationDegrees = -90
) {
  const points: number[] = [];
  const totalPoints = pointsCount * 2;
  for (let index = 0; index < totalPoints; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = ((rotationDegrees + (360 / totalPoints) * index) * Math.PI) / 180;
    points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return points;
}

export const FRAME_PRESETS: FramePreset[] = [
  {
    id: "frame-circle",
    name: "Circle",
    width: 160,
    height: 160,
    kind: "circle",
    keywords: ["circle", "round", "portrait"],
  },
  {
    id: "frame-rounded-square",
    name: "Rounded square",
    width: 160,
    height: 160,
    kind: "rect",
    cornerRadius: 18,
    keywords: ["rounded", "square", "photo"],
  },
  {
    id: "frame-square",
    name: "Square",
    width: 160,
    height: 160,
    kind: "rect",
    keywords: ["square", "photo"],
  },
  {
    id: "frame-diamond",
    name: "Diamond",
    width: 160,
    height: 160,
    kind: "polygon",
    points: [50, 2, 98, 50, 50, 98, 2, 50],
    keywords: ["diamond", "rhombus"],
  },
  {
    id: "frame-inverted-triangle",
    name: "Inverted triangle",
    width: 160,
    height: 160,
    kind: "polygon",
    points: [4, 8, 96, 8, 50, 98],
    keywords: ["triangle", "inverted"],
  },
  {
    id: "frame-trapezoid",
    name: "Trapezoid",
    width: 180,
    height: 150,
    kind: "polygon",
    points: [18, 8, 82, 8, 98, 94, 2, 94],
    keywords: ["trapezoid", "badge"],
  },
  {
    id: "frame-pentagon",
    name: "Pentagon",
    width: 170,
    height: 160,
    kind: "polygon",
    points: polygonPoints(5, 50, 52, 47, -90),
    keywords: ["pentagon", "badge"],
  },
  {
    id: "frame-hexagon",
    name: "Hexagon",
    width: 170,
    height: 150,
    kind: "polygon",
    points: polygonPoints(6, 50, 50, 47, 30),
    keywords: ["hexagon", "badge"],
  },
  {
    id: "frame-star",
    name: "Star",
    width: 180,
    height: 170,
    kind: "star",
    points: starPoints(5, 50, 52, 48, 22, -90),
    keywords: ["star"],
  },
  {
    id: "frame-kite",
    name: "Kite",
    width: 180,
    height: 130,
    kind: "polygon",
    points: [50, 3, 96, 48, 50, 94, 4, 48],
    keywords: ["kite", "diamond", "wide"],
  },
  {
    id: "frame-octagon",
    name: "Octagon",
    width: 170,
    height: 160,
    kind: "polygon",
    points: polygonPoints(8, 50, 50, 47, 22.5),
    keywords: ["octagon", "tag"],
  },
  {
    id: "frame-burst",
    name: "Burst",
    width: 180,
    height: 180,
    kind: "burst",
    points: starPoints(14, 50, 50, 48, 39, -90),
    keywords: ["burst", "seal", "badge"],
  },
  {
    id: "frame-scallop-circle",
    name: "Scallop circle",
    width: 180,
    height: 180,
    kind: "burst",
    points: starPoints(24, 50, 50, 48, 43, -90),
    keywords: ["scallop", "circle", "seal"],
  },
  {
    id: "frame-scallop-badge",
    name: "Scallop badge",
    width: 190,
    height: 170,
    kind: "burst",
    points: starPoints(18, 50, 50, 48, 39, -90),
    keywords: ["scallop", "badge"],
  },
  {
    id: "frame-tag-left",
    name: "Left tag",
    width: 190,
    height: 140,
    kind: "polygon",
    points: [0, 50, 18, 12, 96, 12, 96, 88, 18, 88],
    keywords: ["tag", "arrow", "left"],
  },
  {
    id: "frame-tag-right",
    name: "Right tag",
    width: 190,
    height: 140,
    kind: "polygon",
    points: [4, 12, 82, 12, 100, 50, 82, 88, 4, 88],
    keywords: ["tag", "arrow", "right"],
  },
];

const FRAME_PRESET_BY_ID = new Map(FRAME_PRESETS.map((preset) => [preset.id, preset]));

export function resolveFramePreset(presetId: string | null | undefined) {
  return FRAME_PRESET_BY_ID.get(String(presetId || "").trim()) || FRAME_PRESETS[0];
}

export function createFrameShapeFromPreset(presetId: string): FrameShape {
  const preset = resolveFramePreset(presetId);
  return {
    presetId: preset.id,
    kind: preset.kind,
    ...(Array.isArray(preset.points) ? { points: [...preset.points] } : {}),
    ...(Number.isFinite(Number(preset.cornerRadius)) ? { cornerRadius: preset.cornerRadius } : {}),
  };
}

export function normalizeFrameContentTransform(
  transform: Partial<FrameContentTransform> | null | undefined
): FrameContentTransform {
  const fit = transform?.fit === "contain" || transform?.fit === "manual" ? transform.fit : "cover";
  const scale = Number(transform?.scale);
  const offsetX = Number(transform?.offsetX);
  const offsetY = Number(transform?.offsetY);
  return {
    fit,
    scale: Number.isFinite(scale) && scale > 0 ? Math.min(8, Math.max(0.1, scale)) : 1,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
  };
}

export function resolveFrameContentLayout(
  frameWidth: number,
  frameHeight: number,
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
  transform: Partial<FrameContentTransform> | null | undefined
): FrameMediaLayout {
  const width = Math.max(1, Number(frameWidth) || 1);
  const height = Math.max(1, Number(frameHeight) || 1);
  const contentWidth = Math.max(1, Number(sourceWidth) || width);
  const contentHeight = Math.max(1, Number(sourceHeight) || height);
  const safeTransform = normalizeFrameContentTransform(transform);
  const baseScale =
    safeTransform.fit === "manual"
      ? 1
      : safeTransform.fit === "contain"
        ? Math.min(width / contentWidth, height / contentHeight)
        : Math.max(width / contentWidth, height / contentHeight);
  const resolvedScale = Math.max(0.01, baseScale * safeTransform.scale);
  const renderedWidth = contentWidth * resolvedScale;
  const renderedHeight = contentHeight * resolvedScale;
  return {
    x: (width - renderedWidth) / 2 + safeTransform.offsetX,
    y: (height - renderedHeight) / 2 + safeTransform.offsetY,
    width: renderedWidth,
    height: renderedHeight,
  };
}

export function pointIntersectsFrameBounds(
  element: { x: number; y: number; width: number; height: number; rotation?: number; scaleX?: number; scaleY?: number },
  point: { x: number; y: number }
) {
  const width = Math.max(1, Number(element.width || 1) * Math.abs(Number(element.scaleX || 1)));
  const height = Math.max(1, Number(element.height || 1) * Math.abs(Number(element.scaleY || 1)));
  const radians = -(((Number(element.rotation || 0) % 360) * Math.PI) / 180);
  const centerX = Number(element.x || 0) + width / 2;
  const centerY = Number(element.y || 0) + height / 2;
  const dx = Number(point.x || 0) - centerX;
  const dy = Number(point.y || 0) - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians) + width / 2;
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians) + height / 2;
  return localX >= 0 && localX <= width && localY >= 0 && localY <= height;
}
