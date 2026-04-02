const INTERNAL_EDITOR_CLIPBOARD_TYPE = "application/x-web-dashboard-editor-selection";

function asString(value: unknown) {
  return String(value || "").trim();
}

function encodeSvgToDataUrl(svgMarkup: string) {
  const source = asString(svgMarkup);
  if (!source) return "";
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    const utf8Bytes = new TextEncoder().encode(source);
    let binary = "";
    utf8Bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return `data:image/svg+xml;base64,${window.btoa(binary)}`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function extractBackgroundImageUrl(value: string) {
  const source = asString(value);
  if (!source) return "";
  const match = source.match(/background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i);
  return asString(match?.[2] || "");
}

function extractImageSourceFromHtml(html: string) {
  const source = asString(html);
  if (!source || typeof DOMParser === "undefined") return "";

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, "text/html");
    const svg = doc.querySelector("svg");
    if (svg) {
      const serialized = new XMLSerializer().serializeToString(svg);
      const dataUrl = encodeSvgToDataUrl(serialized);
      if (dataUrl) return dataUrl;
    }

    const imageLike = doc.querySelector("img[src], image[href], image[xlink\\:href]");
    if (imageLike) {
      const directSource =
        asString(imageLike.getAttribute("src")) ||
        asString(imageLike.getAttribute("href")) ||
        asString(imageLike.getAttribute("xlink:href"));
      if (directSource) return directSource;
    }

    const styledNode = Array.from(doc.querySelectorAll<HTMLElement>("[style]")).find((node) =>
      /background-image\s*:/i.test(String(node.getAttribute("style") || ""))
    );
    if (styledNode) {
      const backgroundUrl = extractBackgroundImageUrl(String(styledNode.getAttribute("style") || ""));
      if (backgroundUrl) return backgroundUrl;
    }
  } catch {
    return "";
  }

  return "";
}

function isVisuallyRichClipboardHtml(html: string) {
  const source = asString(html);
  if (!source || typeof DOMParser === "undefined") return false;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, "text/html");
    if (doc.querySelector("svg, img, canvas, video, foreignObject")) return true;
    if (
      doc.querySelector(
        [
          "[style*='background-image']",
          "[style*='clip-path']",
          "[style*='transform']",
          "[style*='position:absolute']",
          "[style*='position: absolute']",
          "[style*='mask']",
          "[style*='filter']",
        ].join(",")
      )
    ) {
      return true;
    }
    const styledNodes = doc.querySelectorAll("[style]");
    return styledNodes.length >= 2;
  } catch {
    return false;
  }
}

function sanitizeClipboardHtmlDocument(doc: Document) {
  doc.querySelectorAll("script, noscript").forEach((node) => node.remove());
  return doc;
}

async function waitForNextPaint() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function createMeasurementHost() {
  const host = document.createElement("div");
  host.setAttribute(
    "style",
    [
      "all: initial",
      "position: fixed",
      "left: -100000px",
      "top: 0",
      "visibility: hidden",
      "pointer-events: none",
      "z-index: -1",
      "display: inline-block",
      "max-width: none",
      "max-height: none",
    ].join(";")
  );
  return host;
}

function buildSvgForeignObjectDataUrl(width: number, height: number, innerMarkup: string) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const svgMarkup = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">`,
    '<foreignObject width="100%" height="100%">',
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${safeWidth}px;height:${safeHeight}px;overflow:hidden;">`,
    innerMarkup,
    "</div>",
    "</foreignObject>",
    "</svg>",
  ].join("");
  return encodeSvgToDataUrl(svgMarkup);
}

export async function renderClipboardHtmlToImageDataUrl(html: string) {
  const source = asString(html);
  if (!source || typeof document === "undefined" || typeof DOMParser === "undefined") return "";
  if (!isVisuallyRichClipboardHtml(source)) return "";

  try {
    const parser = new DOMParser();
    const parsed = sanitizeClipboardHtmlDocument(parser.parseFromString(source, "text/html"));
    const bodyMarkup = parsed.body?.innerHTML?.trim();
    if (!bodyMarkup) return "";

    const host = createMeasurementHost();
    const wrapper = document.createElement("div");
    wrapper.setAttribute(
      "style",
      [
        "all: initial",
        "display: inline-block",
        "position: relative",
        "max-width: none",
        "max-height: none",
      ].join(";")
    );
    wrapper.innerHTML = bodyMarkup;
    host.appendChild(wrapper);
    document.body.appendChild(host);

    try {
      await waitForNextPaint();
      const rect = wrapper.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width < 1 || height < 1) return "";
      return buildSvgForeignObjectDataUrl(width, height, wrapper.innerHTML);
    } finally {
      host.remove();
    }
  } catch {
    return "";
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read clipboard blob."));
    reader.readAsDataURL(blob);
  });
}

export async function readImageSourceFromAsyncClipboard() {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return "";

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => /^image\//i.test(type));
      if (imageType) {
        const blob = await item.getType(imageType);
        if (/svg\+xml/i.test(imageType)) {
          const svgMarkup = await blob.text();
          const svgDataUrl = encodeSvgToDataUrl(svgMarkup);
          if (svgDataUrl) return svgDataUrl;
        }
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl) return dataUrl;
      }

      if (item.types.includes("text/html")) {
        const htmlBlob = await item.getType("text/html");
        const html = await htmlBlob.text();
        const directImageSource = extractImageSourceFromHtml(html);
        if (directImageSource) return directImageSource;
        const renderedImageSource = await renderClipboardHtmlToImageDataUrl(html);
        if (renderedImageSource) return renderedImageSource;
      }
    }
  } catch {
    return "";
  }

  return "";
}

export function writeInternalEditorClipboardMarker(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;

  try {
    clipboard.setData(
      INTERNAL_EDITOR_CLIPBOARD_TYPE,
      JSON.stringify({
        source: "web-dashboard-editor",
        version: 1,
      })
    );
    clipboard.setData("text/plain", "web-dashboard-editor-selection");
    return true;
  } catch {
    return false;
  }
}

export function hasInternalEditorClipboardMarker(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  try {
    return clipboard.types.includes(INTERNAL_EDITOR_CLIPBOARD_TYPE);
  } catch {
    return false;
  }
}

export function getClipboardImageFile(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard) return null;
  const imageItem = Array.from(clipboard.items || []).find(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );
  return imageItem?.getAsFile() || null;
}

export function getClipboardHtml(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard) return "";
  return asString(clipboard.getData("text/html"));
}

export function getClipboardText(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard) return "";
  return asString(clipboard.getData("text/plain"));
}

export function getClipboardSvgDataUrl(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard) return "";
  const svgMarkup =
    asString(clipboard.getData("image/svg+xml")) ||
    asString(clipboard.getData("text/svg+xml"));
  if (!svgMarkup) return "";
  return encodeSvgToDataUrl(svgMarkup);
}

export function extractImageSourceFromClipboardHtml(html: string) {
  return extractImageSourceFromHtml(html);
}

export function extractTextFromClipboardHtml(html: string) {
  const source = asString(html);
  if (!source || typeof DOMParser === "undefined") return "";

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, "text/html");
    return asString(doc.body?.textContent || "");
  } catch {
    return "";
  }
}
