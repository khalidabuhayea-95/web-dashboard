import Konva from "konva";

/**
 * Konva lays a line out as `measureText(line) + letterSpacing × line.length`, but it DRAWS an RTL
 * line in one fillText with the canvas's native `letterSpacing` — and Chrome, like CSS, only adds
 * that spacing where letters do not join. In Arabic that is the word gaps: a 19-character line
 * with 2.75 px tracking draws 3 × 2.75 px wider, while Konva reserved 19 × 2.75 px. The line then
 * starts half the difference too early, so a centred Arabic label sat 24 px left of centre (and a
 * right-aligned one stopped short of the edge, and a long one could wrap too soon).
 *
 * Measure RTL lines the way they are drawn: natively, with the same spacing. LTR text keeps
 * Konva's own rule, because Konva draws spaced LTR text letter by letter with exactly that
 * advance. CanvaUnitText takes its line widths from a Konva.Text node, so it is covered too.
 */
type MeasurableText = {
  letterSpacing(): number;
  direction(): string;
  _getContextFont(): string;
  _getTextWidth(text: string): number;
};

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string };

let installed = false;

export function installKonvaTextPatches() {
  if (installed) return;
  installed = true;
  if (typeof document === "undefined") return;
  installTextPathContentMiddlePatch();
  installWideGlyphPatch();
  const context = document.createElement("canvas").getContext("2d") as SpacedContext | null;
  // Without native letterSpacing the draw path does not space at all, so there is no mismatch to fix.
  if (!context || !("letterSpacing" in context)) return;

  const prototype = Konva.Text.prototype as unknown as MeasurableText;
  const konvaWidth = prototype._getTextWidth;
  prototype._getTextWidth = function measureAsDrawn(this: MeasurableText, text: string) {
    const spacing = Number(this.letterSpacing()) || 0;
    if (spacing === 0 || this.direction() !== "rtl") return konvaWidth.call(this, text);
    context.font = this._getContextFont();
    context.direction = "rtl";
    context.letterSpacing = `${spacing}px`;
    const width = context.measureText(text).width;
    context.letterSpacing = "0px";
    return width;
  };

  installRtlJustifyPatch();
}

// ── konva-textpath-content-middle:start
/**
 * How far below its point on the path a curved glyph is drawn, along its own down direction, so
 * that the middle of the font's ascent–descent box rides the arc: half of ascent − descent, both
 * measured from the node's own textBaseline. That is where Canva puts a curved letter (each one a
 * span whose line box is centred on its arc), what the app passes as `baselineShiftPx`, and what
 * richText.ts's multi-style curve draws at. Konva's "middle" baseline puts the EM box's middle on
 * the path instead, which a tall Arabic face places higher: DAHNZVrSYZM's kashida sat 10 px above
 * Canva's (0.09 em) and broke away from the "عروسـ" it continues.
 */
type GlyphBoxMetrics = {
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
};

export function contentMiddleGlyphOffset(metrics: GlyphBoxMetrics | null | undefined): number {
  const ascent = Number(metrics?.fontBoundingBoxAscent ?? metrics?.actualBoundingBoxAscent);
  const descent = Number(metrics?.fontBoundingBoxDescent ?? metrics?.actualBoundingBoxDescent);
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return 0;
  return (ascent - descent) / 2;
}
// ── konva-textpath-content-middle:end

type GlyphOnPath = {
  attrs: { contentMiddleOnPath?: unknown };
  partialText: string;
  textBaseline(): string;
  _getContextFont(): string;
};

type TextPathPrototype = {
  _fillFunc(this: GlyphOnPath, context: Konva.Context): void;
  _strokeFunc(this: GlyphOnPath, context: Konva.Context): void;
  _fillFuncHit(this: GlyphOnPath, context: Konva.Context): void;
  _strokeFuncHit(this: GlyphOnPath, context: Konva.Context): void;
  getSelfRect(this: GlyphOnPath): { x: number; y: number; width: number; height: number };
};

/**
 * A TextPath with `contentMiddleOnPath` draws each glyph `contentMiddleGlyphOffset` below its point
 * (Konva draws it at y = 0 in the glyph's own turned frame). Every other TextPath draws as before.
 * The offset is per font + baseline, measured once and again after fonts finish loading.
 */
function installTextPathContentMiddlePatch() {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return;
  const offsets = new Map<string, number>();
  document.fonts?.addEventListener?.("loadingdone", () => offsets.clear());
  const offsetOf = (node: GlyphOnPath) => {
    if (node.attrs.contentMiddleOnPath !== true) return 0;
    const font = node._getContextFont();
    const baseline = node.textBaseline() as CanvasTextBaseline;
    const key = `${baseline}|${font}`;
    let offset = offsets.get(key);
    if (offset === undefined) {
      measure.font = font;
      measure.textBaseline = baseline;
      offset = contentMiddleGlyphOffset(measure.measureText("M"));
      offsets.set(key, offset);
    }
    return offset;
  };
  const prototype = Konva.TextPath.prototype as unknown as TextPathPrototype;
  const fill = function fillOnContentMiddle(this: GlyphOnPath, context: Konva.Context) {
    context.fillText(this.partialText, 0, offsetOf(this));
  };
  const stroke = function strokeOnContentMiddle(this: GlyphOnPath, context: Konva.Context) {
    context.strokeText(this.partialText, 0, offsetOf(this));
  };
  prototype._fillFunc = fill;
  prototype._strokeFunc = stroke;
  prototype._fillFuncHit = fill;
  prototype._strokeFuncHit = stroke;
  // Konva bounds a TextPath by its glyph points ± half the font size; grow that by the offset so
  // a cached (blurred, filtered) curve keeps the glyphs it moved.
  const konvaSelfRect = prototype.getSelfRect;
  prototype.getSelfRect = function selfRectWithOffset(this: GlyphOnPath) {
    const rect = konvaSelfRect.call(this);
    const offset = Math.abs(offsetOf(this));
    if (!(offset > 0) || !(rect.width > 0)) return rect;
    return { x: rect.x - offset, y: rect.y - offset, width: rect.width + offset * 2, height: rect.height + offset * 2 };
  };
}

// ── konva-wide-glyph:start
/**
 * A letter wider than its box. The browser keeps it on its own line and lets it overflow the box's
 * END edge (an overflowing line is start-aligned, whatever text-align says), so it hangs out to the
 * left in Arabic. Konva's word wrap finds no prefix that fits and DROPS the rest of the paragraph:
 * DAHMphBrpuo's 590 px monogram letters — Canva draws "س" 340 px wide in a 48 px box — vanished,
 * and the snug-fit then shrank their boxes to 1 px.
 *
 * Konva's own wrap (word, then character), except that a line always takes at least one grapheme.
 * Used only when Konva's layout lost text, so every other text keeps Konva's lines exactly.
 */
export type WrappedLine = { text: string; width: number; lastInParagraph: boolean; overflow: boolean };

const graphemesOf = (() => {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
  const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
  return (text: string) => (segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text));
})();

export function wrapLinesKeepingWideGlyphs(input: {
  text: string;
  maxWidth: number;
  wrapAtWord: boolean;
  measure: (text: string) => number;
  /** Stop before a paragraph that would overflow this height (Konva's fixed-height rule). */
  maxHeight?: number;
  lineHeightPx?: number;
}): { lines: WrappedLine[]; textWidth: number } {
  const { maxWidth, wrapAtWord, measure } = input;
  const lines: WrappedLine[] = [];
  let textWidth = 0;
  let height = 0;
  const lineHeight = Number(input.lineHeightPx) || 0;
  const push = (text: string, width: number) => {
    lines.push({ text, width, lastInParagraph: false, overflow: width > maxWidth + 0.5 });
    textWidth = Math.max(textWidth, width);
    height += lineHeight;
  };
  for (const paragraph of String(input.text).split("\n")) {
    let line = paragraph;
    let lineWidth = measure(line);
    if (!(lineWidth > maxWidth)) {
      push(line, lineWidth);
    } else {
      while (line.length > 0) {
        const graphemes = graphemesOf(line);
        let low = 0;
        let high = graphemes.length;
        let count = 0;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (measure(graphemes.slice(0, mid + 1).join("")) <= maxWidth) {
            low = mid + 1;
            count = mid + 1;
          } else {
            high = mid;
          }
        }
        // The browser's rule: a line holds at least one grapheme, however wide.
        if (count === 0) count = 1;
        if (wrapAtWord && count < graphemes.length) {
          const next = graphemes[count];
          const fitted = graphemes.slice(0, count);
          if (next !== " " && next !== "-") {
            const breakAt = Math.max(fitted.lastIndexOf(" "), fitted.lastIndexOf("-")) + 1;
            if (breakAt > 0) count = breakAt;
          }
        }
        const match = graphemes.slice(0, count).join("").trimEnd();
        push(match, measure(match));
        line = graphemes.slice(count).join("").trimStart();
        if (line.length > 0) {
          lineWidth = measure(line);
          if (lineWidth <= maxWidth) {
            push(line, lineWidth);
            break;
          }
        }
      }
    }
    if (lines.length) lines[lines.length - 1].lastInParagraph = true;
    if (Number(input.maxHeight) > 0 && lineHeight > 0 && height + lineHeight > Number(input.maxHeight)) break;
  }
  return { lines, textWidth };
}

/** Where an overflowing line goes instead of Konva's align position: its start edge on the box's. */
export function overflowLineShift(input: { align: string; direction: string; width: number; available: number }) {
  const { align, width, available } = input;
  const konvaX = align === "right" ? available - width : align === "center" ? (available - width) / 2 : 0;
  const startX = input.direction === "rtl" ? available - width : 0;
  return startX - konvaX;
}
// ── konva-wide-glyph:end

type WrappingText = {
  text(): string;
  width(): number;
  height(): number;
  padding(): number;
  fontSize(): number;
  lineHeight(): number;
  wrap(): string;
  ellipsis(): boolean;
  align(): string;
  direction(): string;
  letterSpacing(): number;
  charRenderFunc?: () => unknown;
  getWidth(): number;
  attrs: { width?: unknown; height?: unknown };
  textArr: Array<{ text: string; width: number; lastInParagraph?: boolean; overflow?: boolean }>;
  textWidth: number;
  _partialTextX: number;
  _getContextFont(): string;
  _getTextWidth(text: string): number;
  _setTextData(): void;
  _sceneFunc(context: Konva.Context): void;
};

const lettersOf = (value: string) => value.replace(/\s+/g, "").length;

function installWideGlyphPatch() {
  const prototype = Konva.Text.prototype as unknown as WrappingText;
  const konvaSetTextData = prototype._setTextData;
  prototype._setTextData = function setTextDataKeepingWideGlyphs(this: WrappingText) {
    konvaSetTextData.call(this);
    const width = this.attrs.width;
    if (width === undefined || width === "auto" || this.wrap() === "none" || this.ellipsis()) return;
    const kept = this.textArr.reduce((sum, line) => sum + lettersOf(line.text), 0);
    if (kept >= lettersOf(this.text())) return;
    const padding = Number(this.padding()) || 0;
    const height = this.attrs.height;
    const fixedHeight = height !== undefined && height !== "auto";
    const lineHeightPx = this.lineHeight() * this.fontSize();
    const layout = wrapLinesKeepingWideGlyphs({
      text: this.text(),
      maxWidth: Number(width) - padding * 2,
      wrapAtWord: this.wrap() !== "char",
      measure: (text) => this._getTextWidth(text),
      ...(fixedHeight ? { maxHeight: Number(height) - padding * 2, lineHeightPx } : {}),
    });
    this.textArr = layout.lines.map((line) => ({
      text: this.align() === "justify" ? line.text.trim() : line.text,
      width: line.width,
      lastInParagraph: line.lastInParagraph,
      ...(line.overflow ? { overflow: true } : {}),
    }));
    this.textWidth = layout.textWidth;
  };

  // Draw an overflowing line from its start edge. Konva makes one fillStrokeShape call per line —
  // per letter for spaced/justified LTR text — so the calls are counted back to their lines.
  const konvaScene = prototype._sceneFunc;
  prototype._sceneFunc = function sceneWithWideGlyphs(this: WrappingText, context: Konva.Context) {
    const lines = Array.isArray(this.textArr) ? this.textArr : [];
    const align = this.align();
    const direction = this.direction();
    if (!lines.some((line) => line.overflow) || (align === "justify" && direction === "rtl")) {
      return konvaScene.call(this, context);
    }
    const perLetter =
      direction !== "rtl" && (Number(this.letterSpacing()) !== 0 || align === "justify" || Boolean(this.charRenderFunc?.()));
    const available = this.getWidth() - (Number(this.padding()) || 0) * 2;
    const callLines: number[] = [];
    lines.forEach((line, index) => {
      const calls = perLetter ? graphemesOf(line.text).length : 1;
      for (let call = 0; call < calls; call += 1) callLines.push(index);
    });
    const owner = context as unknown as { fillStrokeShape: (shape: unknown) => void };
    const ownFillStroke = Object.prototype.hasOwnProperty.call(owner, "fillStrokeShape") ? owner.fillStrokeShape : null;
    const drawShape = owner.fillStrokeShape;
    let call = 0;
    owner.fillStrokeShape = (shape: unknown) => {
      const line = lines[callLines[call] ?? -1];
      call += 1;
      if (shape === this && line?.overflow) {
        this._partialTextX += overflowLineShift({ align, direction, width: line.width, available });
      }
      return drawShape.call(context, shape);
    };
    try {
      return konvaScene.call(this, context);
    } finally {
      if (ownFillStroke) owner.fillStrokeShape = ownFillStroke;
      else delete (owner as { fillStrokeShape?: unknown }).fillStrokeShape;
    }
  };
}

// ── konva-rtl-justify:start
/**
 * Where one line of right-to-left justified text goes, as the browser lays it out (Canva's
 * `text-align: justify` on an Arabic paragraph): a full line spans the box, its spaces widened
 * evenly; the last line of a paragraph — and a one-line paragraph — sits at the start, which for
 * RTL is the right. Konva draws RTL lines in one fillText and only ever positions them for
 * left/right/center, so every justified Arabic text sat flush LEFT (DAHQBQgaj3k's menu items and
 * section titles).
 */
export function rtlJustifiedLinePlacement(input: {
  text: string;
  width: number;
  available: number;
  lastInParagraph: boolean;
}): { x: number; wordSpacing: number } {
  const available = Math.max(0, Number(input.available) || 0);
  const width = Math.max(0, Number(input.width) || 0);
  const spare = Math.max(0, available - width);
  const spaces = (String(input.text || "").match(/ /g) || []).length;
  if (input.lastInParagraph || spaces === 0) return { x: spare, wordSpacing: 0 };
  return { x: 0, wordSpacing: spare / spaces };
}
// ── konva-rtl-justify:end

type JustifiableText = {
  align(): string;
  direction(): string;
  padding(): number;
  getWidth(): number;
  textArr: Array<{ text: string; width: number; lastInParagraph?: boolean }>;
  _partialTextX: number;
  _sceneFunc(context: Konva.Context): void;
};

function installRtlJustifyPatch() {
  const prototype = Konva.Text.prototype as unknown as JustifiableText;
  const konvaScene = prototype._sceneFunc;
  prototype._sceneFunc = function sceneWithRtlJustify(this: JustifiableText, context: Konva.Context) {
    if (this.align() !== "justify" || this.direction() !== "rtl") return konvaScene.call(this, context);
    const lines = Array.isArray(this.textArr) ? this.textArr : [];
    const available = this.getWidth() - (Number(this.padding()) || 0) * 2;
    const native = (context as unknown as { _context?: CanvasRenderingContext2D & { wordSpacing?: string } })._context;
    const owner = context as unknown as { fillStrokeShape: (shape: unknown) => void };
    const ownFillStroke = Object.prototype.hasOwnProperty.call(owner, "fillStrokeShape") ? owner.fillStrokeShape : null;
    const drawShape = owner.fillStrokeShape;
    let lineIndex = 0;
    // Konva draws an RTL line with ONE fillStrokeShape call (its letter-by-letter path is LTR
    // only), so the n-th call is line n: place it, and widen its spaces natively.
    owner.fillStrokeShape = (shape: unknown) => {
      const line = lines[lineIndex];
      lineIndex += 1;
      if (!line || shape !== this) return drawShape.call(context, shape);
      const placement = rtlJustifiedLinePlacement({
        text: line.text,
        width: line.width,
        available,
        lastInParagraph: Boolean(line.lastInParagraph),
      });
      this._partialTextX = placement.x;
      const canWiden = Boolean(native) && "wordSpacing" in (native as object);
      if (canWiden && placement.wordSpacing > 0) native!.wordSpacing = `${placement.wordSpacing}px`;
      try {
        return drawShape.call(context, shape);
      } finally {
        if (canWiden && placement.wordSpacing > 0) native!.wordSpacing = "0px";
      }
    };
    try {
      return konvaScene.call(this, context);
    } finally {
      if (ownFillStroke) owner.fillStrokeShape = ownFillStroke;
      else delete (owner as { fillStrokeShape?: unknown }).fillStrokeShape;
    }
  };
}

installKonvaTextPatches();
