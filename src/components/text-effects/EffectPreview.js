"use client";

import { useEffect, useRef, useState } from "react";
import { applyTextEffect, layoutSimpleText } from "@/lib/textEffects/applyTextEffect";

// Decoded texture/pattern images, shared by every card on the page (the strip and the
// editor modal show the same files). CORS mode, so "Save thumbnail" can read the canvas.
const images = new Map();

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (!images.has(url)) {
    images.set(
      url,
      new Promise((resolve) => {
        const image = new window.Image();
        image.crossOrigin = "anonymous";
        image.onload = () => image.decode().catch(() => undefined).finally(() => resolve(image));
        image.onerror = () => {
          images.delete(url);
          resolve(null);
        };
        image.src = url;
      })
    );
  }
  return images.get(url);
}

/** Draws the effect onto `canvas` at `width × height` CSS px; the thumbnail export reuses it. */
export function drawEffectPreview(canvas, {
  spec,
  text,
  fontFamily,
  fontWeight = 700,
  width,
  height,
  background,
  texture,
  pattern,
  inlayTexture,
  intensity,
  tintColor,
  pixelRatio,
}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = pixelRatio || Math.min(3, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  // "inherit" = the page's own face (the dashboard's Arabic font), read off the canvas.
  const family =
    fontFamily && fontFamily !== "inherit" ? fontFamily : getComputedStyle(canvas).fontFamily || "system-ui";
  const words = String(text || "").trim() || "محمد";
  const lineCount = words.split("\n").length;
  let fontSize = Math.round((height * 0.5) / lineCount);
  const fontOf = (size) => `${fontWeight} ${size}px ${family}`;
  // Long sample texts shrink to fit the card rather than spilling past its edges.
  ctx.font = fontOf(fontSize);
  const widest = Math.max(...words.split("\n").map((line) => ctx.measureText(line).width), 1);
  if (widest > width * 0.86) fontSize = Math.max(10, Math.floor((fontSize * width * 0.86) / widest));

  const lineHeight = 1.3;
  const blockHeight = fontSize * lineHeight * lineCount;
  const layout = layoutSimpleText(ctx, {
    text: words,
    font: fontOf(fontSize),
    fontSize,
    lineHeight,
    align: "center",
    direction: "rtl",
    box: { x: 0, y: (height - blockHeight) / 2, width },
  });
  applyTextEffect(ctx, layout, { spec, texture, pattern, inlayTexture }, { intensity, tintColor });
}

/**
 * Draws one effect with the SHARED renderer (applyTextEffect) — the same function the
 * editor canvas and every export use, so what an admin tunes here is what ships. The
 * texture really loads; a clip plays (muted, looping) while `animate` is on.
 */
export default function EffectPreview({
  spec,
  text = "محمد",
  fontFamily = "inherit",
  fontWeight = 700,
  width = 320,
  height = 150,
  background = "#ffffff",
  intensity = 1,
  tintColor,
  animate = false,
  className = "",
}) {
  const ownRef = useRef(null);
  const [image, setImage] = useState(null);
  const [pattern, setPattern] = useState(null);
  const [inlayImage, setInlayImage] = useState(null);
  // Keyed by URL, so a swapped or removed clip stops drawing without a reset in the effect.
  const [loadedVideo, setLoadedVideo] = useState({ url: "", element: null });
  const [fontTick, setFontTick] = useState(0);

  const texture = spec?.fill?.kind === "texture" ? spec.fill.texture || {} : {};
  const imageUrl = texture.url || "";
  const videoUrl = texture.videoUrl || "";
  const patternUrl = spec?.fill?.kind === "pattern" ? spec.fill.patternUrl || "" : "";
  const inlayUrl = spec?.inlay?.enabled ? spec.inlay.texture?.url || "" : "";

  useEffect(() => {
    let live = true;
    loadImage(imageUrl).then((loaded) => live && setImage(loaded));
    return () => {
      live = false;
    };
  }, [imageUrl]);

  useEffect(() => {
    let live = true;
    loadImage(patternUrl).then((loaded) => live && setPattern(loaded));
    return () => {
      live = false;
    };
  }, [patternUrl]);

  useEffect(() => {
    let live = true;
    loadImage(inlayUrl).then((loaded) => live && setInlayImage(loaded));
    return () => {
      live = false;
    };
  }, [inlayUrl]);

  const video = videoUrl && loadedVideo.url === videoUrl ? loadedVideo.element : null;

  useEffect(() => {
    if (!videoUrl) return undefined;
    const element = document.createElement("video");
    element.crossOrigin = "anonymous";
    element.muted = true;
    element.loop = true;
    element.playsInline = true;
    element.preload = "auto";
    const ready = () => setLoadedVideo({ url: videoUrl, element });
    element.addEventListener("loadeddata", ready);
    element.src = videoUrl;
    return () => {
      element.removeEventListener("loadeddata", ready);
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!video) return;
    if (animate) video.play().catch(() => undefined);
    else video.pause();
  }, [animate, video]);

  // The first draw can happen before the web font arrives; redraw once it has.
  useEffect(() => {
    const fonts = globalThis.document?.fonts;
    if (!fonts?.load) return undefined;
    let live = true;
    const loading =
      fontFamily && fontFamily !== "inherit" ? fonts.load(`${fontWeight} 40px ${fontFamily}`, text || "محمد") : fonts.ready;
    Promise.resolve(loading)
      .catch(() => undefined)
      .then(() => live && setFontTick((tick) => tick + 1));
    return () => {
      live = false;
    };
  }, [fontFamily, fontWeight, text]);

  useEffect(() => {
    const canvas = ownRef.current;
    if (!canvas) return undefined;
    const draw = () =>
      drawEffectPreview(canvas, {
        spec,
        text,
        fontFamily,
        fontWeight,
        width,
        height,
        background,
        // A clip wins over the still once it has a frame; the still covers the wait.
        texture: video && video.readyState >= 2 ? video : image,
        pattern,
        inlayTexture: inlayImage,
        intensity,
        tintColor,
      });
    draw();
    if (!video || !animate) return undefined;
    let frame = 0;
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spec, text, fontFamily, fontWeight, width, height, background, image, pattern, inlayImage, video, animate, intensity, tintColor, fontTick]);

  return (
    <canvas
      ref={ownRef}
      style={{ width: "100%", maxWidth: width, aspectRatio: `${width} / ${height}` }}
      className={className}
      aria-label="معاينة التأثير"
    />
  );
}

export { loadImage as loadEffectImage };
