// Deletes storage objects that nothing in the database references any more.
//
// Templates clean up after themselves on delete (see DELETE /api/templates/[id]), so this is
// for objects stranded before that worked, or by a direct DB delete that bypassed the route.
//
//   npm run cleanup:orphan-media                 # dry run, template-owned areas
//   npm run cleanup:orphan-media -- --apply      # actually delete them
//   npm run cleanup:orphan-media -- --areas=all  # include every other area too
//   npm run cleanup:orphan-media -- --areas=all --keep=ai-templates,magic-tools
//                                                # ...but never touch those prefixes
//
// SAFETY: the sweep is "delete what is referenced by nothing", so SOURCES below is the safety
// boundary — every column anywhere that can hold a storage key must be listed. A query that
// fails aborts the run rather than treating that table's objects as unreferenced.
import prisma from "@/lib/prisma";
import {
  deleteObjects,
  getPublicStorageBucketName,
  getTemplateThumbnailBucketName,
  listObjectKeys,
  parsePublicObjectKey,
} from "@/lib/storage/objectStorage.server";

// Two ways a column can point at an object, and both must be recognised or the sweep deletes
// live files (a hard-coded prefix allowlist missed background-categories/ once already):
//   1. a public URL — parsed with the same helper the app uses, so the host, the proxy form and
//      the ?v= cache-buster are all handled;
//   2. a bare key (FontFile.storagePath) — a slash-joined path that does NOT sit inside a URL.
// Over-matching junk like "image/png" is harmless: a token only matters if it equals a real
// bucket key, so extra tokens can only make the sweep more conservative.
const URL_SHAPE = /https?:\/\/[^\s"'\\<>)]+/g;
const BARE_KEY_SHAPE = /(?<![A-Za-z0-9._:/-])[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+/g;

function extractKeys(text: string, into: Set<string>): number {
  let found = 0;
  for (const match of text.matchAll(URL_SHAPE)) {
    const key = parsePublicObjectKey(match[0]);
    if (key) { into.add(key); found += 1; }
  }
  for (const match of text.matchAll(BARE_KEY_SHAPE)) {
    into.add(match[0]); found += 1;
  }
  return found;
}

const SOURCES: Array<[string, string]> = [
  ["Template", `SELECT COALESCE("thumbnailDataUrl",'') || ' ' || COALESCE("previewVideoUrl",'') || ' ' || COALESCE("previewPosterUrl",'') || ' ' || COALESCE("pageThumbnails"::text,'') || ' ' || data::text AS t FROM "Template"`],
  ["TemplateRevision", `SELECT snapshot::text AS t FROM "TemplateRevision"`],
  ["editor_element_assets", `SELECT COALESCE(asset_url,'') || ' ' || COALESCE(thumbnail_url,'') || ' ' || COALESCE(source_payload::text,'') AS t FROM editor_element_assets`],
  ["editor_background_assets", `SELECT COALESCE(asset_url,'') || ' ' || COALESCE(thumbnail_url,'') || ' ' || COALESCE(source_payload::text,'') AS t FROM editor_background_assets`],
  ["FontFile", `SELECT COALESCE("publicUrl",'') || ' ' || COALESCE("storagePath",'') AS t FROM "FontFile"`],
  ["FontFamily", `SELECT COALESCE("previewImageUrl",'') || ' ' || COALESCE("previewImageDarkUrl",'') AS t FROM "FontFamily"`],
  ["AiTemplate", `SELECT COALESCE("beforeUrl",'') || ' ' || COALESCE("afterUrl",'') || ' ' || COALESCE("thumbUrl",'') AS t FROM "AiTemplate"`],
  ["MagicTool", `SELECT COALESCE("beforeUrl",'') || ' ' || COALESCE("afterUrl",'') || ' ' || COALESCE("thumbUrl",'') AS t FROM "MagicTool"`],
  ["GalleryImage", `SELECT COALESCE(url,'') AS t FROM "GalleryImage"`],
  ["TextEffect", `SELECT COALESCE("previewUrl",'') AS t FROM "TextEffect"`],
  ["AppSetting", `SELECT value::text AS t FROM "AppSetting"`],
  // Notification payloads embed image URLs — easy to overlook because neither table looks
  // media-related from its name.
  ["PushCampaign", `SELECT payload::text AS t FROM "PushCampaign"`],
  ["StoreNotification", `SELECT payload::text AS t FROM "StoreNotification"`],
];

/**
 * Top-level prefixes to spare regardless of whether anything references them. Catalog art for
 * the AI features belongs here: it was generated through paid Replicate runs, so an unreferenced
 * copy is worth keeping rather than paying to recreate.
 */
function parseKeepPrefixes(args: string[]): string[] {
  const raw = args.find((arg) => arg.startsWith("--keep="));
  if (!raw) return [];
  return raw
    .slice("--keep=".length)
    .split(",")
    .map((value) => value.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

function isKeptKey(key: string, keepPrefixes: string[]): boolean {
  return keepPrefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
}

/** Objects a template owns: its thumbnails/previews/psd, and the images its import staged. */
function isTemplateOwnedKey(key: string): boolean {
  return /^users\/[^/]+\/(templates|imports)\//.test(key);
}

function areaOf(key: string): string {
  const parts = key.split("/");
  return parts[0] === "users" ? `users/<owner>/${parts[2] || ""}` : parts[0];
}

async function collectReferencedKeys(): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const [label, sql] of SOURCES) {
    let rows: any[];
    try {
      rows = await prisma.$queryRawUnsafe(sql);
    } catch (error: any) {
      throw new Error(
        `Reference scan failed for ${label} (${error?.message}). Aborting — treating its rows ` +
          `as unreferenced would delete live objects.`
      );
    }
    let found = 0;
    rows.forEach((row: any) => {
      found += extractKeys(String(row?.t || ""), referenced);
    });
    console.log(`  ${label.padEnd(26)} ${String(rows.length).padStart(5)} rows -> ${found} refs`);
  }
  return referenced;
}

function summarize(keys: string[]): string {
  const groups = new Map<string, number>();
  keys.forEach((key) => groups.set(areaOf(key), (groups.get(areaOf(key)) || 0) + 1));
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `    ${String(count).padStart(5)}  ${label}`)
    .join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const allAreas = args.includes("--areas=all");
  const keepPrefixes = parseKeepPrefixes(args);

  const buckets = Array.from(
    new Set([getPublicStorageBucketName(), getTemplateThumbnailBucketName()].filter(Boolean))
  );
  console.log(`Buckets: ${buckets.join(", ")}`);
  console.log(`Mode:    ${apply ? "APPLY (objects will be deleted)" : "dry run"}`);
  console.log(`Areas:   ${allAreas ? "all unreferenced objects" : "template-owned only"}`);
  console.log(`Keep:    ${keepPrefixes.length > 0 ? keepPrefixes.join(", ") : "(nothing pinned)"}\n`);

  console.log("Reference scan:");
  const referenced = await collectReferencedKeys();
  console.log(`\ndistinct referenced keys: ${referenced.size}`);

  for (const bucket of buckets) {
    const all = await listObjectKeys(bucket, { prefix: "" });
    const unreferenced = all.filter((key) => !referenced.has(key));

    if (referenced.size === 0 && all.length > 0) {
      throw new Error(
        `Nothing in the database references any object, but ${bucket} holds ${all.length}. ` +
          `That looks like the wrong database, not an empty one — aborting.`
      );
    }

    const inSelectedAreas = allAreas ? unreferenced : unreferenced.filter(isTemplateOwnedKey);
    const targets = inSelectedAreas.filter((key) => !isKeptKey(key, keepPrefixes));
    const targetSet = new Set(targets);
    const skipped = unreferenced.filter((key) => !targetSet.has(key));

    console.log(`\n[${bucket}] ${all.length} objects, ${unreferenced.length} unreferenced`);
    console.log(`  to delete (${targets.length}):`);
    console.log(targets.length > 0 ? summarize(targets) : "    (none)");
    if (skipped.length > 0) {
      console.log(`  left alone (${skipped.length}, pinned by --keep or outside the areas):`);
      console.log(summarize(skipped));
    }

    if (!apply || targets.length === 0) continue;

    // R2 caps DeleteObjects at 1000 keys per call.
    let deleted = 0;
    for (let index = 0; index < targets.length; index += 1000) {
      const batch = targets.slice(index, index + 1000);
      await deleteObjects(bucket, batch);
      deleted += batch.length;
      console.log(`  deleted ${deleted}/${targets.length}`);
    }
  }

  if (!apply) console.log("\nDry run — nothing deleted. Re-run with --apply to delete.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  await prisma.$disconnect();
});
