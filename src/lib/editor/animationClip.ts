/**
 * Reveal-mask clip geometry for the Konva preview — the render half of the mobile
 * LayerRevealMaskSpec (Wipe = rect trim, Circle = growing ellipse matte, Radial = clock sweep).
 *
 * These draw a PATH into a canvas 2D context (a Konva `clipFunc`), in the element's LOCAL space
 * ([0,0]–[w,h]). Feather is intentionally ignored — the mobile text path clips hard-edged too,
 * so GRADIENT_* reads like its hard twin here (documented parity gap, not a bug).
 */
export type ClipMaskKind = "WIPE" | "CIRCLE" | "RADIAL";

/**
 * The edge a WIPE band grows out of, in the layer's own (content) space. Absent = LEFT. Canva's
 * Wipe grows from the edge the motion starts at, its Baseline reveals the part of the content
 * inside the layer's home box and its Block hides the text behind a bar, so those masks name an
 * edge AND set `anchored` (docs/canva-animation-parity.md §8.3 item 2).
 */
export type RevealEdge = "LEFT" | "RIGHT" | "TOP" | "BOTTOM";

export interface ClipMask {
  kind: ClipMaskKind;
  progress: number;
  startAngleDegrees?: number;
  edge?: RevealEdge;
  /**
   * The edge is absolute. Without it a text renderer mirrors LEFT/RIGHT for right-to-left text, so
   * the legacy typewriter/word/line reveals uncover Arabic from the right — the app's rule too.
   */
  anchored?: boolean;
}

function mirroredForRtl(edge: RevealEdge): RevealEdge {
  if (edge === "LEFT") return "RIGHT";
  if (edge === "RIGHT") return "LEFT";
  return edge;
}

interface Ctx2D {
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Draws the reveal region for [mask] into [ctx]. A WIPE grows out of its `edge` (LEFT when absent);
 * for right-to-left text ([rtl]) LEFT and RIGHT swap unless the mask is `anchored`, so a legacy
 * reveal uncovers Arabic from the right while Canva's Wipe, Baseline and Block keep their edge.
 * Media layers pass `rtl = false`.
 */
export function drawRevealClip(ctx: Ctx2D, mask: ClipMask, w: number, h: number, rtl: boolean): void {
  const p = clamp01(mask.progress);
  switch (mask.kind) {
    case "WIPE": {
      const base: RevealEdge = mask.edge ?? "LEFT";
      const edge: RevealEdge = rtl && !mask.anchored ? mirroredForRtl(base) : base;
      switch (edge) {
        case "LEFT":
          ctx.rect(0, 0, p * w, h);
          return;
        case "RIGHT":
          ctx.rect(w - p * w, 0, p * w, h);
          return;
        case "TOP":
          ctx.rect(0, 0, w, p * h);
          return;
        case "BOTTOM":
          ctx.rect(0, h - p * h, w, p * h);
          return;
      }
      return;
    }
    case "CIRCLE": {
      // A circle centred on the layer, grown to cover the corners at p=1.
      const r = p * Math.hypot(w, h) * 0.5;
      ctx.arc(w / 2, h / 2, Math.max(0.0001, r), 0, Math.PI * 2, false);
      return;
    }
    case "RADIAL": {
      // A clock sweep from startAngle spanning p·360°, out to a radius that covers the box.
      const start = ((mask.startAngleDegrees ?? -90) * Math.PI) / 180;
      const r = Math.hypot(w, h);
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, r, start, start + p * 2 * Math.PI, false);
      ctx.closePath();
      return;
    }
  }
}

/** One laid-out line of a text node (Konva's `textArr` entry). */
export interface TypewriterLine {
  text: string;
  width: number;
  /** The line ends a paragraph (a `\n` follows it in the source text). */
  lastInParagraph?: boolean;
}

/**
 * The typewriter as the app draws it: the first [revealed] characters of the text shown, line by
 * line, the rest hidden — not one wipe across the whole box, which uncovered every line at once and
 * left the half-typed ones as ghosts under the fallback fade. Rectangles in the text's local
 * space: earlier lines whole, the current line up to its last typed character (from the right for
 * right-to-left text), later lines nothing. [measure] is a line prefix's drawn width.
 */
export function typewriterRevealRects(
  lines: ReadonlyArray<TypewriterLine>,
  revealed: number,
  options: {
    boxWidth: number;
    lineHeightPx: number;
    align: string;
    rtl: boolean;
    measure: (text: string) => number;
  }
): Array<{ x: number; y: number; width: number; height: number }> {
  const { boxWidth, lineHeightPx, align, rtl, measure } = options;
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  // Each shown line owns its band; the first reaches up and the last down a full line (accents,
  // swashes), the line being typed a fifth below (its descenders) without uncovering the next.
  const bleed = lineHeightPx;
  let consumed = 0;
  lines.forEach((line, index) => {
    const remaining = revealed - consumed;
    consumed += line.text.length + 1;
    if (remaining <= 0) return;
    const whole = remaining >= line.text.length;
    const top = index === 0 ? -bleed : index * lineHeightPx;
    const below = index === lines.length - 1 ? bleed : whole ? 0 : 0.2 * lineHeightPx;
    const height = (index + 1) * lineHeightPx + below - top;
    if (whole) {
      rects.push({ x: -bleed, y: top, width: boxWidth + 2 * bleed, height });
      return;
    }
    const lineLeft = align === "center" ? (boxWidth - line.width) / 2 : align === "right" ? boxWidth - line.width : 0;
    const shown = Math.max(0, Math.min(line.width, measure(line.text.slice(0, remaining))));
    // The typed part reaches back past the line's start edge (a swash may lean out of it).
    rects.push(rtl ? { x: lineLeft + line.width - shown, y: top, width: shown + bleed, height } : { x: lineLeft - bleed, y: top, width: shown + bleed, height });
  });
  return rects;
}

/**
 * The box of character [charIndex] of the text laid out as [lines] (same counting as
 * typewriterRevealRects), for a letter drawn on its own pass — a typewriter letter mid-fade. Null
 * for a line break or past the end.
 */
export function typewriterCharRect(
  lines: ReadonlyArray<TypewriterLine>,
  charIndex: number,
  options: {
    boxWidth: number;
    lineHeightPx: number;
    align: string;
    rtl: boolean;
    measure: (text: string) => number;
  }
): { x: number; y: number; width: number; height: number } | null {
  const { boxWidth, lineHeightPx, align, rtl, measure } = options;
  let consumed = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const local = charIndex - consumed;
    consumed += line.text.length + 1;
    if (local < 0) return null;
    if (local >= line.text.length) continue;
    const lineLeft = align === "center" ? (boxWidth - line.width) / 2 : align === "right" ? boxWidth - line.width : 0;
    const before = measure(line.text.slice(0, local));
    const through = measure(line.text.slice(0, local + 1));
    const left = rtl ? lineLeft + line.width - through : lineLeft + before;
    const bleed = 0.2 * lineHeightPx;
    return { x: left, y: index * lineHeightPx - bleed, width: Math.max(0, through - before), height: lineHeightPx + 2 * bleed };
  }
  return null;
}
