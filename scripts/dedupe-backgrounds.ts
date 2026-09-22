// Finds and removes visually duplicate backgrounds.
//
// Unlike elements, backgrounds were imported with no perceptual-fingerprint check, so the same
// artwork sits in the catalogue several times under different Magnific ids. There is no stored
// hash to group by, so this fingerprints the stored images once (dHash over the thumbnail —
// see lib/tools/imageFingerprint.server.js for why a byte hash cannot work here) and writes the
// result to editor_background_assets.content_hash so later runs are instant.
//
//   npm run dedupe:backgrounds                 # fingerprint + report, deletes nothing
//   npm run dedupe:backgrounds -- --apply      # delete the redundant rows and their R2 objects
//   npm run dedupe:backgrounds -- --rehash     # recompute every fingerprint, not just missing ones
//
// Within a duplicate group the OLDEST row survives: it is the one the catalogue has been
// serving, so anything already referencing it keeps working.
import prisma from "@/lib/prisma";
import { deleteStorageForUrls } from "@/lib/storage/assetReferences.server";
import { fingerprintImageUrl } from "@/lib/tools/imageFingerprint.server";

const CONCURRENCY = 8;

async function ensureHashColumn(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE editor_background_assets ADD COLUMN IF NOT EXISTS content_hash TEXT`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS editor_background_assets_content_hash_idx
       ON editor_background_assets(content_hash) WHERE content_hash IS NOT NULL`
  );
}

interface Row {
  id: string;
  asset_url: string;
  thumbnail_url: string;
  title_en: string;
  category_value: string | null;
  created_at: Date;
}

async function fingerprintMissing(rehash: boolean): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, asset_url, thumbnail_url FROM editor_background_assets
     ${rehash ? "" : "WHERE content_hash IS NULL"}`
  )) as Row[];
  if (rows.length === 0) return 0;

  console.log(`fingerprinting ${rows.length} background(s)...`);
  let done = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      // The thumbnail is smaller and hashes to the same dHash as the full asset; fall back to
      // the original when a row has no preview.
      const hash =
        (await fingerprintImageUrl(row.thumbnail_url)) || (await fingerprintImageUrl(row.asset_url));
      if (hash) {
        await prisma.$executeRawUnsafe(
          `UPDATE editor_background_assets SET content_hash = $1 WHERE id = $2::uuid`,
          hash,
          row.id
        );
      } else {
        failed += 1;
      }
      done += 1;
      if (done % 100 === 0) console.log(`  ${done}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // An un-hashable row is kept, never deleted: a 404 thumbnail must not cost the catalogue an asset.
  if (failed > 0) console.log(`  ${failed} could not be fingerprinted (left untouched)`);
  return rows.length - failed;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const rehash = process.argv.includes("--rehash");
  console.log(`Mode: ${apply ? "APPLY (rows and objects will be deleted)" : "dry run"}\n`);

  await ensureHashColumn();
  await fingerprintMissing(rehash);

  const groups = (await prisma.$queryRawUnsafe(
    `SELECT content_hash, COUNT(*)::int AS n FROM editor_background_assets
     WHERE content_hash IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC`
  )) as Array<{ content_hash: string; n: number }>;

  const total = Number(
    ((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM editor_background_assets`)) as any[])[0].c
  );
  const redundant = groups.reduce((sum, g) => sum + (g.n - 1), 0);
  console.log(`\n${total} backgrounds · ${groups.length} duplicate group(s) · ${redundant} redundant row(s)`);
  if (groups.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const doomed: Row[] = [];
  let crossCategory = 0;
  for (const group of groups) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, asset_url, thumbnail_url, title_en, category_value, created_at
       FROM editor_background_assets WHERE content_hash = $1 ORDER BY created_at ASC, id ASC`,
      group.content_hash
    )) as Row[];
    const categories = new Set(rows.map((r) => r.category_value || ""));
    if (categories.size > 1) crossCategory += 1;
    doomed.push(...rows.slice(1));
  }

  console.log(`groups whose copies sit in DIFFERENT categories: ${crossCategory}`);
  console.log("\nsample (keeping the oldest of each):");
  groups.slice(0, 5).forEach((g, i) => {
    const victims = doomed.filter((_, j) => j < 3 && i === 0);
    if (i === 0 && victims.length) {
      victims.forEach((v) => console.log(`  drop  ${String(v.title_en).slice(0, 52).padEnd(54)} [${v.category_value}]`));
    }
  });

  if (!apply) {
    console.log(`\nDry run — nothing deleted. ${redundant} row(s) would go. Re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }

  const ids = doomed.map((r) => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const removed = (await prisma.$queryRawUnsafe(
      `DELETE FROM editor_background_assets WHERE id = ANY($1::uuid[])
       RETURNING asset_url, thumbnail_url`,
      batch
    )) as Array<{ asset_url: string; thumbnail_url: string }>;
    deleted += removed.length;
    // Rows first, then storage — the objects are only unreferenced once the rows are gone.
    await deleteStorageForUrls(
      removed.flatMap((r) => [r.asset_url, r.thumbnail_url]),
      { reason: "background dedupe" }
    );
    console.log(`  deleted ${deleted}/${ids.length}`);
  }

  const after = Number(
    ((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM editor_background_assets`)) as any[])[0].c
  );
  const left = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM (SELECT content_hash FROM editor_background_assets
       WHERE content_hash IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1) g`
  )) as any[];
  console.log(`\nbackgrounds: ${total} -> ${after}`);
  console.log(`duplicate groups remaining: ${left[0].c}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
  await prisma.$disconnect();
});
