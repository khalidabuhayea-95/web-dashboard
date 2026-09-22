"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Full-screen image zoom. Renders above stacked modals (backdrops are z-50,
 * the gallery picker z-60), closes on backdrop click or Escape.
 *
 * With `zoomable`, clicking the image toggles between fit-to-screen and 1:1, so the real
 * pixels can be inspected rather than a downscaled preview — pass the ORIGINAL asset URL,
 * not a thumbnail, or there is nothing extra to see. At 1:1 the image is dragged to pan.
 * Off by default so existing callers keep click-anywhere-to-close.
 */
export default function ImageLightbox({ src, alt = "", onClose, zoomable = false }) {
  // Keyed by src so a new image starts fit-to-screen with its own measurements, without an
  // effect resetting state (which this codebase's lint rules disallow, rightly — it would be a
  // cascading render).
  const [zoomState, setZoomState] = useState({ src: "", zoomed: false, natural: { width: 0, height: 0 } });
  const active =
    zoomState.src === src ? zoomState : { src, zoomed: false, natural: { width: 0, height: 0 } };
  const { zoomed, natural } = active;
  const scrollRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!src) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [src, onClose]);

  const onPointerDown = useCallback(
    (event) => {
      if (!zoomed || !scrollRef.current) return;
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: scrollRef.current.scrollLeft,
        top: scrollRef.current.scrollTop,
        moved: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [zoomed]
  );

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || !scrollRef.current) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    scrollRef.current.scrollLeft = drag.left - dx;
    scrollRef.current.scrollTop = drag.top - dy;
  }, []);

  const onPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // A drag that panned the image must not also toggle the zoom.
    return drag?.moved;
  }, []);

  if (!src) return null;

  const canZoom = zoomable && natural.width > 0;
  const zoomLabel = zoomed
    ? "100% · click to fit"
    : natural.width
      ? `${natural.width} × ${natural.height} · click to zoom`
      : "";

  return (
    <div
      ref={scrollRef}
      className={`fixed inset-0 z-[70] bg-black/85 ${
        zoomed ? "cursor-grab overflow-auto p-0" : "flex cursor-zoom-out items-center justify-center overflow-hidden p-6"
      }`}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={zoomed ? "flex min-h-full min-w-full items-center justify-center p-6" : "contents"}
        onClick={(event) => event.stopPropagation()}
        role="presentation"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) =>
            setZoomState({
              src,
              zoomed: false,
              natural: {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              },
            })
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            const panned = onPointerUp(event);
            if (!panned && canZoom) setZoomState({ ...active, zoomed: !zoomed });
          }}
          style={zoomed ? { width: natural.width, maxWidth: "none" } : undefined}
          className={`rounded-xl ${
            zoomed
              ? "cursor-grab select-none"
              : `max-h-[92vh] max-w-[94vw] object-contain ${canZoom ? "cursor-zoom-in" : ""}`
          }`}
        />
      </div>

      {zoomable && zoomLabel ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
          {zoomLabel}
        </div>
      ) : null}
    </div>
  );
}
