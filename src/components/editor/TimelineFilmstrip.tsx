"use client";

type FilmstripTone = "selected" | "preview";

interface FilmstripFramesProps {
  count: number;
  imageSrc?: string;
  images?: string[];
  tone: FilmstripTone;
}

export function FilmstripFrames({ count, imageSrc, images, tone }: FilmstripFramesProps) {
  const frameCount = Math.max(8, count);
  const frameClassName =
    tone === "selected"
      ? "relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-[#6d4e12]/55 bg-[#f6c15f] shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]"
      : "relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-black/25 bg-[#d6d7db] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]";
  const overlayClassName =
    tone === "selected"
      ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(102,63,7,0.14))]"
      : "bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(15,23,42,0.16))]";

  return (
    <div className="flex h-full items-stretch gap-[2px] px-1 py-1">
      {Array.from({ length: frameCount }, (_, index) => {
        const imageForFrame =
          Array.isArray(images) && images.length > 0 ? images[index % images.length] || "" : imageSrc || "";
        return (
          <div key={`${tone}-frame-${index}`} className={frameClassName}>
            {imageForFrame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageForFrame}
                alt=""
                className={`h-full w-full object-cover ${tone === "preview" ? "grayscale" : ""}`}
                draggable={false}
              />
            ) : (
              <div
                className={`h-full w-full ${
                  tone === "selected"
                    ? "bg-[linear-gradient(180deg,#f3d79d_0%,#b48229_100%)]"
                    : "bg-[linear-gradient(180deg,#f8fafc_0%,#9ca3af_100%)]"
                }`}
              />
            )}
            <div className={`absolute inset-0 ${overlayClassName}`} />
            <div className="absolute inset-y-0 left-[28%] w-px bg-black/30" />
            <div className="absolute inset-y-0 right-[28%] w-px bg-black/22" />
          </div>
        );
      })}
    </div>
  );
}

export function FilmstripOverlay({ count }: { count: number }) {
  const frameCount = Math.max(8, count);

  return (
    <div className="pointer-events-none absolute inset-0 flex gap-[2px] px-1 py-1">
      {Array.from({ length: frameCount }, (_, index) => (
        <div
          key={`overlay-frame-${index}`}
          className="relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-black/28 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
        >
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(15,23,42,0.08))]" />
          <div className="absolute inset-y-0 left-[28%] w-px bg-black/30" />
          <div className="absolute inset-y-0 right-[28%] w-px bg-black/24" />
        </div>
      ))}
    </div>
  );
}
