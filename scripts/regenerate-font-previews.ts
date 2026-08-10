// One-off migration: font previews used to be stored as PNG. Re-render every
// family as WebP and delete the superseded PNG objects from storage.
//
// Resumable — it selects only families whose stored preview URL isn't already
// WebP, so re-running after a crash picks up where it left off. Previews are
// rendered through a headless browser one family at a time, so a full library
// run takes a while; --limit trims a test run.
//
//   node --env-file=.env --env-file=.env.local --import tsx scripts/regenerate-font-previews.ts
//   node --env-file=.env --env-file=.env.local --import tsx scripts/regenerate-font-previews.ts --limit=20
//   node --env-file=.env --env-file=.env.local --import tsx scripts/regenerate-font-previews.ts --keep-png

import prisma from "@/lib/prisma";
import {
  closeFontPreviewBrowser,
  generateFontFamilyPreviews,
} from "@/lib/fonts/fontPreview.server";
import {
  deleteObjects,
  getPublicStorageBucketName,
  listObjectKeys,
} from "@/lib/storage/objectStorage.server";

const BATCH_SIZE = 20;
const KEEP_PNG = process.argv.includes("--keep-png");
const LIMIT = (() => {
  const raw = process.argv.find((a) => a.startsWith("--limit="));
  const n = raw ? Number(raw.split("=")[1]) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
})();

async function main() {
  const bucket = getPublicStorageBucketName();

  // Anything not already on a .webp preview — including families that never had
  // one, so this doubles as a "generate missing" pass.
  const pending = await prisma.fontFamily.findMany({
    where: {
      OR: [
        { previewImageUrl: null },
        { previewImageDarkUrl: null },
        { NOT: { previewImageUrl: { contains: ".webp" } } },
        { NOT: { previewImageDarkUrl: { contains: ".webp" } } },
      ],
    },
    select: { id: true, previewImageUrl: true },
    orderBy: { family: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`${pending.length} families to re-render as WebP (batch ${BATCH_SIZE})\n`);
  if (pending.length === 0) {
    // Nothing left to render, but stale PNGs may still be sitting in storage.
    await sweepPreviewPngs(bucket);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let failed = 0;
  let pngDeleted = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const results = await generateFontFamilyPreviews(
      batch.map((f: { id: string }) => f.id),
      { force: true }
    );

    const succeeded = results.filter((r) => r.ok).map((r) => r.id);
    ok += succeeded.length;
    for (const r of results.filter((r) => !r.ok)) {
      failed += 1;
      console.log(`  FAILED ${r.id}: ${r.error || "unknown"}`);
    }

    // Only drop the PNGs whose WebP replacement is now live.
    if (!KEEP_PNG && succeeded.length > 0) {
      const keys = succeeded.flatMap((id) => [
        `fonts/${id}/preview-light.png`,
        `fonts/${id}/preview-dark.png`,
      ]);
      try {
        await deleteObjects(bucket, keys);
        pngDeleted += keys.length;
      } catch (error: any) {
        console.log(`  (png cleanup failed: ${error?.message || error})`);
      }
    }

    const done = Math.min(i + BATCH_SIZE, pending.length);
    console.log(
      `${done}/${pending.length}  ok=${ok} failed=${failed} pngDeleted=${pngDeleted}`
    );
  }

  console.log(`\n${JSON.stringify({ total: pending.length, ok, failed, pngDeleted })}`);
  await closeFontPreviewBrowser();
  await sweepPreviewPngs(bucket);
  await prisma.$disconnect();
}

/**
 * Clear every leftover preview PNG in storage, which the per-family loop above
 * can't do on its own: it only iterates families that still exist, so previews
 * belonging to deleted families (e.g. the dedupe removals) are invisible to it.
 *
 * A PNG is safe to drop when its family is gone, or when that family is already
 * serving WebP. Anything else is still the live preview for a font whose render
 * failed — deleting it would leave a broken image, so it's reported instead.
 */
async function sweepPreviewPngs(bucket: string) {
  if (KEEP_PNG) return;

  const keys = await listObjectKeys(bucket, { prefix: "fonts/" });
  const previewPngs = keys.filter((k) => /\/preview-(light|dark)\.png$/.test(k));
  if (previewPngs.length === 0) {
    console.log("sweep: no preview PNGs left in storage");
    return;
  }

  const rows = await prisma.fontFamily.findMany({
    select: { id: true, previewImageUrl: true, previewImageDarkUrl: true },
  });
  const onWebp = new Map<string, boolean>(
    rows.map((r: { id: string; previewImageUrl: string | null; previewImageDarkUrl: string | null }) => [
      r.id,
      Boolean(r.previewImageUrl?.includes(".webp") && r.previewImageDarkUrl?.includes(".webp")),
    ])
  );

  const deletable: string[] = [];
  const stillLive: string[] = [];
  for (const key of previewPngs) {
    const id = key.split("/")[1] || "";
    const state = onWebp.get(id);
    if (state === undefined || state === true) deletable.push(key);
    else stillLive.push(key);
  }

  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < deletable.length; i += 1000) {
    await deleteObjects(bucket, deletable.slice(i, i + 1000));
  }
  console.log(`sweep: deleted ${deletable.length} preview PNGs`);
  if (stillLive.length > 0) {
    console.log(
      `sweep: KEPT ${stillLive.length} PNGs still serving families without a WebP preview — ` +
        `re-run to regenerate them:\n  ${stillLive.slice(0, 10).join("\n  ")}`
    );
  }
}

main().catch(async (error) => {
  console.error(error);
  await closeFontPreviewBrowser().catch(() => {});
  try {
    await prisma.$disconnect();
  } catch (_e) {
    // ignore
  }
  process.exit(1);
});
