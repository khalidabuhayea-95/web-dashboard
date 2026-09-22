#!/usr/bin/env node
/**
 * Moves every stored animation onto an effect its own tab offers.
 *
 * Imported templates carry whatever the Canva mapping picked, and that mapping said nothing about
 * WHICH tab the result belongs to. Rise, Pan, Drift, Tectonic, Stomp and Tumble are Loop and Exit
 * effects here, never entrances, so a Canva entrance mapped onto Rise sat in the Entrance slot
 * holding something the tab does not offer: unselectable in the editor, and an entrance the app
 * does not list either. The importer does this at import time now (see animationSlotFit.ts); this
 * backfills everything imported before that.
 *
 * Only the EFFECT changes. Durations, delays, easing, direction and the slot itself are untouched.
 *
 *   npx tsx scripts/fit-animation-slots.mjs            # dry run, prints what it would change
 *   npx tsx scripts/fit-animation-slots.mjs --apply    # writes
 */
import { PrismaClient } from "@prisma/client";

import { fitImportedAnimationsToCategories } from "../src/lib/editor/animationSlotFit.ts";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

/** Every animation in a design, as "slot: TYPE" strings, for the before/after report. */
function describeAnimations(data) {
  const found = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const slots = node.animations;
    if (slots && typeof slots === "object" && !Array.isArray(slots)) {
      for (const slot of ["entrance", "exit", "loop"]) {
        const type = slots[slot]?.type;
        if (type) found.push(`${slot}:${type}`);
      }
    }
    if (node.mediaAnimationType && node.mediaAnimationType !== "NONE") {
      const mode = String(node.mediaAnimationMode || "IN").toUpperCase();
      const slot = node.mediaAnimationInfinite === true || mode === "LOOP"
        ? "loop"
        : mode === "OUT"
          ? "exit"
          : "entrance";
      found.push(`${slot}:${node.mediaAnimationType}`);
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(data, 0);
  return found;
}

async function main() {
  const templates = await prisma.template.findMany({ select: { id: true, name: true, data: true } });
  let touched = 0;
  let layers = 0;

  for (const template of templates) {
    if (!template.data || typeof template.data !== "object") continue;
    const before = describeAnimations(template.data);
    const data = structuredClone(template.data);
    const changed = fitImportedAnimationsToCategories(data);
    if (changed === 0) continue;

    const after = describeAnimations(data);
    const moves = before
      .map((entry, index) => (entry === after[index] ? null : `${entry} -> ${after[index]}`))
      .filter(Boolean);

    touched += 1;
    layers += changed;
    console.log(`${APPLY ? "updating" : "would update"} "${template.name.slice(0, 44)}"`);
    for (const move of [...new Set(moves)]) console.log(`    ${move}`);
    if (APPLY) {
      await prisma.template.update({ where: { id: template.id }, data: { data } });
    }
  }

  console.log(
    `\n${APPLY ? "updated" : "would update"} ${touched} template(s), ${layers} animation(s) of ${templates.length} scanned`
  );
  if (!APPLY && touched > 0) console.log("re-run with --apply to write these changes");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
