import type { EditorElement, EditorPage } from "@/store/editorStore";

type ImageElement = EditorElement & { type: "image" };

type ImageCanvasPatchResult = {
  supported: boolean;
  patch: Partial<EditorElement> | null;
  reason?: string;
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const EPSILON = 0.0001;
const ROTATION_TOLERANCE = 0.001;
const DEFAULT_ALPHA_THRESHOLD = 8;
const MAX_TRIM_SCAN_SIDE = 4096;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeScale(value: unknown) {
  const next = toNumber(value, 1);
  if (Math.abs(next) < EPSILON) return 1;
  return next;
}

function resolveSourceDimension(value: unknown, fallback: number) {
  const next = toNumber(value, fallback);
  return Math.max(1, next);
}

function resolveCurrentCrop(
  element: ImageElement,
  sourceWidth: number,
  sourceHeight: number
) {
  const cropX = clamp(toNumber(element.cropX, 0), 0, sourceWidth - 1);
  const cropY = clamp(toNumber(element.cropY, 0), 0, sourceHeight - 1);
  const cropWidth = clamp(
    toNumber(element.cropWidth, sourceWidth),
    1,
    sourceWidth - cropX
  );
  const cropHeight = clamp(
    toNumber(element.cropHeight, sourceHeight),
    1,
    sourceHeight - cropY
  );

  return { cropX, cropY, cropWidth, cropHeight };
}

function rectIntersection(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, right, bottom };
}

function visualFrameRect(element: ImageElement) {
  const width = Math.max(1, toNumber(element.width, 1));
  const height = Math.max(1, toNumber(element.height, 1));
  const scaleX = normalizeScale(element.scaleX);
  const scaleY = normalizeScale(element.scaleY);
  const x = toNumber(element.x, 0);
  const y = toNumber(element.y, 0);
  const left = scaleX >= 0 ? x : x - width;
  const top = scaleY >= 0 ? y : y - height;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    scaleX,
    scaleY,
  };
}

function toNodePositionFromVisualRect(
  visual: Rect,
  scaleX: number,
  scaleY: number
) {
  const x = scaleX >= 0 ? visual.left : visual.right;
  const y = scaleY >= 0 ? visual.top : visual.bottom;
  return { x, y };
}

function loadBrowserImage(sourceInput: string): Promise<HTMLImageElement> {
  const source = String(sourceInput || "").trim();
  if (!source) {
    return Promise.reject(new Error("Image source is required."));
  }
  if (typeof Image === "undefined") {
    return Promise.reject(new Error("Image loading is unavailable in this environment."));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error("Image metadata is unavailable."));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("Failed to load image source."));
    image.src = source;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      resolve(image);
    }
  });
}

export function isSvgDataUrlSource(sourceInput: string) {
  return /^data:image\/svg\+xml(?:;[^,]+)?,/i.test(String(sourceInput || "").trim());
}

export async function rasterizeSvgDataUrlToPngDataUrl(sourceInput: string) {
  const source = String(sourceInput || "").trim();
  if (!source) {
    throw new Error("Image source is required.");
  }
  if (!isSvgDataUrlSource(source)) {
    return source;
  }
  if (typeof document === "undefined") {
    throw new Error("SVG rasterization is only available in the browser.");
  }

  const image = await loadBrowserImage(source);
  const width = Math.max(1, Math.round(Number(image.naturalWidth) || 1));
  const height = Math.max(1, Math.round(Number(image.naturalHeight) || 1));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create a canvas for SVG rasterization.");
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

function rotateScaledLocalOffset(
  localX: number,
  localY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number
) {
  const radians = (toNumber(rotationDegrees, 0) * Math.PI) / 180;
  const scaledX = localX * scaleX;
  const scaledY = localY * scaleY;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos,
  };
}

export function canUseCanvasCropForImage(element: EditorElement | null | undefined) {
  if (!element || element.type !== "image") {
    return {
      supported: false,
      reason: "Select exactly one image layer.",
    };
  }

  if (Math.abs(toNumber(element.rotation, 0)) > ROTATION_TOLERANCE) {
    return {
      supported: false,
      reason: "Clip to Canvas currently supports non-rotated images only.",
    };
  }

  const sourceWidth = toNumber(element.sourceWidth, 0);
  const sourceHeight = toNumber(element.sourceHeight, 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      supported: false,
      reason: "Image metadata is still loading. Try again in a moment.",
    };
  }

  return { supported: true };
}

export function canTrimTransparentPaddingForImage(element: EditorElement | null | undefined) {
  if (!element || element.type !== "image") {
    return {
      supported: false,
      reason: "Select exactly one image layer.",
    };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  if (!source) {
    return {
      supported: false,
      reason: "This image has no source to analyze.",
    };
  }

  return { supported: true };
}

export async function computeTrimTransparentPaddingPatch(
  element: ImageElement,
  options: { alphaThreshold?: number } = {}
): Promise<ImageCanvasPatchResult> {
  const support = canTrimTransparentPaddingForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  if (typeof document === "undefined") {
    return {
      supported: false,
      patch: null,
      reason: "Padding trim is only available in the browser.",
    };
  }

  const source = String(element.src || element.rasterOriginalSrc || "").trim();
  let image: HTMLImageElement;
  try {
    image = await loadBrowserImage(source);
  } catch (error) {
    return {
      supported: false,
      patch: null,
      reason: error instanceof Error ? error.message : "Failed to load image for trimming.",
    };
  }

  const sourceWidth = resolveSourceDimension(
    element.sourceWidth,
    Number(image.naturalWidth || element.width || 1)
  );
  const sourceHeight = resolveSourceDimension(
    element.sourceHeight,
    Number(image.naturalHeight || element.height || 1)
  );
  const currentCrop = resolveCurrentCrop(element, sourceWidth, sourceHeight);
  const scanScale = Math.min(
    1,
    MAX_TRIM_SCAN_SIDE / Math.max(currentCrop.cropWidth, currentCrop.cropHeight, 1)
  );
  const scanWidth = Math.max(1, Math.round(currentCrop.cropWidth * scanScale));
  const scanHeight = Math.max(1, Math.round(currentCrop.cropHeight * scanScale));
  const canvas = document.createElement("canvas");
  canvas.width = scanWidth;
  canvas.height = scanHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      supported: false,
      patch: null,
      reason: "Failed to create a canvas for image trimming.",
    };
  }

  try {
    context.clearRect(0, 0, scanWidth, scanHeight);
    context.drawImage(
      image,
      currentCrop.cropX,
      currentCrop.cropY,
      currentCrop.cropWidth,
      currentCrop.cropHeight,
      0,
      0,
      scanWidth,
      scanHeight
    );
  } catch (error) {
    return {
      supported: false,
      patch: null,
      reason: error instanceof Error ? error.message : "Failed to draw image for trimming.",
    };
  }

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, scanWidth, scanHeight).data;
  } catch {
    return {
      supported: false,
      patch: null,
      reason: "This image source does not allow pixel inspection for trimming.",
    };
  }

  const alphaThreshold = clamp(
    Math.round(toNumber(options.alphaThreshold, DEFAULT_ALPHA_THRESHOLD)),
    1,
    255
  );

  let minX = scanWidth;
  let minY = scanHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < scanHeight; y += 1) {
    for (let x = 0; x < scanWidth; x += 1) {
      const alpha = pixels[(y * scanWidth + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      supported: true,
      patch: null,
      reason: "No visible pixels were detected in this image.",
    };
  }

  const trimLeftRatio = clamp(minX / scanWidth, 0, 1);
  const trimTopRatio = clamp(minY / scanHeight, 0, 1);
  const trimRightRatio = clamp((maxX + 1) / scanWidth, 0, 1);
  const trimBottomRatio = clamp((maxY + 1) / scanHeight, 0, 1);
  const trimWidthRatio = trimRightRatio - trimLeftRatio;
  const trimHeightRatio = trimBottomRatio - trimTopRatio;

  if (
    trimLeftRatio <= EPSILON &&
    trimTopRatio <= EPSILON &&
    Math.abs(trimWidthRatio - 1) <= EPSILON &&
    Math.abs(trimHeightRatio - 1) <= EPSILON
  ) {
    return {
      supported: true,
      patch: null,
      reason: "This image does not have transparent padding to trim.",
    };
  }

  const nextCropX = clamp(
    currentCrop.cropX + trimLeftRatio * currentCrop.cropWidth,
    0,
    sourceWidth - 1
  );
  const nextCropY = clamp(
    currentCrop.cropY + trimTopRatio * currentCrop.cropHeight,
    0,
    sourceHeight - 1
  );
  const nextCropWidth = clamp(
    trimWidthRatio * currentCrop.cropWidth,
    1,
    sourceWidth - nextCropX
  );
  const nextCropHeight = clamp(
    trimHeightRatio * currentCrop.cropHeight,
    1,
    sourceHeight - nextCropY
  );

  const localOffsetX = Math.max(0, toNumber(element.width, 1) * trimLeftRatio);
  const localOffsetY = Math.max(0, toNumber(element.height, 1) * trimTopRatio);
  const scaleX = normalizeScale(element.scaleX);
  const scaleY = normalizeScale(element.scaleY);
  const rotatedOffset = rotateScaledLocalOffset(
    localOffsetX,
    localOffsetY,
    scaleX,
    scaleY,
    element.rotation
  );

  return {
    supported: true,
    patch: {
      x: toNumber(element.x, 0) + rotatedOffset.x,
      y: toNumber(element.y, 0) + rotatedOffset.y,
      width: Math.max(1, toNumber(element.width, 1) * trimWidthRatio),
      height: Math.max(1, toNumber(element.height, 1) * trimHeightRatio),
      sourceWidth,
      sourceHeight,
      cropX: nextCropX,
      cropY: nextCropY,
      cropWidth: nextCropWidth,
      cropHeight: nextCropHeight,
    },
  };
}

export function computeClipToCanvasPatch(
  element: ImageElement,
  page: Pick<EditorPage, "width" | "height">
): ImageCanvasPatchResult {
  const support = canUseCanvasCropForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  const pageRect: Rect = {
    left: 0,
    top: 0,
    right: Math.max(1, toNumber(page.width, 1)),
    bottom: Math.max(1, toNumber(page.height, 1)),
  };
  const visual = visualFrameRect(element);
  const intersection = rectIntersection(
    {
      left: visual.left,
      top: visual.top,
      right: visual.right,
      bottom: visual.bottom,
    },
    pageRect
  );

  if (!intersection) {
    return {
      supported: true,
      patch: null,
      reason: "Image is fully outside the canvas.",
    };
  }

  const sourceWidth = resolveSourceDimension(element.sourceWidth, visual.width);
  const sourceHeight = resolveSourceDimension(element.sourceHeight, visual.height);
  const currentCrop = resolveCurrentCrop(element, sourceWidth, sourceHeight);

  const relLeft = clamp((intersection.left - visual.left) / visual.width, 0, 1);
  const relTop = clamp((intersection.top - visual.top) / visual.height, 0, 1);
  const relRight = clamp((intersection.right - visual.left) / visual.width, relLeft, 1);
  const relBottom = clamp((intersection.bottom - visual.top) / visual.height, relTop, 1);

  const sourceLeft =
    visual.scaleX >= 0 ? relLeft : 1 - relRight;
  const sourceRight =
    visual.scaleX >= 0 ? relRight : 1 - relLeft;
  const sourceTop =
    visual.scaleY >= 0 ? relTop : 1 - relBottom;
  const sourceBottom =
    visual.scaleY >= 0 ? relBottom : 1 - relTop;

  const nextCropX = clamp(
    currentCrop.cropX + sourceLeft * currentCrop.cropWidth,
    0,
    sourceWidth - 1
  );
  const nextCropY = clamp(
    currentCrop.cropY + sourceTop * currentCrop.cropHeight,
    0,
    sourceHeight - 1
  );
  const nextCropWidth = clamp(
    (sourceRight - sourceLeft) * currentCrop.cropWidth,
    1,
    sourceWidth - nextCropX
  );
  const nextCropHeight = clamp(
    (sourceBottom - sourceTop) * currentCrop.cropHeight,
    1,
    sourceHeight - nextCropY
  );

  const nextVisual: Rect = {
    left: intersection.left,
    top: intersection.top,
    right: intersection.right,
    bottom: intersection.bottom,
  };
  const nextPosition = toNodePositionFromVisualRect(
    nextVisual,
    visual.scaleX,
    visual.scaleY
  );

  return {
    supported: true,
    patch: {
      x: nextPosition.x,
      y: nextPosition.y,
      width: Math.max(1, intersection.right - intersection.left),
      height: Math.max(1, intersection.bottom - intersection.top),
      sourceWidth,
      sourceHeight,
      cropX: nextCropX,
      cropY: nextCropY,
      cropWidth: nextCropWidth,
      cropHeight: nextCropHeight,
    },
  };
}

export function computeFitToCanvasPatch(
  element: ImageElement,
  page: Pick<EditorPage, "width" | "height">
): ImageCanvasPatchResult {
  const support = canUseCanvasCropForImage(element);
  if (!support.supported) {
    return { supported: false, patch: null, reason: support.reason };
  }

  const pageWidth = Math.max(1, toNumber(page.width, 1));
  const pageHeight = Math.max(1, toNumber(page.height, 1));
  const imageWidth = Math.max(1, toNumber(element.width, 1));
  const imageHeight = Math.max(1, toNumber(element.height, 1));
  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;

  let nextWidth = pageWidth;
  let nextHeight = pageHeight;

  if (imageRatio > pageRatio) {
    nextHeight = pageHeight;
    nextWidth = pageHeight * imageRatio;
  } else {
    nextWidth = pageWidth;
    nextHeight = pageWidth / imageRatio;
  }

  const scaleX = normalizeScale(element.scaleX) < 0 ? -1 : 1;
  const scaleY = normalizeScale(element.scaleY) < 0 ? -1 : 1;
  const visualLeft = (pageWidth - nextWidth) / 2;
  const visualTop = (pageHeight - nextHeight) / 2;
  const positioned = {
    ...element,
    rotation: 0,
    scaleX,
    scaleY,
    width: nextWidth,
    height: nextHeight,
    ...toNodePositionFromVisualRect(
      {
        left: visualLeft,
        top: visualTop,
        right: visualLeft + nextWidth,
        bottom: visualTop + nextHeight,
      },
      scaleX,
      scaleY
    ),
  } as ImageElement;

  const clipped = computeClipToCanvasPatch(positioned, page);
  if (!clipped.supported) return clipped;

  return {
    supported: true,
    patch: {
      rotation: 0,
      scaleX,
      scaleY,
      width: nextWidth,
      height: nextHeight,
      ...toNodePositionFromVisualRect(
        {
          left: visualLeft,
          top: visualTop,
          right: visualLeft + nextWidth,
          bottom: visualTop + nextHeight,
        },
        scaleX,
        scaleY
      ),
      ...(clipped.patch || {}),
    },
  };
}
