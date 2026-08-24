#!/usr/bin/env node
// Seeds the MagicTool table from scripts/magic-tools/presets.mjs.
//
//   npm run seed:magic-tools                      # prompts/config only
//   npm run seed:magic-tools -- --renders <dir>   # + card art
//
// Same contract as the AI-template seed, learned the hard way there: the
// library decides what MAY exist, the dashboard decides what a tool SAYS.
//   * a preset with no row is only inserted with --create — otherwise a tool
//     the admin deleted would come back on every seed;
//   * existing rows keep their text, model, cost and order unless
//     --overwrite-content, so re-seeding never reverts a dashboard edit;
//   * art only fills a blank slot unless --overwrite-art.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { PRESETS } from "./magic-tools/presets.mjs";
import {
  getPublicStorageBucketName,
  uploadObject,
} from "../src/lib/storage/objectStorage.server.js";

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

const args = parseArgs(process.argv.slice(2));
const rendersDir = args.renders ? path.resolve(process.cwd(), args.renders) : null;
if (rendersDir && !fs.existsSync(rendersDir)) {
  console.error(`Renders folder not found: ${rendersDir}`);
  process.exit(1);
}
const BUCKET = rendersDir ? getPublicStorageBucketName() : "";

function findRender(slug, kind) {
  if (!rendersDir) return null;
  const extensions = kind === "after" ? [".after.png", ".after.jpg"] : [".before.jpg", ".before.png"];
  for (const extension of extensions) {
    const candidate = path.join(rendersDir, `${slug}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function publishImage(sourcePath, name, width) {
  // A cut-out's alpha channel IS the result — flattening it to JPEG would show
  // the tool doing nothing. Anything transparent stays PNG.
  const metadata = await sharp(sourcePath).metadata();
  const keepAlpha = Boolean(metadata.hasAlpha);
  const pipeline = sharp(sourcePath).resize(width, null, { withoutEnlargement: true });
  const body = keepAlpha
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : await pipeline.jpeg({ quality: 82 }).toBuffer();

  const uploaded = await uploadObject({
    bucket: BUCKET,
    key: `magic-tools/${name}.${keepAlpha ? "png" : "jpg"}`,
    body,
    contentType: keepAlpha ? "image/png" : "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
    upsert: true,
    skipExistenceCheck: true,
  });
  const url = String(uploaded.url || "").trim();
  if (!url) throw new Error(`Upload for ${name} returned no public URL.`);
  // The key is stable but the served URL must change whenever the CONTENT
  // does — the immutable cache header makes a same-URL replacement invisible.
  const version = crypto.createHash("sha1").update(body).digest("hex").slice(0, 8);
  return `${url}?v=${version}`;
}


// Grid-sized copy of the card art. The app lists 200+ cards, and the full-size
// art averages ~140 KB — listing those directly is a ~30 MB tab on mobile data.
const THUMB_WIDTH = 400;

const prisma = new PrismaClient();
try {
  let withArt = 0;
  const bare = [];
  const skippedCreates = [];

  for (const [index, preset] of PRESETS.entries()) {
    const existing = await prisma.magicTool.findUnique({
      where: { slug: preset.slug },
      select: { afterUrl: true },
    });
    if (!existing && !args.create) {
      skippedCreates.push(preset.slug);
      continue;
    }

    const beforePath = findRender(preset.slug, "before");
    const afterPath = findRender(preset.slug, "after");
    let beforeUrl = null;
    let afterUrl = null;
    let thumbUrl = null;
    if (afterPath) {
      afterUrl = await publishImage(afterPath, `${preset.slug}-after`, 1024);
      thumbUrl = await publishImage(afterPath, `${preset.slug}-thumb`, THUMB_WIDTH);
      if (beforePath) beforeUrl = await publishImage(beforePath, `${preset.slug}-before`, 640);
      withArt += 1;
    } else {
      bare.push(preset.slug);
    }

    const data = {
      titleEn: preset.titleEn,
      titleAr: preset.titleAr,
      subtitleAr: preset.subtitleAr || "",
      prompt: preset.prompt || "",
      model: preset.model,
      modelOptions: preset.modelOptions ?? null,
      creditCost: preset.creditCost,
      isPremium: Boolean(preset.isPremium),
      sortOrder: index,
    };
    const contentFields = args["overwrite-content"] ? data : {};
    const art = afterUrl && (args["overwrite-art"] || !existing?.afterUrl) ? { beforeUrl, afterUrl, thumbUrl } : {};

    await prisma.magicTool.upsert({
      where: { slug: preset.slug },
      create: { slug: preset.slug, ...data, ...(afterUrl ? { beforeUrl, afterUrl, thumbUrl } : {}) },
      update: { ...contentFields, ...art },
    });
  }

  if (!args["keep-extra"]) {
    const removed = await prisma.magicTool.deleteMany({
      where: { slug: { notIn: PRESETS.map((preset) => preset.slug) } },
    });
    if (removed.count) console.log(`Removed ${removed.count} tool(s) not in the library.`);
  }

  console.log(
    `Seeded ${PRESETS.length - skippedCreates.length} magic tool(s) (${withArt} art updates).`
  );
  if (skippedCreates.length) {
    console.log(
      `Skipped ${skippedCreates.length} preset(s) with no DB row (deleted in the dashboard, or new — pass --create): ${skippedCreates.join(", ")}`
    );
  }
  if (bare.length) console.log(`Awaiting a render: ${bare.join(", ")}`);
} finally {
  await prisma.$disconnect();
}
