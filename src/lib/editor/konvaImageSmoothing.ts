import { Context } from "konva/lib/Context";

/**
 * Canvas draws a shrunk image with `imageSmoothingQuality: "low"` unless told otherwise — plain
 * bilinear sampling, which skips most of the source pixels once an image is drawn far below its
 * size. Imported Canva icons are routinely 800×800 PNGs shown at 30 px (and the canvas zoom shrinks
 * them again), so the round timeline dots of DAHYoZnBs9Y came out with jagged, stair-stepped edges.
 * "high" makes the browser filter properly when it downscales; images drawn at or above their size
 * look the same either way. Every Konva layer, cache and export canvas draws through this method.
 */
let installed = false;

type SmoothedContext = CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality };

export function installKonvaImageSmoothingPatch() {
  if (installed) return;
  installed = true;
  const prototype = Context.prototype as unknown as {
    _context: SmoothedContext;
    drawImage: (...args: unknown[]) => void;
  };
  const konvaDrawImage = prototype.drawImage;
  prototype.drawImage = function drawImageSmoothly(this: { _context: SmoothedContext }, ...args: unknown[]) {
    const context = this._context;
    if (context && context.imageSmoothingEnabled !== false && context.imageSmoothingQuality !== "high") {
      context.imageSmoothingQuality = "high";
    }
    return konvaDrawImage.apply(this, args);
  };
}

installKonvaImageSmoothingPatch();
