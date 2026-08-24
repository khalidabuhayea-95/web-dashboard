"use client";

import { useEffect } from "react";

// Full-screen image zoom. Renders above stacked modals (backdrops are z-50,
// the gallery picker z-60), closes on any click or Escape.
export default function ImageLightbox({ src, alt = "", onClose }) {
  useEffect(() => {
    if (!src) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [src, onClose]);

  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-black/85 p-6"
      onClick={onClose}
      role="presentation"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-[92vh] max-w-[94vw] rounded-xl object-contain" />
    </div>
  );
}
