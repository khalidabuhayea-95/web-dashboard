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
