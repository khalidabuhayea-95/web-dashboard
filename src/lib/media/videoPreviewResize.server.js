function normalizeMimeType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export async function resizeVideoPreviewBuffer({ bytes, mimeType }) {
  const inputBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const inputMimeType = normalizeMimeType(mimeType);

  return {
    bytes: inputBytes,
    mimeType: inputMimeType,
    resized: false,
  };
}
