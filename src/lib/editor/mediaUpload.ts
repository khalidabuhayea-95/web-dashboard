export type EditorMediaKind = "image" | "video" | "font";

export type EditorMediaUploadResult = {
  url: string;
  path: string;
  bucket: string;
  kind: EditorMediaKind;
  mimeType: string;
  size: number;
  fileName: string;
};

export async function uploadEditorMediaFile(
  file: File,
  kind: EditorMediaKind,
  options?: {
    signal?: AbortSignal;
    variant?: "template-preview-video" | "template-preview-poster";
    templateId?: string;
  }
): Promise<EditorMediaUploadResult> {
  const formData = new FormData();
  formData.set("kind", kind);
  formData.set("file", file);
  if (options?.variant) {
    formData.set("variant", options.variant);
  }
  if (options?.templateId) {
    formData.set("templateId", options.templateId);
  }

  const response = await fetch("/api/editor/media", {
    method: "POST",
    body: formData,
    signal: options?.signal,
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<EditorMediaUploadResult> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to upload media.");
  }

  const url = String(payload?.url || "").trim();
  if (!url) {
    throw new Error("Uploaded media URL is unavailable.");
  }

  return {
    url,
    path: String(payload?.path || ""),
    bucket: String(payload?.bucket || ""),
    kind: (String(payload?.kind || kind) as EditorMediaKind),
    mimeType: String(payload?.mimeType || file.type || ""),
    size: Number(payload?.size || file.size || 0),
    fileName: String(payload?.fileName || file.name || ""),
  };
}

export function dataUrlToFile(
  dataUrl: string,
  fileName: string,
  fallbackMimeType = "image/png"
): File {
  const value = String(dataUrl || "");
  const parts = value.split(",");
  if (parts.length !== 2) {
    throw new Error("Invalid data URL.");
  }

  const [header, content] = parts;
  const mimeTypeMatch = header.match(/^data:([^;]+);base64$/i);
  const mimeType = String(mimeTypeMatch?.[1] || fallbackMimeType).trim().toLowerCase();
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const safeName = String(fileName || "").trim() || `upload-${Date.now()}.png`;
  return new File([bytes], safeName, { type: mimeType || fallbackMimeType });
}

/**
 * First frame of a video file, uploaded as a JPEG — the layer's poster (EditorElement.posterSrc).
 * Best-effort: resolves "" when the browser cannot decode the file or the upload fails, so a
 * poster never blocks the video itself.
 */
export async function uploadVideoPosterFromFile(
  file: File,
  options?: { maxDimension?: number; signal?: AbortSignal }
): Promise<string> {
  if (typeof document === "undefined" || typeof URL === "undefined") return "";
  const objectUrl = URL.createObjectURL(file);
  try {
    const frame = await new Promise<HTMLCanvasElement | null>((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      const finish = (canvas: HTMLCanvasElement | null) => {
        if (settled) return;
        settled = true;
        video.removeAttribute("src");
        video.load();
        resolve(canvas);
      };
      const timeoutId = window.setTimeout(() => finish(null), 8000);
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.addEventListener("error", () => {
        window.clearTimeout(timeoutId);
        finish(null);
      });
      // loadeddata = the first frame is decoded (readyState >= HAVE_CURRENT_DATA) at time 0.
      video.addEventListener("loadeddata", () => {
        window.clearTimeout(timeoutId);
        try {
          const maxDimension = Math.max(64, Number(options?.maxDimension) || 720);
          const scale = Math.min(1, maxDimension / Math.max(1, video.videoWidth, video.videoHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext("2d");
          if (!context || !video.videoWidth) {
            finish(null);
            return;
          }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas);
        } catch {
          finish(null);
        }
      });
      video.src = objectUrl;
      video.load();
    });
    if (!frame) return "";
    const blob = await new Promise<Blob | null>((resolve) => frame.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) return "";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
    const posterFile = new File([blob], `${baseName}-poster.jpg`, { type: "image/jpeg" });
    const uploaded = await uploadEditorMediaFile(posterFile, "image", { signal: options?.signal });
    return uploaded.url;
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
