#!/usr/bin/env node
/**
 * Moves ambient Canva page animations out of the entrance slot and into the loop slot.
 *
 * The Canva importer used to write every page animation as an ENTRANCE. Four of the effects it
 * maps onto — Breathe, Neon, Baseline and Scrapbook — ping-pong or ride a wave, so they end
 * exactly where they started: as an entrance they reveal nothing, and no entrance tab offers them,
 * so the editor showed an empty selection on a layer that plainly had an animation. The importer
 * now routes them to the loop slot (background.js, CANVA_PAGE_AMBIENT_TYPES); this backfills the
 * templates imported before that.
 *
 * Effects that SETTLE into place (Rise, Pan, Drift, Tectonic, Stomp, Tumble) are left alone. They
 * are genuine entrances and they already render correctly; the picker now shows them even though
 * the entrance tab does not list them.
 *
 *   node scripts/fix-page-animation-slots.mjs            # dry run, prints what it would change
 *   node scripts/fix-page-animation-slots.mjs --apply    # writes
 */
import { PrismaClient } from "@prisma/client";

const AMBIENT = new Set(["BREATHE", "NEON", "BASELINE", "SCRAPBOOK"]);
const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

/** The slot an element's legacy fields resolve to, mirroring resolveElementAnimations(). */
function legacySlot(element) {
  const mode = String(element.mediaAnimationMode || "IN").toUpperCase();
  if (mode === "LOOP" || element.mediaAnimationInfinite === true) return "loop";
  if (mode === "OUT") return "exit";
  return "entrance";
}

/** Returns a description of what changed, or null when the element needs nothing. */
function migrateElement(element) {
  const slots = element.animations;
  if (slots && typeof slots === "object") {
    for (const from of ["entrance", "exit"]) {
      const spec = slots[from];
      if (!spec || !AMBIENT.has(String(spec.type))) continue;
      // The loop slot already holding something else is left untouched: that is an author's
      // choice, and silently overwriting it would lose an effect.
      if (slots.loop && slots.loop.type && slots.loop.type !== "NONE") {
        return { skipped: `${spec.type} in ${from}, but the loop slot is taken by ${slots.loop.type}` };
      }
      slots.loop = { ...spec, infinite: true };
      slots[from] = null;
      return { moved: `${spec.type}: ${from} -> loop` };
    }
    return null;
  }

  const type = String(element.mediaAnimationType || "");
  if (!AMBIENT.has(type)) return null;
  const slot = legacySlot(element);
  if (slot === "loop") return null;
  element.mediaAnimationMode = "LOOP";
  element.mediaAnimationInfinite = true;
  // The exit leg has no meaning on a loop.
  delete element.mediaAnimationOutDurationMs;
  return { moved: `${type}: ${slot} -> loop (legacy fields)` };
}

function migrateTemplateData(data) {
  const changes = [];
  const containers = [];
  if (Array.isArray(data?.pages)) containers.push(...data.pages);
  // The flat fields mirror the cover page for older app builds, so they are migrated too.
  if (Array.isArray(data?.elements)) containers.push(data);
  for (const container of containers) {
    for (const element of container.elements || []) {
      const result = migrateElement(element);
      if (result) changes.push(result);
    }
  }
  return changes;
}

async function main() {
  const templates = await prisma.template.findMany({ select: { id: true, name: true, data: true } });
  let touched = 0;
  let moved = 0;
  const skipped = [];

  for (const template of templates) {
    if (!template.data || typeof template.data !== "object") continue;
    const data = structuredClone(template.data);
    const changes = migrateTemplateData(data);
    const realChanges = changes.filter((c) => c.moved);
    for (const c of changes) if (c.skipped) skipped.push(`${template.name}: ${c.skipped}`);
    if (realChanges.length === 0) continue;

    touched += 1;
    moved += realChanges.length;
    console.log(`${APPLY ? "updating" : "would update"} "${template.name}" (${template.id})`);
    for (const c of realChanges) console.log(`    ${c.moved}`);
    if (APPLY) {
      await prisma.template.update({ where: { id: template.id }, data: { data } });
    }
  }

  console.log(
    `\n${APPLY ? "updated" : "would update"} ${touched} template(s), ${moved} layer(s) of ${templates.length} scanned`
  );
  for (const note of skipped) console.log(`  left alone — ${note}`);
  if (!APPLY && touched > 0) console.log("\nre-run with --apply to write these changes");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
