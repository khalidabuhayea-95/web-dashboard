import { inflateSync } from "node:zlib";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function loadFontEditor() {
  const importedModule = await import("fonteditor-core");
  const resolved =
    importedModule?.default && typeof importedModule.default === "object"
      ? importedModule.default
      : importedModule;
  if (!resolved || typeof resolved !== "object") {
    throw new Error("fonteditor-core is unavailable");
  }
  return resolved;
}

async function convertToTtf({ format, base64 }) {
  if (typeof base64 !== "string" || !base64) {
    throw new Error("Missing source font payload.");
  }

  const sourceBytes = Buffer.from(base64, "base64");
  if (!sourceBytes.length) {
    throw new Error("Source font payload is empty.");
  }

  const normalizedFormat = String(format || "").trim().toLowerCase();
  if (!normalizedFormat) {
    throw new Error("Missing source font format.");
  }

  const fontEditor = await loadFontEditor();
  const inputArrayBuffer = fontEditor.toArrayBuffer(sourceBytes);
  let outputArrayBuffer = null;

  if (normalizedFormat === "woff") {
    outputArrayBuffer = fontEditor.woff2ttf(inputArrayBuffer, {
      inflate: (chunk) => inflateSync(Buffer.from(chunk)),
    });
  } else if (normalizedFormat === "woff2") {
    if (fontEditor.woff2?.init) {
      await fontEditor.woff2.init();
    }
    outputArrayBuffer = fontEditor.woff2tottf(inputArrayBuffer);
  } else if (normalizedFormat === "eot") {
    outputArrayBuffer = fontEditor.eot2ttf(inputArrayBuffer);
  } else {
    throw new Error(`Unsupported format: ${normalizedFormat}`);
  }

  if (!outputArrayBuffer) {
    throw new Error(`Conversion returned no output for format: ${normalizedFormat}`);
  }

  const outputBytes = Buffer.from(new Uint8Array(outputArrayBuffer));
  if (!outputBytes.length) {
    throw new Error("Converted font payload is empty.");
  }

  return outputBytes;
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput || "{}");
  const outputBytes = await convertToTtf({
    format: payload?.format,
    base64: payload?.base64,
  });

  process.stdout.write(
    JSON.stringify({
      ok: true,
      format: "ttf",
      mimeType: "font/ttf",
      base64: outputBytes.toString("base64"),
    })
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || "Font conversion failed.");
  process.stderr.write(message);
  process.exit(1);
});
