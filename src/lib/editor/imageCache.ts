/**
 * Decoded images shared by every canvas node.
 *
 * A layer only mounts while the playhead is inside its timeline window, and `use-image` builds a
 * fresh <img> on every mount and hands it over after `onload` + `decode()` — always at least one
 * frame later, even for a file the browser already holds. So a scene that opens on an image layer
 * drew nothing for a frame or two and the page background showed through (a grey flash under a
 * CapCut Glare transition, the photo being the one scene 1 had already shown). Images are kept
 * here once decoded, a node asking for one gets it on its first render, and the canvas preloads
 * the page's images so even a first appearance mid-timeline is instant.
 */
import { useEffect } from "react";
import useImage from "use-image";

type CrossOrigin = "anonymous" | "use-credentials";

/** Enough for a long template's layers; the oldest decoded image goes first beyond it. */
const MAX_CACHED_IMAGES = 400;

const decoded = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

function cacheKey(url: string, crossOrigin?: CrossOrigin) {
  return `${crossOrigin || ""}|${url}`;
}

function remember(key: string, image: HTMLImageElement) {
  decoded.delete(key);
  decoded.set(key, image);
  while (decoded.size > MAX_CACHED_IMAGES) {
    const oldest = decoded.keys().next().value;
    if (oldest === undefined) break;
    decoded.delete(oldest);
  }
}

/** The decoded image for `url`, if one is held. */
export function getCachedImage(url: string, crossOrigin?: CrossOrigin): HTMLImageElement | undefined {
  if (!url) return undefined;
  return decoded.get(cacheKey(url, crossOrigin));
}

/** Load and decode `url` into the cache (once per url); resolves with the image or null. */
export function preloadImage(url: string, crossOrigin?: CrossOrigin): Promise<HTMLImageElement | null> {
  if (!url || typeof window === "undefined") return Promise.resolve(null);
  const key = cacheKey(url, crossOrigin);
  const held = decoded.get(key);
  if (held) return Promise.resolve(held);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const load = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new window.Image();
    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => {
      image
        .decode()
        .catch(() => undefined)
        .finally(() => {
          remember(key, image);
          pending.delete(key);
          resolve(image);
        });
    };
    image.onerror = () => {
      pending.delete(key);
      resolve(null);
    };
    image.src = url;
  });
  pending.set(key, load);
  return load;
}

/**
 * `use-image` with the shared cache in front: a decoded image is returned on the first render,
 * anything else loads as before (and is remembered once it has).
 */
export function useCachedImage(
  url: string,
  crossOrigin?: CrossOrigin
): [HTMLImageElement | undefined, "loaded" | "loading" | "failed"] {
  const cached = getCachedImage(url, crossOrigin);
  const [loaded, status] = useImage(cached ? "" : url, crossOrigin);
  useEffect(() => {
    if (url && loaded && status === "loaded") remember(cacheKey(url, crossOrigin), loaded);
  }, [crossOrigin, loaded, status, url]);
  if (cached) return [cached, "loaded"];
  return [loaded, status];
}
