/**
 * Animated images (Canva's animated stickers are looping GIFs) on the Konva canvas.
 *
 * Canvas `drawImage()` only ever paints an animated <img>'s FIRST frame — which for Canva's
 * stickers is a blank one (they paint in from nothing). So an animated layer is decoded once into
 * its frames with the WebCodecs ImageDecoder and the node is handed the frame for the current
 * time: a free-running loop at rest and during playback (Canva loops a sticker continuously), the
 * exact frame while scrubbing or recording. Where ImageDecoder is missing the layer stays a still
 * — the poster frame the importer stored next to the GIF.
 */

export interface AnimatedImageFrames {
  frames: ImageBitmap[];
  /** Each frame's display time, ms. */
  durationsMs: number[];
  /** Cumulative start of each frame within one loop, ms. */
  offsetsMs: number[];
  totalMs: number;
  width: number;
  height: number;
}

/** frames × pixels beyond which a GIF is left as a still (≈ 400 MB of RGBA frames). */
const MAX_DECODED_PIXELS = 100_000_000;
/** A GIF frame with no delay plays at the browsers' 100 ms floor; never faster than 20 ms. */
const MIN_FRAME_MS = 20;
const DEFAULT_FRAME_MS = 100;

type ImageDecoderLike = {
  tracks: { ready: Promise<void>; selectedTrack: { animated: boolean; frameCount: number } | null };
  completed: Promise<void>;
  decode: (options: { frameIndex: number }) => Promise<{ image: VideoFrame }>;
  close: () => void;
};
type ImageDecoderCtor = {
  new (init: { data: ArrayBuffer; type: string }): ImageDecoderLike;
  isTypeSupported: (type: string) => Promise<boolean>;
};

function imageDecoderCtor(): ImageDecoderCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  return typeof ctor === "function" ? ctor : null;
}

export function supportsAnimatedImageDecoding() {
  return imageDecoderCtor() !== null;
}

export function isAnimatedImageSource(src: unknown) {
  const value = String(src || "").trim().toLowerCase();
  if (!value) return false;
  if (value.startsWith("data:image/gif") || value.startsWith("data:image/webp")) return true;
  try {
    const parsed = new URL(value);
    return /\.(gif|webp)$/i.test(parsed.pathname || "");
  } catch {
    return /\.(gif|webp)(?:$|[?#])/i.test(value);
  }
}

const framesCache = new Map<string, Promise<AnimatedImageFrames | null>>();

async function decodeAnimatedImage(src: string): Promise<AnimatedImageFrames | null> {
  const Decoder = imageDecoderCtor();
  if (!Decoder) return null;
  let decoder: ImageDecoderLike | null = null;
  try {
    const response = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const type = String(blob.type || "").toLowerCase() || "image/gif";
    if (!type.startsWith("image/") || !(await Decoder.isTypeSupported(type))) return null;
    decoder = new Decoder({ data: await blob.arrayBuffer(), type });
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const frameCount = Number(track?.frameCount || 0);
    if (!track || !track.animated || frameCount <= 1) return null;
    const frames: ImageBitmap[] = [];
    const durationsMs: number[] = [];
    const offsetsMs: number[] = [];
    let totalMs = 0;
    let width = 0;
    let height = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const { image } = await decoder.decode({ frameIndex });
      try {
        width = width || Number(image.displayWidth || image.codedWidth || 0);
        height = height || Number(image.displayHeight || image.codedHeight || 0);
        if (frameIndex === 0 && width * height * frameCount > MAX_DECODED_PIXELS) return null;
        const rawMs = Number(image.duration || 0) / 1000;
        const frameMs = Math.max(MIN_FRAME_MS, rawMs > 0 ? rawMs : DEFAULT_FRAME_MS);
        frames.push(await createImageBitmap(image));
        offsetsMs.push(totalMs);
        durationsMs.push(frameMs);
        totalMs += frameMs;
      } finally {
        image.close();
      }
    }
    if (frames.length <= 1 || totalMs <= 0) return null;
    return { frames, durationsMs, offsetsMs, totalMs, width, height };
  } catch {
    return null;
  } finally {
    try {
      decoder?.close();
    } catch {
      /* already closed */
    }
  }
}

/** Decodes an animated image's frames once per source; null when it is a still or unsupported. */
export function loadAnimatedImageFrames(src: string): Promise<AnimatedImageFrames | null> {
  const key = String(src || "").trim();
  if (!key) return Promise.resolve(null);
  const cached = framesCache.get(key);
  if (cached) return cached;
  const pending = decodeAnimatedImage(key).then((result) => {
    // A failed decode is not cached, so a transient network error can be retried on the next mount.
    if (!result) framesCache.delete(key);
    return result;
  });
  framesCache.set(key, pending);
  return pending;
}

/** The frame showing at `ms` into the loop (negative = before the layer's start → first frame). */
export function animatedFrameIndexAtMs(frames: AnimatedImageFrames, ms: number) {
  if (!frames.frames.length) return 0;
  if (!(ms > 0)) return 0;
  const t = ms % frames.totalMs;
  // Frames are in order; a linear scan is cheaper than a binary search for typical GIF lengths.
  for (let index = frames.offsetsMs.length - 1; index >= 0; index -= 1) {
    if (t >= frames.offsetsMs[index]) return index;
  }
  return 0;
}
