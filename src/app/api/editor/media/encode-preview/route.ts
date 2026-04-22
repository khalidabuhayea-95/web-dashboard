import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";
export const maxDuration = 120;

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const numeric = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.max(numeric, 1), max);
}

function getExpectedFrameCount(durationMs: number, fps: number) {
  return Math.max(1, Math.ceil((Math.max(0, durationMs) * Math.max(1, fps)) / 1000));
}

function extensionFromMimeType(mimeType: string, fallbackName = "") {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("ogg")) return "ogv";
  if (normalized.includes("quicktime")) return "mov";
  if (normalized.includes("matroska")) return "mkv";
  if (normalized.includes("webm")) return "webm";
  const ext = path.extname(String(fallbackName || "")).trim().replace(/^\./, "");
  return ext || "webm";
}

function formatDurationSeconds(durationMs: number) {
  return (Math.max(0, Number(durationMs) || 0) / 1000).toFixed(3);
}

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
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
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
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

function parseFps(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const [numeratorRaw, denominatorRaw] = raw.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw || 1);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

async function probeVideo(filePath: string) {
  const output = await runProcessCapture("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate,r_frame_rate,nb_read_frames,nb_frames:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(output) as {
    streams?: Array<{
      width?: number | string;
      height?: number | string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      nb_read_frames?: number | string;
      nb_frames?: number | string;
    }>;
    format?: { duration?: number | string };
  };
  const stream = parsed.streams?.[0] || {};
  const frameCount =
    Number.parseInt(String(stream.nb_read_frames || stream.nb_frames || ""), 10) || 0;
  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    avgFps: parseFps(stream.avg_frame_rate),
    rawFps: parseFps(stream.r_frame_rate),
    frameCount,
    durationMs: Math.round((Number(parsed.format?.duration) || 0) * 1000),
  };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return handleBadRequest("Invalid multipart form data");
    }

    const fps = parsePositiveInt(formData.get("fps"), 12, 60);
    const expectedDurationMs = parsePositiveInt(formData.get("expectedDurationMs"), 300, 120_000);
    const expectedFrameCount = parsePositiveInt(
      formData.get("expectedFrameCount"),
      getExpectedFrameCount(expectedDurationMs, fps),
      10_000
    );
    const sourceVideo =
      formData.get("sourceVideo") instanceof File ? (formData.get("sourceVideo") as File) : null;
    const frames = formData
      .getAll("frame")
      .filter((entry): entry is File => entry instanceof File)
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    if (!sourceVideo && frames.length === 0) {
      return handleBadRequest("Missing preview video source");
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nayroz-preview-encode-"));
    const outputPath = path.join(tempDir, `${randomUUID()}.mp4`);

    try {
      if (sourceVideo) {
        const sourceMimeType = String(formData.get("mimeType") || sourceVideo.type || "").trim();
        const sourcePath = path.join(
          tempDir,
          `${randomUUID()}.${extensionFromMimeType(sourceMimeType, sourceVideo.name)}`
        );
        const bytes = Buffer.from(await sourceVideo.arrayBuffer());
        await fs.writeFile(sourcePath, bytes);
        const expectedDurationSeconds = formatDurationSeconds(expectedDurationMs);

        await runProcess("ffmpeg", [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-fflags",
          "+genpts",
          "-i",
          sourcePath,
          "-an",
          "-vf",
          `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,tpad=stop_mode=clone:stop_duration=1,trim=duration=${expectedDurationSeconds},setpts=N/(${fps}*TB)`,
          "-r",
          String(fps),
          "-fps_mode",
          "cfr",
          "-t",
          expectedDurationSeconds,
          "-frames:v",
          String(expectedFrameCount),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "24",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outputPath,
        ]);
      } else {
        if (expectedFrameCount !== frames.length) {
          return handleBadRequest("Preview frame count does not match the requested render spec");
        }

        for (let index = 0; index < frames.length; index += 1) {
          const file = frames[index];
          const framePath = path.join(
            tempDir,
            `frame-${String(index + 1).padStart(6, "0")}.jpg`
          );
          const bytes = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(framePath, bytes);
        }

        await runProcess("ffmpeg", [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-framerate",
          String(fps),
          "-i",
          path.join(tempDir, "frame-%06d.jpg"),
          "-r",
          String(fps),
          "-fps_mode",
          "cfr",
          "-frames:v",
          String(expectedFrameCount),
          "-vf",
          "scale=trunc(iw/2)*2:trunc(ih/2)*2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "24",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outputPath,
        ]);
      }

      const probe = await probeVideo(outputPath);
      const expectedFrameDurationMs = 1000 / Math.max(1, fps);
      const actualFps = probe.avgFps || probe.rawFps;
      if (Math.abs(actualFps - fps) > 0.05) {
        throw new Error(
          `Encoded preview FPS mismatch: expected ${fps}, received ${actualFps.toFixed(3)}`
        );
      }
      if (Math.abs(probe.frameCount - expectedFrameCount) > 1) {
        throw new Error(
          `Encoded preview frame count mismatch: expected ${expectedFrameCount}, received ${probe.frameCount}`
        );
      }
      if (Math.abs(probe.durationMs - expectedDurationMs) > expectedFrameDurationMs + 5) {
        throw new Error(
          `Encoded preview duration mismatch: expected ${expectedDurationMs}ms, received ${probe.durationMs}ms`
        );
      }

      const bytes = await fs.readFile(outputPath);
      logger.info("Encoded template preview video", {
        userId: session.userId,
        sourceKind: sourceVideo ? "recorded-video" : "frame-sequence",
        frameCount: sourceVideo ? expectedFrameCount : frames.length,
        fps,
        verifiedFps: actualFps,
        verifiedFrameCount: probe.frameCount,
        verifiedDurationMs: probe.durationMs,
        verifiedWidth: probe.width,
        verifiedHeight: probe.height,
        outputBytes: bytes.length,
      });

      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "video/mp4",
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    return handleApiError(error, "Failed to encode preview video");
  }
}
