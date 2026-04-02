import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createInvalidInputError,
  createProcessingFailedError,
  createProviderUnavailableError,
  createUnprocessableImageError,
  createUnsupportedImageTypeError,
} from "../errors.js";

const ALLOWED_RASTER_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const BRIDGE_SCRIPT_PATH = fileURLToPath(new URL("./rembg_bridge.py", import.meta.url));
const DEFAULT_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 20_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8];
const PYTHON_BIN_ENV_VARS = ["BACKGROUND_REMOVAL_REMBG_PYTHON_BIN", "REMBG_PYTHON_BIN"];

let runtimeInfoPromise = null;

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeOutputFileName(value) {
  const baseName = String(value || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${baseName || "image"}-no-bg.png`;
}

function matchesSignature(bytes, signature) {
  if (!(bytes instanceof Uint8Array) || bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}

function extractPngDimensions(bytes) {
  if (!matchesSignature(bytes, PNG_SIGNATURE) || bytes.length < 24) {
    return {
      width: 0,
      height: 0,
    };
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function detectMimeType(bytes, fallbackMimeType = "") {
  if (matchesSignature(bytes, PNG_SIGNATURE)) return "image/png";
  if (matchesSignature(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  return normalizeMimeType(fallbackMimeType);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolvePythonCandidates() {
  const configured = PYTHON_BIN_ENV_VARS.map((envName) => String(process.env[envName] || "").trim()).filter(
    Boolean
  );
  const localVenvPython = path.join(process.cwd(), ".venv-rembg", "bin", "python");
  const candidates = [
    ...configured,
    localVenvPython,
    "/opt/homebrew/bin/python3.11",
    "/opt/homebrew/bin/python3.12",
    "python3.12",
    "python3.11",
    "python3",
  ];

  const uniqueCandidates = [];
  for (const candidate of candidates) {
    if (!candidate || uniqueCandidates.includes(candidate)) continue;
    if (candidate.includes(path.sep) && !(await fileExists(candidate))) continue;
    uniqueCandidates.push(candidate);
  }
  return uniqueCandidates;
}

function tail(value, maxLength = 800) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch (_error) {
    return null;
  }
}

function runPythonBridge(pythonBin, args = [], { inputBytes = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [BRIDGE_SCRIPT_PATH, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        createProcessingFailedError("rembg background removal timed out before producing an output.")
      );
    }, Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        createProviderUnavailableError(
          error instanceof Error && error.message
            ? `Failed to start rembg runtime: ${error.message}`
            : "Failed to start rembg runtime."
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
        return;
      }

      const payload = parseJson(stderr);
      const message =
        payload?.message || tail(stderr) || `rembg runtime exited with code ${Number(code) || 1}.`;

      if (payload?.kind === "invalid_input") {
        reject(createInvalidInputError(message));
        return;
      }
      if (payload?.kind === "provider_unavailable") {
        reject(createProviderUnavailableError(message));
        return;
      }
      if (payload?.kind === "unprocessable_image") {
        reject(createUnprocessableImageError(message));
        return;
      }
      reject(createProcessingFailedError(message));
    });

    if (inputBytes?.length) {
      child.stdin.write(inputBytes);
    }
    child.stdin.end();
  });
}

async function resolveRembgRuntime() {
  if (runtimeInfoPromise) return runtimeInfoPromise;

  runtimeInfoPromise = (async () => {
    const candidates = await resolvePythonCandidates();
    let lastFailure = "";

    for (const pythonBin of candidates) {
      try {
        const result = await runPythonBridge(pythonBin, ["--check"], {
          timeoutMs: CHECK_TIMEOUT_MS,
        });
        const metadata = parseJson(result.stdout.toString("utf8")) || {};
        return {
          pythonBin,
          pythonVersion: String(metadata.pythonVersion || "").trim(),
          rembgVersion: String(metadata.rembgVersion || "").trim(),
        };
      } catch (error) {
        lastFailure =
          error instanceof Error && error.message
            ? error.message
            : "Unknown rembg runtime probe failure.";
      }
    }

    runtimeInfoPromise = null;
    throw createProviderUnavailableError(
      [
        "rembg runtime is unavailable.",
        "Install Python 3.11+ and `rembg[cpu]`, or set BACKGROUND_REMOVAL_REMBG_PYTHON_BIN to a compatible interpreter.",
        lastFailure ? `Last probe failure: ${lastFailure}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  })();

  return runtimeInfoPromise;
}

export async function removeRasterBackgroundWithRembg(input = {}) {
  const rawBytes = input?.bytes;
  const bytes = Buffer.isBuffer(rawBytes)
    ? rawBytes
    : rawBytes instanceof Uint8Array
    ? Buffer.from(rawBytes)
    : Buffer.from(rawBytes || []);

  if (bytes.length === 0) {
    throw createInvalidInputError("Missing image bytes.");
  }

  const mimeType = detectMimeType(bytes, input?.mimeType);
  if (!ALLOWED_RASTER_MIME_TYPES.has(mimeType)) {
    throw createUnsupportedImageTypeError("rembg only supports PNG and JPEG uploads for this route.");
  }

  const runtime = await resolveRembgRuntime();
  const bridgeResult = await runPythonBridge(runtime.pythonBin, [], {
    inputBytes: bytes,
    timeoutMs: input?.timeoutMs,
  });

  const outputBytes = bridgeResult.stdout;
  if (!outputBytes?.length) {
    throw createUnprocessableImageError("rembg did not return an output image.");
  }
  if (!matchesSignature(outputBytes, PNG_SIGNATURE)) {
    throw createProcessingFailedError("rembg returned an unexpected output format.");
  }

  const dimensions = extractPngDimensions(outputBytes);
  return {
    bytes: outputBytes,
    mimeType: "image/png",
    width: dimensions.width,
    height: dimensions.height,
    fileName: sanitizeOutputFileName(input?.fileName),
    strategy: "rembg",
    provider: "rembg-python",
    removedBackground: true,
    runtime,
  };
}
