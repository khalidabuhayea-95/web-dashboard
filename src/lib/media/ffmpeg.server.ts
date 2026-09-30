/**
 * ffmpeg and ffprobe for the routes that encode and cut video (the editor's preview encode and the
 * video trim).
 *
 * Both binaries come from npm: `ffmpeg-static` downloads a static ffmpeg for the host at install
 * time, and `@ffprobe-installer/ffprobe` pulls in the matching platform's ffprobe. A bare
 * `spawn("ffmpeg")` depended on a system install that neither the dev Macs nor the Docker image had,
 * so every preview failed with `spawn ffmpeg ENOENT`.
 *
 * Lookup order per tool: FFMPEG_PATH / FFPROBE_PATH, then the npm binary, then whatever is on PATH.
 * Both packages must stay in `serverExternalPackages` (next.config.mjs): they locate the binary
 * relative to their own directory, which bundling rewrites.
 */
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";

type MediaTool = "ffmpeg" | "ffprobe";

const require = createRequire(import.meta.url);

const PATH_OVERRIDE_ENV: Record<MediaTool, string> = {
  ffmpeg: "FFMPEG_PATH",
  ffprobe: "FFPROBE_PATH",
};

const resolvedBinaries = new Map<MediaTool, string>();

export class MediaToolMissingError extends Error {
  status: number;
  code: string;

  constructor(tool: MediaTool) {
    super(
      `${tool} is not available on this server. Run \`npm install\` to fetch the bundled binary, ` +
        `or set ${PATH_OVERRIDE_ENV[tool]} to an installed ${tool}.`
    );
    this.name = "MediaToolMissingError";
    this.status = 501;
    this.code = "media_tool_missing";
  }
}

function isExecutable(filePath: string) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findBundledBinary(tool: MediaTool): string | null {
  try {
    // ffmpeg-static exports the path, even when its install-time download never ran, so it is
    // checked on disk. ffprobe-installer exports { path } and throws when its platform package is
    // missing.
    const candidate =
      tool === "ffmpeg"
        ? (require("ffmpeg-static") as string | null)
        : (require("@ffprobe-installer/ffprobe") as { path?: string }).path;
    return candidate && isExecutable(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveBinary(tool: MediaTool): string {
  const cached = resolvedBinaries.get(tool);
  if (cached) return cached;
  const override = String(process.env[PATH_OVERRIDE_ENV[tool]] || "").trim();
  const resolved = override || findBundledBinary(tool) || tool;
  resolvedBinaries.set(tool, resolved);
  return resolved;
}

function runTool(tool: MediaTool, args: string[], captureStdout: boolean) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(resolveBinary(tool), args, {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new MediaToolMissingError(tool) : error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8").trim());
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(stderr || `${tool} exited with code ${code}`));
    });
  });
}

/** Runs ffmpeg. Rejects with its stderr when it exits non-zero. */
export async function runFfmpeg(args: string[]): Promise<void> {
  await runTool("ffmpeg", args, false);
}

/** Runs ffprobe and resolves with its trimmed stdout. */
export function runFfprobe(args: string[]): Promise<string> {
  return runTool("ffprobe", args, true);
}
