#!/usr/bin/env node
// Seed the AiTemplateCategory / AiTemplate tables from the authoring library in
// scripts/ai-templates/presets.mjs, attaching rendered before/after card art.
//
//   npm run seed:ai-templates                      # prompts only
//   npm run seed:ai-templates -- --renders <dir>   # prompts + card art
//
// The library file decides WHICH templates exist: rows are inserted by slug and
// anything not in the library is deleted, so a seed makes the catalog match the
// library exactly. Pass --keep-extra to skip the deleting.
//
// The dashboard decides what a template SAYS: for rows that already exist, the
// seed leaves titles, prompts, model, input kind and cost alone, so re-seeding
// never reverts an admin's edits. Pass --overwrite-content to force the library
// text back over them, and --overwrite-art to replace existing card art.
//
// --renders is optional and points at the output folder of
// render-ai-templates.mjs ({slug}.before.jpg + {slug}.after.png pairs). Art is
// downscaled and uploaded to the public R2 bucket under ai-templates/, and rows
// store the public URLs. Presets with no rendered art are still inserted, and
// show in the dashboard as needing a render.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { PRESETS, CATEGORIES } from "./ai-templates/presets.mjs";
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
  const extensions =
    kind === "after"
      ? [".after.png", ".after.jpg"]
      : [".before.jpg", ".before.jpeg", ".before.png"];
  for (const extension of extensions) {
    const candidate = path.join(rendersDir, `${slug}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function publishImage(sourcePath, name, width) {
  const body = await sharp(sourcePath)
    .resize(width, null, { withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const uploaded = await uploadObject({
    bucket: BUCKET,
    key: `ai-templates/${name}.jpg`,
    body,
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
    upsert: true,
    skipExistenceCheck: true,
  });
  const url = String(uploaded.url || "").trim();
  if (!url) throw new Error(`Upload for ${name} returned no public URL.`);
  // The key is stable but the served URL must change whenever the CONTENT
  // changes — the immutable cache header means a same-URL replacement stays
  // invisible to every browser that ever loaded the old art.
  const version = crypto.createHash("sha1").update(body).digest("hex").slice(0, 8);
  return `${url}?v=${version}`;
}


// Grid-sized copy of the card art. The app lists 200+ cards, and the full-size
// art averages ~140 KB — listing those directly is a ~30 MB tab on mobile data.
const THUMB_WIDTH = 400;

const prisma = new PrismaClient();
try {
  const categoryIds = new Map();
  for (const [index, category] of CATEGORIES.entries()) {
    const row = await prisma.aiTemplateCategory.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        titleEn: category.titleEn,
        titleAr: category.titleAr,
        sortOrder: index,
      },
      update: {
        titleEn: category.titleEn,
        titleAr: category.titleAr,
        sortOrder: index,
      },
    });
    categoryIds.set(category.slug, row.id);
  }

  // NOTE: categories the library no longer defines are pruned at the END, after
  // every template has been upserted into its (possibly new) category. Pruning
  // here would cascade-delete rows that are merely MOVING between categories,
  // taking their card art with them.

  let withArt = 0;
  const bare = [];
  const skippedCreates = [];
  const perCategoryOrder = new Map();
  for (const preset of PRESETS) {
    const sortOrder = perCategoryOrder.get(preset.category) ?? 0;
    perCategoryOrder.set(preset.category, sortOrder + 1);

    // A library preset with no DB row is either brand-new or something the
    // admin deleted in the dashboard — and the seed cannot tell which. Deleted
    // must stay deleted, so creation requires an explicit --create.
    const existing = await prisma.aiTemplate.findUnique({
      where: { slug: preset.slug },
      select: { afterUrl: true },
    });
    if (!existing && !args.create) {
      skippedCreates.push(preset.slug);
      continue;
    }

    // Generation-only presets have an after image and no before, so the after
    // alone is enough to count as having card art.
    const beforePath = findRender(preset.slug, "before");
    const afterPath = findRender(preset.slug, "after");
    let beforeUrl = null;
    let afterUrl = null;
    let thumbUrl = null;
    if (afterPath) {
      afterUrl = await publishImage(afterPath, `${preset.slug}-after`, 1024);
      thumbUrl = await publishImage(afterPath, `${preset.slug}-thumb`, THUMB_WIDTH);
      if (beforePath) {
        beforeUrl = await publishImage(beforePath, `${preset.slug}-before`, 640);
      }
      withArt += 1;
    } else {
      bare.push(preset.slug);
    }

    const data = {
      categoryId: categoryIds.get(preset.category),
      titleEn: preset.titleEn,
      titleAr: preset.titleAr,
      prompt: preset.prompt,
      model: preset.model || "google/nano-banana",
      referenceKind: preset.reference,
      creditCost: preset.creditCost,
      isPremium: preset.isPremium,
      sortOrder,
    };
    // The dashboard is the source of truth once a template exists: re-seeding
    // must not silently revert an admin's edits to titles, prompts, costs or
    // category. Existing rows keep their content unless --overwrite-content.
    // sortOrder is dashboard state too — the admin drags cards into the order
    // they want, so a re-seed must not renumber them from the library. Only a
    // brand-new row takes its position from the library.
    const contentFields = args["overwrite-content"] ? data : {};
    // Art curated in the dashboard (the in-modal Generate flow) wins over batch
    // output: only fill art where the row has none, unless --overwrite-art.
    const art =
      afterUrl && (args["overwrite-art"] || !existing?.afterUrl) ? { beforeUrl, afterUrl, thumbUrl } : {};
    await prisma.aiTemplate.upsert({
      where: { slug: preset.slug },
      create: { slug: preset.slug, ...data, ...(afterUrl ? { beforeUrl, afterUrl, thumbUrl } : {}) },
      update: { ...contentFields, ...art },
    });
  }

  if (!args["keep-extra"]) {
    const removedTemplates = await prisma.aiTemplate.deleteMany({
      where: { slug: { notIn: PRESETS.map((preset) => preset.slug) } },
    });
    if (removedTemplates.count) {
      console.log(`Removed ${removedTemplates.count} template(s) not in the library.`);
    }
    const removedCategories = await prisma.aiTemplateCategory.deleteMany({
      where: { slug: { notIn: CATEGORIES.map((category) => category.slug) } },
    });
    if (removedCategories.count) {
      console.log(`Removed ${removedCategories.count} empty category(ies) not in the library.`);
    }
  }

  console.log(
    `Seeded ${CATEGORIES.length} categories, ${PRESETS.length - skippedCreates.length} templates (${withArt} art updates).`
  );
  if (skippedCreates.length) {
    console.log(
      `Skipped ${skippedCreates.length} library preset(s) with no DB row (deleted in the dashboard, or new — pass --create to add): ${skippedCreates.join(", ")}`
    );
  }
  if (bare.length) {
    console.log(`Awaiting a render: ${bare.length} template(s).`);
  }
} finally {
  await prisma.$disconnect();
}
