/**
 * Cuts a video file for real, rather than only playing a window of it.
 *
 * The editor's Start/End fields are a PLAYBACK window: the full file still ships, and the mobile
 * payload carries no trim at all, so a 40s source trimmed to 10s here still arrived on the phone as
 * 40s. This route re-encodes the chosen span into a new object, so what the app downloads is the
 * clip itself and every consumer agrees on the length without needing to understand a trim.
 *
 * The span is re-encoded rather than stream-copied: `-c copy` can only cut on a keyframe, which
 * moves the boundary by up to a second and is exactly the mismatch this route exists to remove.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import {
  getObject,
  getPublicStorageBucketName,
  parsePublicObjectKey,
  restorePublicObjectUrlFromClient,
  rewritePublicObjectUrlForClient,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET_NAME = getPublicStorageBucketName();
const TRIM_LIMIT = { limit: 10, windowMs: 60_000 };
const MAX_SOURCE_BYTES = 250 * 1024 * 1024;
const MIN_CLIP_SECONDS = 0.1;

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function runProcessCapture(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8").trim());
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

async function objectBodyToBuffer(body: unknown): Promise<Buffer | null> {
  if (!body) return null;
  const candidate = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
  if (typeof candidate.transformToByteArray === "function") {
    return Buffer.from(await candidate.transformToByteArray());
  }
  if (typeof candidate.arrayBuffer === "function") {
    return Buffer.from(await candidate.arrayBuffer());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  const output = await runProcessCapture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const seconds = Number.parseFloat(output);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function numberFrom(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

/** `users/<id>/video/2026/09/22/clip-<uuid>.mp4` → the same folder with a fresh name. */
function makeTrimmedKey(sourceKey: string): string {
  const directory = sourceKey.includes("/") ? sourceKey.slice(0, sourceKey.lastIndexOf("/")) : "";
  const base = path.basename(sourceKey).replace(/\.[^.]+$/, "") || "clip";
  const stem = base.replace(/-trimmed(-[0-9a-f-]+)?$/i, "");
  const name = `${stem}-trimmed-${randomUUID()}.mp4`;
  return directory ? `${directory}/${name}` : name;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const rateLimitState = checkRateLimit({
      scope: "api:editor:media:trim-video",
      identifier: session.userId || resolveRequestIp(request),
      limit: TRIM_LIMIT.limit,
      windowMs: TRIM_LIMIT.windowMs,
    });
    if (!rateLimitState.allowed) {
      return createRateLimitResponse("Too many trims. Try again shortly.", rateLimitState);
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return handleBadRequest("Invalid request body");
    }

    const startSec = numberFrom((payload as { startSec?: unknown }).startSec);
    const endSec = numberFrom((payload as { endSec?: unknown }).endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      return handleBadRequest("Start and end must be numbers");
    }
    if (startSec < 0 || endSec - startSec < MIN_CLIP_SECONDS) {
      return handleBadRequest(`The clip must be at least ${MIN_CLIP_SECONDS}s long`);
    }

    // Only objects in our own public bucket may be read. Trimming an arbitrary URL would turn this
    // route into a fetch-anything proxy running on the server.
    const rawSrc = String((payload as { src?: unknown }).src || "").trim();
    const sourceKey = parsePublicObjectKey(restorePublicObjectUrlFromClient(rawSrc));
    if (!sourceKey) {
      return handleBadRequest("This video is not stored in the project's own media bucket");
    }

    const object = await getObject(BUCKET_NAME, sourceKey);
    const sourceBytes = await objectBodyToBuffer(object?.Body);
    if (!sourceBytes || sourceBytes.length === 0) {
      return handleApiError(new Error("Empty source"), "The source video could not be read", 502);
    }
    if (sourceBytes.length > MAX_SOURCE_BYTES) {
      return handleBadRequest("The source video is too large to trim");
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nayroz-trim-"));
    const sourceExtension = (path.extname(sourceKey) || ".mp4").replace(/^\./, "");
    const inputPath = path.join(tempDir, `${randomUUID()}.${sourceExtension}`);
    const outputPath = path.join(tempDir, `${randomUUID()}.mp4`);

    try {
      await fs.writeFile(inputPath, sourceBytes);
      const sourceDuration = await probeDurationSeconds(inputPath);
      const safeStart = sourceDuration > 0 ? Math.min(startSec, Math.max(0, sourceDuration - MIN_CLIP_SECONDS)) : startSec;
      const safeEnd = sourceDuration > 0 ? Math.min(endSec, sourceDuration) : endSec;
      const spanSeconds = Math.max(MIN_CLIP_SECONDS, safeEnd - safeStart);

      await runProcess("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        // Input seek, then an exact span. Accuracy comes from re-encoding below.
        "-ss",
        safeStart.toFixed(3),
        "-i",
        inputPath,
        "-t",
        spanSeconds.toFixed(3),
        "-map",
        "0:v:0",
        // A silent clip is normal here, so the audio stream is optional.
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        // Playback can start before the whole file has arrived.
        "-movflags",
        "+faststart",
        outputPath,
      ]);

      const trimmedBytes = await fs.readFile(outputPath);
      if (trimmedBytes.length === 0) {
        return handleApiError(new Error("Empty output"), "The trimmed video came back empty", 500);
      }
      const durationSec = (await probeDurationSeconds(outputPath)) || spanSeconds;

      const uploaded = await uploadObject({
        bucket: BUCKET_NAME,
        key: makeTrimmedKey(sourceKey),
        body: trimmedBytes,
        contentType: "video/mp4",
        cacheControl: "public, max-age=31536000, immutable",
        skipExistenceCheck: true,
      });
      const url = String(uploaded.url || "").trim();
      if (!url) {
        return handleApiError(
          new Error("Trimmed video URL unavailable"),
          "The trim succeeded but its URL is unavailable",
          500
        );
      }

      // The source is deliberately left in place: the editor holds this change unsaved, so undoing
      // it or closing without saving has to find the original still there.
      return NextResponse.json({
        url: rewritePublicObjectUrlForClient(url),
        durationSec: Math.round(durationSec * 1000) / 1000,
        bytes: trimmedBytes.length,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message) && /ffmpeg|ffprobe/i.test(message)) {
      logger.error("editor.trimVideo.missingFfmpeg", { message });
      return handleApiError(
        error,
        "ffmpeg is not installed on this server, so the file cannot be cut",
        501
      );
    }
    logger.error("editor.trimVideo.failed", { message });
    return handleApiError(error, "The video could not be trimmed", 500);
  }
}
