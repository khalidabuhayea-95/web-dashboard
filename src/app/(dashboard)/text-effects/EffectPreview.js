"use client";

import { useEffect, useRef } from "react";
import { paintTextEffect } from "@/lib/textEffects/spec";

/**
 * Draws one effect with the SHARED painter — the same function the editor and
 * the preview generator use. That is the point: an admin tuning a gradient here
 * is looking at what the app will actually render, not an approximation.
 */
export default function EffectPreview({
  spec,
  text = "مبروك",
  fontFamily = "system-ui",
  width = 320,
  height = 150,
  background = "#ffffff",
  className = "",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw at device resolution so metal banding does not turn to mush on a
    // retina screen, then let CSS scale it back down.
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    const fontSize = Math.round(height * 0.44);
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";

    paintTextEffect(ctx, text, spec, {
      x: width / 2,
      y: height / 2,
      fontSize,
      width: Math.max(ctx.measureText(text).width, fontSize * 2),
    });
  }, [spec, text, fontFamily, width, height, background]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className={className}
      aria-label="Effect preview"
    />
  );
}
