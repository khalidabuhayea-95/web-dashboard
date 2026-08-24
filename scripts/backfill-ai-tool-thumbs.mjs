#!/usr/bin/env node
// Builds the grid-sized card art (thumbUrl) for every AI template and magic
// tool that has full-size art but no thumbnail yet.
//
//   npm run backfill:ai-tool-thumbs [-- --overwrite] [--width 400]
//
// Why this exists: the mobile AI Tools tab lists 228 cards. At the full-size
// 1024px art (~140 KB each) that is a ~30 MB tab — unusable on mobile data. A
// 400px copy is ~15 KB, so the grid loads from thumbUrl and only fetches
// afterUrl when a tool is opened.
//
// Costs nothing but bandwidth: it re-encodes art that already exists, and never
// calls a model.

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
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
const WIDTH = Number(args.width || 400);
const BUCKET = getPublicStorageBucketName();

async function buildThumb(sourceUrl, keyPrefix, slug) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`source ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());

  // A cut-out's alpha channel is the result — flattening it onto white would
  // make the thumbnail advertise the opposite of what the tool does.
  const keepAlpha = Boolean((await sharp(source).metadata()).hasAlpha);
  const pipeline = sharp(source).resize(WIDTH, null, { withoutEnlargement: true });
  const body = keepAlpha
    ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
    : await pipeline.jpeg({ quality: 72, mozjpeg: true }).toBuffer();

  const uploaded = await uploadObject({
    bucket: BUCKET,
    key: `${keyPrefix}/${slug}-thumb.${keepAlpha ? "png" : "jpg"}`,
    body,
    contentType: keepAlpha ? "image/png" : "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
    upsert: true,
    skipExistenceCheck: true,
  });
  const url = String(uploaded.url || "").trim();
  if (!url) throw new Error("upload returned no public URL");
  const version = crypto.createHash("sha1").update(body).digest("hex").slice(0, 8);
  return { url: `${url}?v=${version}`, bytes: body.length };
}

const prisma = new PrismaClient();
try {
  const jobs = [
    { label: "magic tool", model: prisma.magicTool, prefix: "magic-tools" },
    { label: "template", model: prisma.aiTemplate, prefix: "ai-templates" },
  ];

  let done = 0;
  let savedFrom = 0;
  let savedTo = 0;
  const failures = [];

  for (const job of jobs) {
    const rows = await job.model.findMany({
      where: {
        afterUrl: { not: null },
        ...(args.overwrite ? {} : { thumbUrl: null }),
      },
      select: { id: true, slug: true, afterUrl: true },
    });
    if (!rows.length) {
      console.log(`No ${job.label}s need a thumbnail.`);
      continue;
    }
    console.log(`Building ${rows.length} ${job.label} thumbnail(s) at ${WIDTH}px…`);

    for (const row of rows) {
      try {
        const head = await fetch(row.afterUrl, { method: "HEAD" });
        savedFrom += Number(head.headers.get("content-length") || 0);
        const thumb = await buildThumb(row.afterUrl, job.prefix, row.slug);
        savedTo += thumb.bytes;
        await job.model.update({ where: { id: row.id }, data: { thumbUrl: thumb.url } });
        done += 1;
      } catch (error) {
        failures.push(`${row.slug}: ${error.message}`);
      }
    }
  }

  console.log(`\nBuilt ${done} thumbnail(s).`);
  if (done) {
    const mb = (value) => (value / 1024 / 1024).toFixed(1);
    console.log(`Catalogue art: ${mb(savedFrom)} MB full-size → ${mb(savedTo)} MB as thumbnails.`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const failure of failures) console.log(`  ${failure}`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
