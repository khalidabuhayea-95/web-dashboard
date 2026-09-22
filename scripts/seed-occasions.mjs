#!/usr/bin/env node
// Seeds the Occasion table from scripts/occasions/presets.mjs.
//
//   npm run seed:occasions -- --create             # first run / add new presets
//   npm run seed:occasions -- --overwrite-content  # reset seeded rows to the library
//   npm run seed:occasions -- --dry-run            # print what would change
//
// Same non-destructive contract as the other catalogues: the library decides what MAY
// exist, the dashboard decides what an occasion looks like. A preset with no row is only
// inserted with --create (so an occasion the admin deleted stays deleted) and existing rows
// keep their edits unless --overwrite-content. Unlike text effects, rows the admin added
// are NEVER pruned — occasions are admin-authored, the library is only a starting point.

import { PrismaClient } from "@prisma/client";
import { PRESETS } from "./occasions/presets.mjs";
import { normalizeOccasionInput } from "../src/lib/occasions/validate.ts";

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
  const created = [];
  let updated = 0;

  for (const [index, preset] of PRESETS.entries()) {
    // Validated the same way the API validates a dashboard edit, so the seed cannot slip an
    // impossible date rule past the checks.
    const data = { ...normalizeOccasionInput(preset), sortOrder: index };

    const existing = await prisma.occasion.findUnique({
      where: { slug: preset.slug },
      select: { id: true },
    });

    if (!existing) {
      if (!args.create) {
        skipped.push(preset.slug);
        continue;
      }
      created.push(preset.slug);
      if (args["dry-run"]) continue;
      await prisma.occasion.create({ data: { slug: preset.slug, ...data } });
      continue;
    }

    if (args["overwrite-content"]) {
      updated += 1;
      if (args["dry-run"]) continue;
      // `dateOverrides` are moon-sighting corrections the admin entered — never reset them.
      const { dateOverrides: _ignored, ...content } = data;
      await prisma.occasion.update({ where: { id: existing.id }, data: content });
    }
  }

  const prefix = args["dry-run"] ? "[dry-run] " : "";
  console.log(`${prefix}Created ${created.length} occasion(s)${created.length ? `: ${created.join(", ")}` : "."}`);
  if (args["overwrite-content"]) console.log(`${prefix}Updated ${updated} existing occasion(s) from the library.`);
  if (skipped.length) {
    console.log(
      `Skipped ${skipped.length} preset(s) with no DB row (deleted in the dashboard, or new — pass --create): ${skipped.join(", ")}`
    );
  }
} finally {
  await prisma.$disconnect();
}
