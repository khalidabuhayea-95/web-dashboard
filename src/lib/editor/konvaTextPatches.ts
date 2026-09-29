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
}

installKonvaTextPatches();
