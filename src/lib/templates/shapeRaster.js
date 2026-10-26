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

// `radius` may be a single number or a per-corner list [topLeft, topRight, bottomRight, bottomLeft]
// (the editor's per-corner rounding mask resolves to the list form).
function roundRectPath(ctx, x, y, width, height, radius) {
  const clampRadius = (value) => Math.min(Math.max(0, numberOr(value, 0)), width / 2, height / 2);
  const radii = Array.isArray(radius)
    ? [clampRadius(radius[0]), clampRadius(radius[1]), clampRadius(radius[2]), clampRadius(radius[3])]
    : (() => {
        const safe = clampRadius(radius);
        return [safe, safe, safe, safe];
      })();
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radii);
    return;
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = radii;
  ctx.beginPath();
  ctx.moveTo(x + topLeft, y);
  ctx.arcTo(x + width, y, x + width, y + height, topRight);
  ctx.arcTo(x + width, y + height, x, y + height, bottomRight);
  ctx.arcTo(x, y + height, x, y, bottomLeft);
  ctx.arcTo(x, y, x + width, y, topLeft);
  ctx.closePath();
}

// The editor stores one `cornerRadius` plus an optional per-corner enable mask; disabled corners
// stay sharp. Absent mask = all corners rounded.
function resolveRectCornerRadii(item) {
  const radius = Math.max(0, numberOr(item?.cornerRadius, 0));
  const corners = item?.cornerRadiusCorners;
  if (!corners || typeof corners !== "object") return radius;
  return [
    corners.topLeft !== false ? radius : 0,
    corners.topRight !== false ? radius : 0,
    corners.bottomRight !== false ? radius : 0,
    corners.bottomLeft !== false ? radius : 0,
  ];
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
      resolveRectCornerRadii(item)
    );
    strokeAndFillShape(ctx, item);
    return canvas.toBuffer("image/png");
  }

  if (shapeType === "circle") {
    // The ellipse inscribed in the box — the editor's canvas draws the same, so a stretched circle
    // reaches the app as the oval it is (a square box stays a circle).
    const radiusX = Math.max(1, frame.width / 2 - strokeInset);
    const radiusY = Math.max(1, frame.height / 2 - strokeInset);
    ctx.beginPath();
    ctx.ellipse(frame.width / 2, frame.height / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
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

// ── SVG twin of the PNG above ───────────────────────────────────────────────────────────────────
// The app draws a template's rect/circle/line/arrow/star from an asset. As a PNG at the box's own
// size it was upscaled ~3× on a phone (an A6 page is 397 px wide) and looked pixelated; the SVG has
// the SAME geometry, flagged `assetKind: "vector"`, so the app redraws it at its on-screen size.
// Colours are written as #rrggbb + a separate opacity: the app's vector recolor sheet reads hex.

let paintProbe = null;

/**
 * A CSS colour as { hex, opacity }; `null` = paints nothing (empty, "none", fully transparent);
 * `undefined` = can't be read (the PNG path is kept then).
 */
function readSvgPaint(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (!isVisiblePaint(value)) return null;
  paintProbe ||= createCanvas(1, 1).getContext("2d");
  const sentinel = "#010203";
  paintProbe.fillStyle = sentinel;
  paintProbe.fillStyle = value.trim();
  const resolved = String(paintProbe.fillStyle).toLowerCase();
  if (resolved === sentinel && value.trim().toLowerCase() !== sentinel) return undefined;
  if (/^#[0-9a-f]{6}$/.test(resolved)) return { hex: resolved, opacity: 1 };
  const rgba = resolved.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!rgba) return undefined;
  const hex = `#${[rgba[1], rgba[2], rgba[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  const opacity = rgba[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgba[4])));
  return opacity > 0 ? { hex, opacity } : null;
}

/** The paint to draw, or null for none — call only after canRenderShapeLayerAsSvg. */
const svgPaint = (value) => readSvgPaint(value) ?? null;

const svgNumber = (value) => String(Math.round(value * 1000) / 1000);

function svgPaintAttrs(kind, paint) {
  if (!paint) return `${kind}="none"`;
  return paint.opacity < 1
    ? `${kind}="${paint.hex}" ${kind}-opacity="${svgNumber(paint.opacity)}"`
    : `${kind}="${paint.hex}"`;
}

/**
 * Whether the shape's paints can be written as SVG colours. A paint the canvas can't read either
 * (e.g. a gradient object) keeps the PNG path, so nothing changes for it.
 */
export function canRenderShapeLayerAsSvg(item) {
  if (!isRasterizableShapeLayer(item)) return false;
  return readSvgPaint(item?.fill) !== undefined && readSvgPaint(item?.stroke) !== undefined;
}

function roundRectSvgPath(x, y, width, height, radius) {
  const clampRadius = (value) => Math.min(Math.max(0, numberOr(value, 0)), width / 2, height / 2);
  const [tl, tr, br, bl] = Array.isArray(radius)
    ? radius.map(clampRadius)
    : [clampRadius(radius), clampRadius(radius), clampRadius(radius), clampRadius(radius)];
  const n = svgNumber;
  const arc = (r, toX, toY) => (r > 0 ? ` A ${n(r)} ${n(r)} 0 0 1 ${n(toX)} ${n(toY)}` : "");
  return (
    `M ${n(x + tl)} ${n(y)}` +
    ` L ${n(x + width - tr)} ${n(y)}${arc(tr, x + width, y + tr)}` +
    ` L ${n(x + width)} ${n(y + height - br)}${arc(br, x + width - br, y + height)}` +
    ` L ${n(x + bl)} ${n(y + height)}${arc(bl, x, y + height - bl)}` +
    ` L ${n(x)} ${n(y + tl)}${arc(tl, x + tl, y)} Z`
  );
}

/** The shape as an SVG document string, or null when its paints can't be expressed (use the PNG). */
export function renderShapeLayerToSvg(item) {
  if (!canRenderShapeLayerAsSvg(item)) return null;
  const frame = getShapeRasterFrame(item);
  const shapeType = readShapeType(item);
  const strokeWidth = Math.max(0, numberOr(item?.strokeWidth, 0));
  const strokeInset = strokeWidth > 0 ? strokeWidth / 2 : 0;
  const n = svgNumber;
  const fill = svgPaint(item?.fill);
  const stroke = strokeWidth > 0 ? svgPaint(item?.stroke) : null;
  // Same as strokeAndFillShape: the outline is at least 1 px, drawn over the fill.
  const closedPaint =
    `${svgPaintAttrs("fill", fill)} ${svgPaintAttrs("stroke", stroke)}` +
    (stroke ? ` stroke-width="${n(Math.max(1, strokeWidth))}" stroke-linejoin="round" stroke-linecap="round"` : "");

  let body;
  if (shapeType === "rect") {
    const width = Math.max(1, frame.width - strokeInset * 2);
    const height = Math.max(1, frame.height - strokeInset * 2);
    body = `<path d="${roundRectSvgPath(strokeInset, strokeInset, width, height, resolveRectCornerRadii(item))}" ${closedPaint}/>`;
  } else if (shapeType === "circle") {
    const radiusX = Math.max(1, frame.width / 2 - strokeInset);
    const radiusY = Math.max(1, frame.height / 2 - strokeInset);
    body = `<ellipse cx="${n(frame.width / 2)}" cy="${n(frame.height / 2)}" rx="${n(radiusX)}" ry="${n(radiusY)}" ${closedPaint}/>`;
  } else if (shapeType === "star") {
    const cx = frame.width / 2;
    const cy = frame.height / 2;
    const outerRadius = Math.max(2, Math.min(frame.width, frame.height) / 2 - strokeInset);
    const innerRadius = Math.max(1, outerRadius * 0.4);
    const points = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      points.push(`${n(cx + Math.cos(angle) * radius)},${n(cy + Math.sin(angle) * radius)}`);
    }
    body = `<polygon points="${points.join(" ")}" ${closedPaint}/>`;
  } else {
    // line / arrow — stroked in the stroke colour (or the fill, or slate), like the PNG.
    const lineColor = svgPaint(item?.stroke) || svgPaint(item?.fill) || { hex: "#111827", opacity: 1 };
    const points = frame.points.map((point) => ({ x: point.x - frame.minX, y: point.y - frame.minY }));
    const parts = [
      `<polyline points="${points.map((point) => `${n(point.x)},${n(point.y)}`).join(" ")}" fill="none" ` +
        `${svgPaintAttrs("stroke", lineColor)} stroke-width="${n(Math.max(1, strokeWidth || 4))}" stroke-linejoin="round" stroke-linecap="round"/>`,
    ];
    if (shapeType === "arrow" && points.length >= 2) {
      const to = points[points.length - 1];
      const from = points[points.length - 2];
      const headSize = Math.max(14, Math.max(1, strokeWidth || 5) * 2.5);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const half = headSize / 2;
      const left = { x: to.x - headSize * Math.cos(angle) + half * Math.sin(angle), y: to.y - headSize * Math.sin(angle) - half * Math.cos(angle) };
      const right = { x: to.x - headSize * Math.cos(angle) - half * Math.sin(angle), y: to.y - headSize * Math.sin(angle) + half * Math.cos(angle) };
      parts.push(`<polygon points="${n(to.x)},${n(to.y)} ${n(left.x)},${n(left.y)} ${n(right.x)},${n(right.y)}" ${svgPaintAttrs("fill", lineColor)}/>`);
    }
    body = parts.join("");
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" ` +
    `viewBox="0 0 ${frame.width} ${frame.height}">${body}</svg>`
  );
}

/** A short fingerprint of what the SVG draws — put on its URL so an edited shape isn't served stale. */
export function shapeLayerSvgVersion(item) {
  const svg = renderShapeLayerToSvg(item) || "";
  let hash = 2166136261;
  for (let index = 0; index < svg.length; index += 1) {
    hash ^= svg.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
