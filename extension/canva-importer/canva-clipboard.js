// Copy → paste from Canva into the dashboard editor.
//
// Canva copies an element as ONE text/html entry: `<span data-canva-clipboard="…">`, the base64
// of the UTF-16LE JSON of the copied elements — boxes and media ids, no pixels. Stock and uploaded
// photos are served from signed, expiring URLs that cannot be rebuilt from a media id, so the
// editor could not show the picture. This script runs on canva.com and, right after a copy, reads
// that payload back, fetches each copied element's picture from the page it is on (credentialed,
// like the importer does) and rewrites the clipboard with the same HTML plus
// `<span data-nayroz-canva-media="…">`: mediaId → { dataUrl, width, height, mimeType }. Canva's
// own paste keeps working (its span is untouched); the editor reads ours
// (src/lib/editor/canvaClipboard.ts).
(() => {
  const MEDIA_ATTRIBUTE = "data-nayroz-canva-media";
  const MAX_IMAGE_BYTES = 12_000_000;
  const COPY_SETTLE_MS = 350;
  let enriching = false;

  const decodeUtf16Base64 = (encoded) => {
    let binary = "";
    try {
      binary = atob(String(encoded || ""));
    } catch (_error) {
      return "";
    }
    let text = "";
    for (let index = 0; index + 1 < binary.length; index += 2) {
      text += String.fromCharCode(binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8));
    }
    return text;
  };
  const encodeUtf8Base64 = (text) => btoa(unescape(encodeURIComponent(text)));

  // Every copied element's id and its first media reference ({"A?":"d","A":id,"B":version}).
  const collectElementMedia = (json) => {
    let root = null;
    try {
      root = JSON.parse(json);
    } catch (_error) {
      return [];
    }
    const elements = Array.isArray(root?.A) ? root.A : [];
    const found = [];
    const firstMedia = (value, depth) => {
      if (!value || typeof value !== "object" || depth > 8) return null;
      if (value["A?"] === "d" && typeof value.A === "string") return { id: value.A, version: Number(value.B) || 1 };
      for (const child of Object.values(value)) {
        const hit = firstMedia(child, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    elements.forEach((element) => {
      if (!element || typeof element !== "object") return;
      const media = firstMedia(element.a, 0) || firstMedia(element.b, 0);
      if (media) found.push({ elementId: String(element._ || ""), media });
    });
    return found;
  };

  const readClipboardHtml = async () => {
    if (!navigator.clipboard?.read) return "";
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/html")) return await (await item.getType("text/html")).text();
      }
    } catch (_error) {
      return "";
    }
    return "";
  };

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });

  const imageSize = async (blob) => {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch (_error) {
      return { width: 0, height: 0 };
    }
  };

  // The element's picture as the page shows it: the biggest <img> under the element node.
  const pictureUrlForElement = (elementId) => {
    const node = elementId ? document.getElementById(elementId) : null;
    if (!node) return "";
    const images = Array.from(node.querySelectorAll("img"))
      .map((image) => ({ image, area: image.naturalWidth * image.naturalHeight }))
      .sort((a, b) => b.area - a.area);
    const best = images[0]?.image;
    return best ? String(best.currentSrc || best.src || "") : "";
  };

  const fetchPicture = async (url) => {
    if (!url || /^data:/i.test(url)) return null;
    for (const credentials of ["include", "omit"]) {
      try {
        const response = await fetch(url, { credentials, cache: "force-cache" });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob || blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) continue;
        if (!String(blob.type || "").startsWith("image/")) continue;
        const dataUrl = await blobToDataUrl(blob);
        if (!dataUrl.startsWith("data:image/")) continue;
        const size = await imageSize(blob);
        return { dataUrl, width: size.width, height: size.height, mimeType: blob.type };
      } catch (_error) {
        // Try the other credentials mode.
      }
    }
    return null;
  };

  const enrichClipboard = async () => {
    if (enriching) return;
    enriching = true;
    try {
      const html = await readClipboardHtml();
      if (!html || !html.includes("data-canva-clipboard=") || html.includes(`${MEDIA_ATTRIBUTE}=`)) return;
      const encoded = /data-canva-clipboard="([^"]+)"/.exec(html)?.[1] || "";
      const entries = collectElementMedia(decodeUtf16Base64(encoded));
      if (!entries.length) return;
      const pictures = {};
      for (const entry of entries) {
        if (pictures[entry.media.id]) continue;
        const picture = await fetchPicture(pictureUrlForElement(entry.elementId));
        if (picture) pictures[entry.media.id] = picture;
      }
      if (!Object.keys(pictures).length) return;
      const enriched = `${html}<span ${MEDIA_ATTRIBUTE}="${encodeUtf8Base64(JSON.stringify(pictures))}"></span>`;
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([enriched], { type: "text/html" }) }),
      ]);
    } catch (_error) {
      // Leave Canva's own clipboard as it is.
    } finally {
      enriching = false;
    }
  };

  document.addEventListener(
    "copy",
    () => {
      window.setTimeout(() => {
        void enrichClipboard();
      }, COPY_SETTLE_MS);
    },
    true
  );
})();
