#!/usr/bin/env node
// Seeds the TextEffect table from scripts/text-effects/presets.mjs.
//
//   npm run seed:text-effects -- --create        # first run / add new presets
//   npm run seed:text-effects -- --overwrite-content
//
// Same non-destructive contract as the other catalogues: the library decides
// what MAY exist, the dashboard decides what an effect looks like. A preset
// with no row is only inserted with --create, so an effect the admin deleted
// stays deleted; existing rows keep their spec unless --overwrite-content.

import { PrismaClient } from "@prisma/client";
import { PRESETS } from "./text-effects/presets.mjs";
import { normalizeTextEffectSpec } from "../src/lib/textEffects/spec.js";

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
const prisma = new PrismaClient();

try {
  const skipped = [];
  let touched = 0;

  for (const [index, preset] of PRESETS.entries()) {
    const existing = await prisma.textEffect.findUnique({
      where: { slug: preset.slug },
      select: { id: true },
    });
    if (!existing && !args.create) {
      skipped.push(preset.slug);
      continue;
    }

    // Normalised here too: the seed must not be a way to slip an unrenderable
    // spec past the validation the API does.
    const data = {
      titleEn: preset.titleEn,
      titleAr: preset.titleAr,
      spec: normalizeTextEffectSpec(preset.spec),
      isPremium: Boolean(preset.isPremium),
      sortOrder: index,
    };

    await prisma.textEffect.upsert({
      where: { slug: preset.slug },
      create: { slug: preset.slug, ...data },
      update: args["overwrite-content"] ? data : {},
    });
    touched += 1;
  }

  if (!args["keep-extra"]) {
    const removed = await prisma.textEffect.deleteMany({
      where: { slug: { notIn: PRESETS.map((preset) => preset.slug) } },
    });
    if (removed.count) console.log(`Removed ${removed.count} effect(s) not in the library.`);
  }

  console.log(`Seeded ${touched} text effect(s).`);
  if (skipped.length) {
    console.log(
      `Skipped ${skipped.length} preset(s) with no DB row (deleted in the dashboard, or new — pass --create): ${skipped.join(", ")}`
    );
  }
} finally {
  await prisma.$disconnect();
}
