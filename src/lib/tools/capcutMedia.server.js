import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { runFfmpeg, runFfprobe } from "../media/ffmpeg.server";

import { readZipEntries } from "./capcutFonts.server.js";

// Photo edits the CapCut import bakes into the uploaded image, so the editor and the app need no
// support for them: the crop (capcutCropRect) and a rectangle/ellipse mask (capcutMaskShape).
// Both are measured on the DOWNLOADED pixels — CapCut's material size and its download can differ.

/** Cut a photo to its CapCut crop (normalized rect). PNG keeps the cut-outs' alpha. */
export async function cropCapcutImage(bytes, crop) {
  const image = sharp(bytes, { failOn: "none" });
  const { width = 0, height = 0 } = await image.metadata();
  if (!width || !height) throw new Error("unreadable image");
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.x0 * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.y0 * height)));
  const right = Math.min(width, Math.max(left + 1, Math.round(crop.x1 * width)));
  const bottom = Math.min(height, Math.max(top + 1, Math.round(crop.y1 * height)));
  return image.extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Alpha matte (0–255 per pixel, 255 keeps) of a CapCut mask over a width×height image, ported from
 * CapCut's own "Rectangle" videomask (resource 6791700809454195207: picture.frag/.vert +
 * Process.lua). A pixel's distance r is the scale at which the mask's rounded rect passes through
 * it — half-sides `width`/`height` × the image's, measured in image-height units so corners stay
 * round — and its alpha is 1 − smoothstep(1 − d, 1 + d, r) with d = 6 × feather: the feather is
 * relative to EACH side of the box and spreads far past it (feather 1 still shows the photo's own
 * edges faintly, as CapCut's render does). Ellipses take the same edge on the ellipse's r (their
 * shader is not read yet). Centre in half-size units, y up; rotation in degrees. Pure.
 */
export function capcutMaskMatte(mask, width, height) {
  const aspect = width / height;
  const theta = (Number(mask.rotation || 0) * Math.PI) / 180;
  const quarter = Math.PI / 2;
  const phase = ((((theta % quarter) + quarter) % quarter) / (Math.PI / 4)) - 1;
  const decay = Math.sqrt(Math.sqrt(Math.max(0, 1 - phase * phase)));
  const diff = 6 * Math.max(0, Number(mask.feather) || 0) + decay * 0.005;
  const halfX = Math.max(1e-6, Number(mask.width) || 0) * aspect;
  const halfY = Math.max(1e-6, Number(mask.height) || 0);
  const radius = Math.min(halfX, halfY) * Math.max(0, Number(mask.roundCorner) || 0);
  const cornerX = halfX - radius;
  const cornerY = halfY - radius;
  const cornerA = cornerX * cornerX + cornerY * cornerY - radius * radius;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const centerX = Number(mask.centerX) || 0;
  const centerY = Number(mask.centerY) || 0;
  const matte = new Uint8Array(width * height);
  if (mask.shape === "mirror") return mirrorMatte(mask, width, height, matte);
  for (let py = 0; py < height; py += 1) {
    const sy0 = 1 - ((py + 0.5) / height) * 2 - centerY;
    for (let px = 0; px < width; px += 1) {
      const sx0 = (((px + 0.5) / width) * 2 - 1 - centerX) * aspect;
      const x = Math.abs(cos * sx0 - sin * sy0);
      const y = Math.abs(sin * sx0 + cos * sy0);
      let r;
      if (mask.shape === "ellipse") {
        r = Math.hypot(x / halfX, y / halfY);
      } else if (y * cornerX >= halfY * x) {
        r = y / halfY;
      } else if (y * halfX <= cornerY * x) {
        r = x / halfX;
      } else {
        const b = -2 * (x * cornerX + y * cornerY);
        const c = x * x + y * y;
        if (Math.abs(cornerA) < 1e-8) r = Math.abs(b) < 1e-8 ? 100 : -c / b;
        else r = (-b - Math.sqrt(Math.max(0, b * b - 4 * cornerA * c))) / (2 * cornerA);
      }
      const edge = smoothstep(1 - diff, 1 + diff, r);
      matte[py * width + px] = Math.round((mask.invert ? edge : 1 - edge) * 255);
    }
  }
  return matte;
}
/**
 * CapCut's "Mirror" videomask (resource 6791699060140020232): a band across the image — kept where
 * the distance along the band's normal (−sin r, cos r), r = −rotation, in the same height units
 * as the rectangle's, is under `height`; the edge is smoothstep(height ± feather), feather NOT ×6.
 */
function mirrorMatte(mask, width, height, matte) {
  const aspect = width / height;
  const theta = (-Number(mask.rotation || 0) * Math.PI) / 180;
  const quarter = Math.PI / 2;
  const phase = ((((theta % quarter) + quarter) % quarter) / (Math.PI / 4)) - 1;
  const decay = Math.sqrt(Math.sqrt(Math.max(0, 1 - phase * phase)));
  const diff = Math.max(0, Number(mask.feather) || 0) + 0.005 * decay;
  const band = Math.max(1e-6, Number(mask.height) || 0);
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  const centerX = Number(mask.centerX) || 0;
  const centerY = Number(mask.centerY) || 0;
  for (let py = 0; py < height; py += 1) {
    const y = 1 - ((py + 0.5) / height) * 2 - centerY;
    for (let px = 0; px < width; px += 1) {
      const x = (((px + 0.5) / width) * 2 - 1 - centerX) * aspect;
      const edge = smoothstep(band - diff, band + diff, Math.abs(nx * x + ny * y));
      matte[py * width + px] = Math.round((mask.invert ? edge : 1 - edge) * 255);
    }
  }
  return matte;
}

export async function maskCapcutImage(bytes, mask) {
  const { data, info } = await sharp(bytes, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (!width || !height) throw new Error("unreadable image");
  const matte = capcutMaskMatte(mask, width, height);
  for (let index = 3, pixel = 0; index < data.length; index += 4, pixel += 1) {
    data[index] = Math.round((data[index] * matte[pixel]) / 255);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Frame count, loop length and first frame (PNG) of an animated GIF. CapCut's sticker GIFs loop
 * forever (GIF loop count 0); a missing frame delay counts as 100 ms, the browsers' default.
 */
export async function animatedGifInfo(bytes) {
  const meta = await sharp(bytes, { animated: true, failOn: "none" }).metadata();
  const frameCount = Math.max(1, Number(meta.pages) || 1);
  const delays = Array.isArray(meta.delay) ? meta.delay : [];
  let durationMs = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const delay = Number(delays[frame]);
    durationMs += delay > 0 ? delay : 100;
  }
  const poster = await sharp(bytes, { page: 0, failOn: "none" }).png().toBuffer();
  return { frameCount, durationMs, loop: !meta.loop, poster };
}

const DEFAULT_STICKER_FPS = 16;

/**
 * CapCut's real sticker asset (heycan item_urls[0]): a zip with an RGBA sprite sheet
 * (SequenceMap.png), its TexturePacker frame list (ani_info.json) and the Lua that plays it
 * (`controller:setFps(16)`). Rebuilt here as a lossless animated WebP, so the glow keeps its soft
 * alpha — the GIF preview CapCut also lists dithers it to speckles. Returns the WebP, its frame
 * timing and the first frame as a PNG poster.
 */
export async function capcutStickerWebp(zipBytes) {
  const entries = readZipEntries(zipBytes);
  const infoEntry = Object.keys(entries).find((name) => /(^|\/)ani_info\.json$/i.test(name) && !/__MACOSX/.test(name));
  if (!infoEntry) throw new Error("no ani_info.json");
  const info = JSON.parse(entries[infoEntry].toString("utf8"));
  const sheetName = String(info?.meta?.image || "SequenceMap.png");
  const sheetEntry = Object.keys(entries).find((name) => name.split("/").pop() === sheetName && !/__MACOSX/.test(name));
  if (!sheetEntry) throw new Error(`no ${sheetName}`);
  const frames = (Array.isArray(info.frames) ? info.frames : Object.values(info.frames || {}))
    .slice()
    .sort((a, b) => String(a.filename || "").localeCompare(String(b.filename || ""), "en", { numeric: true }));
  if (frames.length === 0) throw new Error("no frames");
  const luaEntry = Object.keys(entries).find((name) => /\.lua$/i.test(name) && !/__MACOSX/.test(name));
  const fps = Number(/setFps\(\s*([\d.]+)\s*\)/.exec(luaEntry ? entries[luaEntry].toString("utf8") : "")?.[1]) || DEFAULT_STICKER_FPS;
  const frameMs = Math.max(20, Math.round(1000 / fps));

  const sheet = entries[sheetEntry];
  const width = Math.round(frames[0].sourceSize?.w || frames[0].frame.w);
  const height = Math.round(frames[0].sourceSize?.h || frames[0].frame.h);
  const pngFrames = [];
  for (const frame of frames) {
    const rect = frame.frame;
    // TexturePacker: a rotated frame is stored turned 90° clockwise, so its sheet box is h × w.
    const box = frame.rotated
      ? { left: rect.x, top: rect.y, width: rect.h, height: rect.w }
      : { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
    let cell = sharp(sheet).extract(box);
    if (frame.rotated) cell = cell.rotate(-90);
    const cut = await cell.png().toBuffer();
    // A trimmed frame goes back to its full canvas at its offset.
    const offset = frame.spriteSourceSize || { x: 0, y: 0 };
    pngFrames.push(
      await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: cut, left: Math.round(offset.x || 0), top: Math.round(offset.y || 0) }])
        .png()
        .toBuffer()
    );
  }
  const webp = await sharp(pngFrames, { join: { animated: true } })
    .webp({ lossless: true, loop: 0, delay: pngFrames.map(() => frameMs) })
    .toBuffer();
  return { bytes: webp, width, height, frameCount: pngFrames.length, durationMs: frameMs * pngFrames.length, poster: pngFrames[0] };
}

// Image-sequence effects play at this rate (the .seq header field all of them carry).
const CAPCUT_SEQUENCE_FPS = 24;

/** The package's frame sequence: the largest numbered PNG run under image/ (a0…a77, 1a0…1a78). */
function sequenceFrameNames(entries) {
  const groups = new Map();
  for (const name of Object.keys(entries)) {
    if (/__MACOSX/.test(name)) continue;
    const match = /(?:^|\/)image\/([^/]*?)(\d+)\.png$/i.exec(name);
    if (!match) continue;
    if (!groups.has(match[1])) groups.set(match[1], []);
    groups.get(match[1]).push({ name, index: Number(match[2]) });
  }
  const [frames = []] = [...groups.values()].sort((a, b) => b.length - a.length);
  return frames.sort((a, b) => a.index - b.index).map((frame) => frame.name);
}

/** Centre crop of a width×height frame to the canvas [aspect] (CapCut's "Fill" / CenterCrop). */
function coverCrop(width, height, aspect) {
  if (width / height > aspect) {
    const cropWidth = Math.max(1, Math.round(height * aspect));
    return { left: Math.round((width - cropWidth) / 2), top: 0, width: cropWidth, height };
  }
  const cropHeight = Math.max(1, Math.round(width / aspect));
  return { left: 0, top: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

/**
 * A CapCut overlay effect rebuilt as a lossless animated WebP for the canvas [aspect], at the
 * source's own pixels:
 * - a video effect (Gossamer Veil) packs colour on the left half and alpha on the right
 *   (LumiAnimSeqLoadAndCrop, enableVideoAlphaBlend), the colour premultiplied → halves merged,
 *   un-premultiplied, "Fill"-cropped;
 * - an image-sequence effect (gold dust, star rain, light leak: image/<prefix><n>.png, 24 fps)
 *   CenterCrops each frame and blends it SCREEN (or LinearDodge, the additive cousin that looks
 *   the same for faint light) → the frames stay as drawn (light on black) and the layer gets
 *   `blendMode: "screen"`, which the editor canvas and the app both composite. A normal-blended
 *   copy cannot stand in: coloured light screened over white stays white.
 * The effect plays at [speed] from its start; [fromMs]/[toMs] are the part of that clock the layer
 * shows (the last frame holds to the end). A [loop] effect ships exactly one cycle instead.
 */
export async function capcutEffectOverlayWebp(zipBytes, { aspect = 9 / 16, speed = 1, fromMs = 0, toMs, loop = false } = {}) {
  const entries = readZipEntries(zipBytes);
  const dir = await mkdtemp(path.join(tmpdir(), "nayroz-capcut-effect-"));
  try {
    let sources;
    let fps;
    let mode;
    const videoEntry = Object.keys(entries).find((name) => /(^|\/)resource\/video\/[^/]+\.mp4$/i.test(name) && !/__MACOSX/.test(name));
    if (videoEntry) {
      const input = path.join(dir, "overlay.mp4");
      await writeFile(input, entries[videoEntry]);
      const [rate = "24/1"] = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", input])).split(/\s+/);
      const [num, den] = rate.split("/").map(Number);
      fps = num > 0 && den > 0 ? num / den : 24;
      const crop = `crop='min(iw,ih*${aspect})':'min(ih,iw/${aspect})'`;
      await runFfmpeg([
        "-v", "error", "-y", "-i", input,
        "-filter_complex", `[0:v]split[l][r];[l]crop=iw/2:ih:0:0[c];[r]crop=iw/2:ih:iw/2:0,format=gray[a];[c][a]alphamerge,${crop},format=rgba`,
        path.join(dir, "f_%04d.png"),
      ]);
      const names = (await readdir(dir)).filter((name) => /^f_\d+\.png$/.test(name)).sort();
      sources = names.map((name) => () => readFile(path.join(dir, name)));
      mode = "premultiplied";
    } else {
      const names = sequenceFrameNames(entries);
      if (names.length === 0) throw new Error("no overlay video or frame sequence in the effect package");
      fps = CAPCUT_SEQUENCE_FPS;
      sources = names.map((name) => async () => {
        const image = sharp(entries[name]);
        const { width, height } = await image.metadata();
        return image.extract(coverCrop(width, height, aspect)).png().toBuffer();
      });
      const shader = Object.keys(entries).find((name) => /\.frag$/i.test(name) && /#define\s+BLEND_MODE\s+blend/.test(entries[name].toString("utf8")));
      mode = shader && /#define\s+BLEND_MODE\s+blend(Screen|LinearDodge|Add|Lighten)\b/.test(entries[shader].toString("utf8")) ? "screen" : "normal";
    }
    if (sources.length === 0) throw new Error("overlay has no frames");
    const frameMs = 1000 / (fps * Math.max(0.01, speed));
    const startAt = loop ? 0 : fromMs;
    const endMs = loop ? sources.length * frameMs : Number.isFinite(toMs) ? toMs : sources.length * frameMs;
    const picked = [];
    const delays = [];
    sources.forEach((source, index) => {
      const startMs = index * frameMs;
      const nextMs = index === sources.length - 1 && !loop ? Infinity : startMs + frameMs;
      if (nextMs <= startAt || startMs >= endMs) return;
      picked.push(source);
      // Rounded on the shared boundaries, so the delays add up to the window exactly.
      delays.push(Math.max(1, Math.round(Math.min(nextMs, endMs) - startAt) - Math.round(Math.max(startMs, startAt) - startAt)));
    });
    const pngFrames = [];
    let size = null;
    for (const source of picked) {
      const { data, info } = await sharp(await source()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = data[offset + 3];
        if (mode === "premultiplied" && alpha !== 0 && alpha !== 255) {
          for (let channel = 0; channel < 3; channel += 1) {
            data[offset + channel] = Math.min(255, Math.round((data[offset + channel] * 255) / alpha));
          }
        }
      }
      size = { width: info.width, height: info.height };
      pngFrames.push(await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
    }
    const webp = await sharp(pngFrames, { join: { animated: true } })
      .webp({ lossless: true, loop: 0, delay: delays })
      .toBuffer();
    return {
      bytes: webp,
      ...size,
      frameCount: pngFrames.length,
      durationMs: delays.reduce((sum, delay) => sum + delay, 0),
      loop: Boolean(loop),
      blendMode: mode === "screen" ? "screen" : null,
      poster: pngFrames[0],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The frame a clip shows first (at `seconds` into the file), as a JPEG — the video layer's poster.
 * The editor paints a video layer transparent until its first frame decodes (≈0.4 s for CapCut's
 * clips), so without a poster the black page flashed at every scene that opens on a video.
 */
export async function videoPosterFrame(bytes, seconds = 0) {
  const dir = await mkdtemp(path.join(tmpdir(), "nayroz-poster-"));
  const input = path.join(dir, "in.mp4");
  const output = path.join(dir, "poster.jpg");
  try {
    await writeFile(input, bytes);
    const at = Math.max(0, Number(seconds) || 0).toFixed(3);
    await runFfmpeg(["-v", "error", "-y", "-ss", at, "-i", input, "-frames:v", "1", "-q:v", "3", output]);
    const poster = await readFile(output);
    if (poster.length === 0) throw new Error("no frame");
    return poster;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
