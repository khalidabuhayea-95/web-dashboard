/**
 * Reveal-mask clip geometry for the Konva preview — the render half of the mobile
 * LayerRevealMaskSpec (Wipe = rect trim, Circle = growing ellipse matte, Radial = clock sweep).
 *
 * These draw a PATH into a canvas 2D context (a Konva `clipFunc`), in the element's LOCAL space
 * ([0,0]–[w,h]). Feather is intentionally ignored — the mobile text path clips hard-edged too,
 * so GRADIENT_* reads like its hard twin here (documented parity gap, not a bug).
 */
export type ClipMaskKind = "WIPE" | "CIRCLE" | "RADIAL";
export interface ClipMask {
  kind: ClipMaskKind;
  progress: number;
  startAngleDegrees?: number;
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
 * Draws the reveal region for [mask] into [ctx]. [rtl] flips a WIPE so Arabic uncovers from the
 * right, matching the content-derived direction the mobile renderer uses.
 */
export function drawRevealClip(ctx: Ctx2D, mask: ClipMask, w: number, h: number, rtl: boolean): void {
  const p = clamp01(mask.progress);
  switch (mask.kind) {
    case "WIPE": {
      const revealed = p * w;
      if (rtl) ctx.rect(w - revealed, 0, revealed, h);
      else ctx.rect(0, 0, revealed, h);
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
