#!/usr/bin/env node
// Paints the sample texture materials (gold leaf, brushed silver, glass, embroidery thread)
// procedurally — no AI, no stock files — uploads them, and creates their TextEffect rows
// from TEXTURE_PRESETS in ./presets.mjs. Gold also gets a 3 s looping shimmer clip.
//
//   npm run seed:text-effect-textures                  # create missing rows with their files
//   npm run seed:text-effect-textures -- --dry-run     # only write the files to --out
//   npm run seed:text-effect-textures -- --overwrite   # also re-paint existing rows (files + spec)
//
// Non-destructive like the other catalogue seeds: an existing row is left alone unless
// --overwrite, and nothing else in the table is touched.
//
// Textures are 2048×768: cover-fitting scales them to the text box's height, and most
// text boxes are 2–3× wider than tall, so this keeps stitch and facet sizes steady
// between a one-word title and a long line.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createCanvas } from "canvas";
import sharp from "sharp";

import { TEXTURE_PRESETS } from "./presets.mjs";
import { deleteStorageForUrls } from "../../src/lib/storage/assetReferences.server.js";
import { getPublicStorageBucketName, uploadObject } from "../../src/lib/storage/objectStorage.server.js";
import { normalizeTextEffectCategory, storableTextEffectSpec } from "../../src/lib/textEffects/spec.js";

const W = 2048;
const H = 768;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[name] = true;
      continue;
    }
    args[name] = value;
    i += 1;
  }
  return args;
}

// ---- noise ------------------------------------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (edge0, edge1, x) => fade(clamp01((x - edge0) / (edge1 - edge0)));

// Smooth value noise over an integer lattice that wraps every `period` cells.
function valueNoise(seed, period = 512) {
  const rand = mulberry32(seed);
  const table = new Float32Array(period * period);
  for (let i = 0; i < table.length; i += 1) table[i] = rand();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = table[y0 * period + x0];
    const b = table[y0 * period + x1];
    const c = table[y1 * period + x0];
    const d = table[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(noise, x, y, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// One jittered feature point per `cell`-sized square; returns the nearest one.
function worley(seed, cell) {
  const rand = mulberry32(seed);
  const cols = Math.ceil(W / cell) + 2;
  const rows = Math.ceil(H / cell) + 2;
  const points = new Float32Array(cols * rows * 2);
  for (let i = 0; i < cols * rows; i += 1) {
    points[i * 2] = rand();
    points[i * 2 + 1] = rand();
  }
  return (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let best = Infinity;
    let fx = 0;
    let fy = 0;
    for (let j = -1; j <= 1; j += 1) {
      for (let i = -1; i <= 1; i += 1) {
        const gx = cx + i;
        const gy = cy + j;
        const index = ((gy + 1) * cols + (gx + 1)) * 2;
        const px = (gx + (points[index] ?? 0.5)) * cell;
        const py = (gy + (points[index + 1] ?? 0.5)) * cell;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < best) {
          best = d;
          fx = px;
          fy = py;
        }
      }
    }
    return { distance: Math.sqrt(best) / cell, dx: x - fx, dy: y - fy };
  };
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function ramp(stops) {
  const parsed = stops.map(([t, hex]) => [t, hexRgb(hex)]);
  return (value) => {
    const t = clamp01(value);
    for (let i = 1; i < parsed.length; i += 1) {
      if (t <= parsed[i][0]) {
        const [t0, a] = parsed[i - 1];
        const [t1, b] = parsed[i];
        const k = (t - t0) / Math.max(1e-6, t1 - t0);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      }
    }
    return parsed[parsed.length - 1][1];
  };
}

function paintPixels(paint) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(W, H);
  const data = image.data;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---- painters -----------------------------------------------------------------

// Liquid gold bands (domain-warped noise through a banded palette) with hammered facets:
// every Worley cell is a dimple lit from the top-left.
function paintGold(seed = 11) {
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 1);
  const n3 = valueNoise(seed + 2);
  const grain = mulberry32(seed + 4);
  const cells = worley(seed + 3, 44);
  const palette = ramp([
    [0, "#4a2f06"], [0.16, "#8a5d14"], [0.34, "#c8962c"], [0.5, "#f1cd72"],
    [0.62, "#fff1bf"], [0.74, "#e0b04a"], [0.88, "#9a6b18"], [1, "#5c3b0a"],
  ]);
  return paintPixels((x, y) => {
    const wx = x / 520 + 1.6 * fbm(n2, x / 700, y / 700, 3);
    const wy = y / 520 + 1.6 * fbm(n3, x / 700 + 7, y / 700, 3);
    let v = 0.5 + 0.5 * Math.sin(fbm(n1, wx, wy, 5) * Math.PI * 7);
    const facet = cells(x, y);
    const len = Math.hypot(facet.dx, facet.dy) || 1;
    // Light from the top-left: the dimple's lower-right wall faces it.
    const lit = (facet.dx * 0.7 + facet.dy * 0.7) / len;
    v += lit * smoothstep(0.05, 0.75, facet.distance) * 0.2;
    v += (grain() - 0.5) * 0.05;
    return palette(v).map((c) => Math.round(c));
  });
}

// Brushed metal: noise stretched along x for the brushing, a broad diagonal light band.
function paintSilver(seed = 21) {
  const n1 = valueNoise(seed, 1024);
  const n2 = valueNoise(seed + 1, 1024);
  const n3 = valueNoise(seed + 2);
  const palette = ramp([
    [0, "#53585f"], [0.22, "#858b93"], [0.45, "#c6cbd1"], [0.6, "#f3f5f7"],
    [0.75, "#b4b9c0"], [1, "#666c74"],
  ]);
  return paintPixels((x, y) => {
    const streak = fbm(n1, x / 900, y / 1.4, 4);
    const fine = n2(x / 60, y / 0.8);
    const band = 0.5 + 0.5 * Math.cos(((x * 0.45 + y) / W) * Math.PI * 2 * 1.3 + fbm(n3, x / 600, y / 600, 2) * 2.4);
    const v = 0.5 * band + 0.32 * streak + 0.18 * fine;
    return palette(v).map((c) => Math.round(c));
  });
}

// Glass: mostly clear, a cool tint, thin caustic lines, two reflection streaks and a top
// glare — alpha carries the material, so it lays over a see-through base.
function paintGlass(seed = 31) {
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 1);
  const gauss = (u, centre, width) => Math.exp(-(((u - centre) / width) ** 2));
  return paintPixels((x, y) => {
    const caustic = Math.pow(1 - Math.abs(Math.sin(fbm(n1, x / 300, y / 300, 4) * Math.PI * 6)), 16) * 0.7;
    const u = (x - y * 0.6) / W;
    const streak = gauss(u, 0.3, 0.035) * 0.85 + gauss(u, 0.38, 0.01) * 0.7 + gauss(u, 0.72, 0.05) * 0.35;
    const glare = Math.pow(Math.max(0, 1 - y / (H * 0.42)), 2) * 0.35;
    const highlight = clamp01(Math.max(caustic, streak) + glare);
    const tint = 0.16 + 0.14 * fbm(n2, x / 500, y / 500, 3);
    const alpha = clamp01(highlight + tint * (1 - highlight));
    const mix = alpha > 0 ? highlight / alpha : 0;
    const r = 172 + (255 - 172) * mix;
    const g = 208 + (255 - 208) * mix;
    const b = 255;
    return [Math.round(r), Math.round(g), b, Math.round(alpha * 255)];
  });
}

// Satin stitches in greyscale: rows of round threads at alternating angles, each thread
// broken into stitches with staggered ends, twisted fibres along it. "bw" mode tints it.
function paintThread(seed = 41) {
  const n1 = valueNoise(seed, 1024);
  const hash = (a, b) => {
    const h = Math.sin(a * 127.1 + b * 311.7 + seed) * 43758.5453;
    return h - Math.floor(h);
  };
  const rowHeight = H / 2;
  const spacing = 26;
  const stitch = 230;
  return paintPixels((x, y) => {
    const row = Math.floor(y / rowHeight);
    const angle = (row % 2 ? 1 : -1) * 0.95;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    const thread = Math.floor(v / spacing);
    const across = v / spacing - thread;
    const round = Math.pow(Math.sin(Math.PI * across), 0.6);
    const along = (u + hash(thread, row) * stitch) / stitch;
    const t = along - Math.floor(along);
    const gap = smoothstep(0, 0.035, t) * (1 - smoothstep(0.965, 1, t));
    const fibre = 0.84 + 0.16 * n1(u / 5 + across * 3, thread * 7.3);
    const tone = 0.84 + 0.16 * hash(thread * 3 + 1, row);
    const inRow = y - row * rowHeight;
    const seam = smoothstep(0, 10, inRow) * (1 - smoothstep(rowHeight - 10, rowHeight, inRow));
    const value = round * gap * fibre * tone * (0.5 + 0.5 * seam);
    const lum = Math.round(255 * (0.16 + 0.84 * value));
    return [lum, lum, lum];
  });
}

const PAINTERS = { gold: paintGold, silver: paintSilver, glass: paintGlass, thread: paintThread };

// A 3 s loop of the gold: a light sweep crosses in the first 70% and is off-canvas at both
// ends (so the loop has no seam), sparkles twinkle on whole-number periods of the loop.
async function renderShimmer(goldCanvas, outFile, seed = 51) {
  const width = 1024;
  const height = 384;
  const fps = 30;
  const frames = fps * 3;
  const rand = mulberry32(seed);
  const sparkles = Array.from({ length: 34 }, () => ({
    x: rand() * width,
    y: rand() * height,
    size: 6 + rand() * 12,
    phase: rand(),
    speed: 1 + Math.floor(rand() * 2),
  }));

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", "-an",
      outFile,
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  );
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`))));
  });

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  for (let f = 0; f < frames; f += 1) {
    const p = f / frames;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(goldCanvas, 0, 0, width, height);

    const sweep = p / 0.7;
    if (sweep <= 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(width / 2, height / 2);
      ctx.rotate(-0.38);
      const centre = -width * 0.95 + sweep * width * 1.9;
      const half = width * 0.11;
      const light = ctx.createLinearGradient(centre - half, 0, centre + half, 0);
      light.addColorStop(0, "rgba(255,244,210,0)");
      light.addColorStop(0.5, "rgba(255,244,210,0.5)");
      light.addColorStop(1, "rgba(255,244,210,0)");
      ctx.fillStyle = light;
      ctx.fillRect(-width * 1.5, -height * 3, width * 3, height * 6);
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of sparkles) {
      const glow = Math.pow(Math.max(0, Math.sin(Math.PI * 2 * (p * s.speed + s.phase))), 14);
      if (glow < 0.02) continue;
      const r = s.size * (0.6 + 0.4 * glow);
      const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      halo.addColorStop(0, `rgba(255,252,235,${0.9 * glow})`);
      halo.addColorStop(1, "rgba(255,252,235,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
      ctx.strokeStyle = `rgba(255,255,240,${0.8 * glow})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x - r * 1.6, s.y);
      ctx.lineTo(s.x + r * 1.6, s.y);
      ctx.moveTo(s.x, s.y - r * 1.6);
      ctx.lineTo(s.x, s.y + r * 1.6);
      ctx.stroke();
    }
    ctx.restore();

    if (!ffmpeg.stdin.write(canvas.toBuffer("raw"))) {
      await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
  }
  ffmpeg.stdin.end();
  await done;
}

async function encodeWebp(canvas, hasAlpha) {
  const png = canvas.toBuffer("image/png");
  const pipeline = sharp(png);
  // Same encoding as the dashboard's upload route: lossless where there is transparency.
  return hasAlpha ? pipeline.webp({ lossless: true }).toBuffer() : pipeline.webp({ quality: 92 }).toBuffer();
}

async function upload(slug, kind, body, contentType, extension) {
  const uploaded = await uploadObject({
    bucket: getPublicStorageBucketName(),
    key: `text-effects/${slug}-${kind}-${randomUUID()}.${extension}`,
    body,
    contentType,
    cacheControl: "public, max-age=31536000, immutable",
    skipExistenceCheck: true,
  });
  const url = String(uploaded?.url || "").trim();
  if (!url) throw new Error(`Upload for ${slug} (${kind}) returned no public URL`);
  return url;
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(String(args.out || path.join(os.tmpdir(), "text-effect-textures")));
const dryRun = Boolean(args["dry-run"]);
await mkdir(outDir, { recursive: true });

const prisma = dryRun ? null : new PrismaClient();
try {
  for (const preset of TEXTURE_PRESETS) {
    const existing = prisma ? await prisma.textEffect.findUnique({ where: { slug: preset.slug } }) : null;
    if (existing && !args.overwrite) {
      console.log(`${preset.slug}: row exists, left alone (pass --overwrite to re-paint).`);
      continue;
    }

    const started = Date.now();
    const painter = PAINTERS[preset.texture.painter];
    const canvas = painter();
    const hasAlpha = preset.texture.painter === "glass";
    const webp = await encodeWebp(canvas, hasAlpha);
    const imageFile = path.join(outDir, `${preset.slug}.webp`);
    await writeFile(imageFile, webp);
    let videoFile = null;
    if (preset.texture.video) {
      videoFile = path.join(outDir, `${preset.slug}.mp4`);
      await renderShimmer(canvas, videoFile);
    }
    console.log(
      `${preset.slug}: painted in ${((Date.now() - started) / 1000).toFixed(1)} s → ${imageFile} (${Math.round(webp.length / 1024)} KB)` +
        (videoFile ? ` + ${videoFile}` : "")
    );
    if (dryRun) continue;

    const textureUrl = await upload(preset.slug, "image", webp, "image/webp", "webp");
    const textureVideoUrl = videoFile
      ? await upload(preset.slug, "video", await readFile(videoFile), "video/mp4", "mp4")
      : null;
    // An inlay material ships as a file next to this script (not painted here).
    const inlayTextureUrl = preset.inlay?.file
      ? await upload(
          preset.slug,
          "inlay",
          await sharp(await readFile(new URL(preset.inlay.file, import.meta.url))).webp({ quality: 92 }).toBuffer(),
          "image/webp",
          "webp"
        )
      : null;

    const data = {
      titleEn: preset.titleEn,
      titleAr: preset.titleAr,
      category: normalizeTextEffectCategory(preset.category),
      spec: storableTextEffectSpec(preset.spec),
      textureUrl,
      textureVideoUrl,
      inlayTextureUrl,
    };
    if (existing) {
      await prisma.textEffect.update({ where: { id: existing.id }, data });
      // Row first, then storage: the old files are unreferenced only once the row moved on.
      const kept = [textureUrl, textureVideoUrl, inlayTextureUrl];
      await deleteStorageForUrls([existing.textureUrl, existing.textureVideoUrl, existing.inlayTextureUrl].filter((url) => url && !kept.includes(url)), {
        slug: preset.slug,
        reason: "texture re-painted",
      });
      console.log(`${preset.slug}: updated.`);
    } else {
      const last = await prisma.textEffect.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      await prisma.textEffect.create({
        data: { slug: preset.slug, ...data, isPremium: Boolean(preset.isPremium), sortOrder: (last?.sortOrder ?? -1) + 1 },
      });
      console.log(`${preset.slug}: created.`);
    }
  }
} finally {
  await prisma?.$disconnect();
}
