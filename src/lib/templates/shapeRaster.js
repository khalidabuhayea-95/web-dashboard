import { createCanvas } from "canvas";

const SHAPE_TYPES = new Set(["rect", "circle", "line", "arrow", "star"]);

function numberOr(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function isVisiblePaint(value) {
  const paint = String(value || "").trim().toLowerCase();
  return Boolean(paint && paint !== "transparent" && paint !== "none");
}

function readShapeType(item) {
  return String(item?.type || item?.layerType || "")
    .trim()
    .toLowerCase();
}

function toPointPairs(points, fallbackWidth, fallbackHeight) {
  const raw = Array.isArray(points) ? points : [];
  const pairs = [];
  for (let index = 0; index < raw.length - 1; index += 2) {
    const x = numberOr(raw[index], Number.NaN);
    const y = numberOr(raw[index + 1], Number.NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pairs.push({ x, y });
    }
  }

  if (pairs.length >= 2) return pairs;

  return [
    { x: 0, y: 0 },
    { x: Math.max(1, numberOr(fallbackWidth, 1)), y: Math.max(1, numberOr(fallbackHeight, 1)) },
  ];
}

function expandFlatBounds(minValue, maxValue, minimumSize) {
  if (maxValue - minValue >= minimumSize) {
    return { min: minValue, max: maxValue };
  }
  const center = (minValue + maxValue) / 2;
  const half = minimumSize / 2;
  return {
    min: center - half,
    max: center + half,
  };
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, safeRadius);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

export function isRasterizableShapeLayer(item) {
  return SHAPE_TYPES.has(readShapeType(item));
}

export function getShapeRasterFrame(item) {
  const shapeType = readShapeType(item);
  const strokeWidth = Math.max(1, numberOr(item?.strokeWidth, 0));

  if (shapeType === "line" || shapeType === "arrow") {
    const points = toPointPairs(item?.points, item?.width, item?.height);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const boundsX = expandFlatBounds(
      Math.min(...xs),
      Math.max(...xs),
      Math.max(2, strokeWidth)
    );
    const boundsY = expandFlatBounds(
      Math.min(...ys),
      Math.max(...ys),
      Math.max(2, strokeWidth)
    );
    return {
      width: Math.max(1, Math.ceil(boundsX.max - boundsX.min)),
      height: Math.max(1, Math.ceil(boundsY.max - boundsY.min)),
      minX: boundsX.min,
      minY: boundsY.min,
      points,
    };
  }

  return {
    width: Math.max(1, Math.ceil(numberOr(item?.width, 1))),
    height: Math.max(1, Math.ceil(numberOr(item?.height, 1))),
    minX: 0,
    minY: 0,
    points: [],
  };
}

function strokeAndFillShape(ctx, item) {
  if (isVisiblePaint(item?.fill)) {
    ctx.fillStyle = String(item.fill);
    ctx.fill();
  }

  if (numberOr(item?.strokeWidth, 0) > 0 && isVisiblePaint(item?.stroke)) {
    ctx.strokeStyle = String(item.stroke);
    ctx.lineWidth = Math.max(1, numberOr(item.strokeWidth, 0));
    ctx.stroke();
  }
}

function drawArrowHead(ctx, from, to, color, strokeWidth) {
  const pointerLength = Math.max(14, strokeWidth * 2.5);
  const pointerWidth = Math.max(14, strokeWidth * 2.5);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const halfWidth = pointerWidth / 2;

  const left = {
    x: to.x - pointerLength * Math.cos(angle) + halfWidth * Math.sin(angle),
    y: to.y - pointerLength * Math.sin(angle) - halfWidth * Math.cos(angle),
  };
  const right = {
    x: to.x - pointerLength * Math.cos(angle) - halfWidth * Math.sin(angle),
    y: to.y - pointerLength * Math.sin(angle) + halfWidth * Math.cos(angle),
  };

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function renderShapeLayerToPngBuffer(item) {
  if (!isRasterizableShapeLayer(item)) {
    throw new Error("Unsupported shape layer.");
  }

  const frame = getShapeRasterFrame(item);
  const canvas = createCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  const shapeType = readShapeType(item);
  const strokeWidth = Math.max(0, numberOr(item?.strokeWidth, 0));
  const strokeInset = strokeWidth > 0 ? strokeWidth / 2 : 0;

  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (shapeType === "rect") {
    const width = Math.max(1, frame.width - strokeInset * 2);
    const height = Math.max(1, frame.height - strokeInset * 2);
    roundRectPath(
      ctx,
      strokeInset,
      strokeInset,
      width,
      height,
      Math.max(0, numberOr(item?.cornerRadius, 0))
    );
    strokeAndFillShape(ctx, item);
    return canvas.toBuffer("image/png");
  }

  if (shapeType === "circle") {
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2 - strokeInset);
    ctx.beginPath();
    ctx.arc(frame.width / 2, frame.height / 2, radius, 0, Math.PI * 2);
    ctx.closePath();
    strokeAndFillShape(ctx, item);
    return canvas.toBuffer("image/png");
  }

  if (shapeType === "star") {
    const cx = frame.width / 2;
    const cy = frame.height / 2;
    const outerRadius = Math.max(2, Math.min(frame.width, frame.height) / 2 - strokeInset);
    const innerRadius = Math.max(1, outerRadius * 0.4);
    ctx.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const angle = (-Math.PI / 2) + (index * Math.PI) / 5;
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    strokeAndFillShape(ctx, item);
    return canvas.toBuffer("image/png");
  }

  const translatedPoints = frame.points.map((point) => ({
    x: point.x - frame.minX,
    y: point.y - frame.minY,
  }));

  ctx.beginPath();
  translatedPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });

  const strokeColor = isVisiblePaint(item?.stroke) ? String(item.stroke) : String(item?.fill || "#111827");
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1, strokeWidth || 4);
  ctx.stroke();

  if (shapeType === "arrow" && translatedPoints.length >= 2) {
    const lastPoint = translatedPoints[translatedPoints.length - 1];
    const previousPoint = translatedPoints[translatedPoints.length - 2];
    drawArrowHead(ctx, previousPoint, lastPoint, strokeColor, Math.max(1, strokeWidth || 5));
  }

  return canvas.toBuffer("image/png");
}

export function renderShapeLayerToDataUrl(item) {
  const bytes = renderShapeLayerToPngBuffer(item);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
