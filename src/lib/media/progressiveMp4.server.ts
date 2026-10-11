/**
 * Fragmented MP4 → progressive MP4.
 *
 * Canva streams element videos as DASH fragments; the extension's capture concatenates them into
 * a file whose top level is `ftyp(…dash) moov sidx moof mdat moof mdat …`. ffprobe reads it, but
 * Chrome's <video> never reaches `loadedmetadata` on such a file served progressively (the
 * arched Kaaba clip on DAHR94gu0m0 sat at readyState 0 for ever). A stream copy with the moov
 * up front (`-c copy -movflags +faststart`) makes it an ordinary `ftyp moov mdat` file.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFfmpeg } from "@/lib/media/ffmpeg.server";

/** True when the file's top-level boxes include `moof` (movie fragments). Pure; no ffmpeg. */
export function isFragmentedMp4(bytes: Uint8Array): boolean {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  let boxes = 0;
  while (offset + 8 <= data.byteLength && boxes < 64) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    if (size === 1) {
      if (offset + 16 > data.byteLength) return false;
      size = Number(view.getBigUint64(offset + 8));
    } else if (size === 0) {
      size = data.byteLength - offset;
    }
    if (boxes === 0 && type !== "ftyp") return false;
    if (type === "moof") return true;
    if (size < 8) return false;
    offset += size;
    boxes += 1;
  }
  return false;
}

export async function remuxToProgressiveMp4(bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "nayroz-remux-"));
  const input = path.join(dir, "in.mp4");
  const output = path.join(dir, "out.mp4");
  try {
    await writeFile(input, bytes);
    await runFfmpeg(["-v", "error", "-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output]);
    const remuxed = await readFile(output);
    if (remuxed.byteLength < 64 || isFragmentedMp4(remuxed)) {
      throw new Error("remux produced no progressive file");
    }
    return new Uint8Array(remuxed.buffer, remuxed.byteOffset, remuxed.byteLength);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
