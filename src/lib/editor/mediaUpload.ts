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
  options?: { signal?: AbortSignal }
): Promise<EditorMediaUploadResult> {
  const formData = new FormData();
  formData.set("kind", kind);
  formData.set("file", file);

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
