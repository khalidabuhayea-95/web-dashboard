/**
 * Converts the element library's PNG files to lossless WebP (same pixels, same alpha, ~45% fewer
 * bytes). GIFs and every other format are left alone.
 *
 * Canva elements share their R2 file with the template layer they were imported from, so the
 * WebP only saves space once the templates point at it too: every Template and TemplateRevision
 * that mentions an old key is rewritten to the new one (Template.updatedAt is preserved — this is
 * not an edit). The old PNGs are NOT deleted here; run --delete-old later, once you have checked
 * the result. It removes only PNGs nothing references any more.
 *
 *   npm run convert:element-webp                     dry run: what would change
 *   npm run convert:element-webp -- --apply          convert, rewrite references, keep backups
 *   npm run convert:element-webp -- --apply --limit 50 --source freepik
 *   npm run convert:element-webp -- --restore <runDir>      put every row back as it was
 *   npm run convert:element-webp -- --delete-old <runDir>   delete the now-unreferenced PNGs
 *
 * Every run writes to ~/nayroz_db_backups/element-webp-<timestamp>/: mapping.jsonl (old → new
 * key), elements.jsonl, templates.jsonl and revisions.jsonl (each changed row as it was before).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import prisma from "@/lib/prisma";
import { convertPngToLosslessWebp } from "@/lib/media/losslessWebp.server";
import { deleteObjects, getPublicStorageBucketName, parsePublicObjectKey, uploadObject } from "@/lib/storage/objectStorage.server";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

type ElementRow = { id: string; source: string; asset_url: string; thumbnail_url: string };
type Mapping = { id: string; source: string; oldKey: string; newKey: string; oldUrl: string; newUrl: string; oldBytes: number; newBytes: number };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const CONCURRENCY = 6;
const BACKUP_ROOT = path.join(os.homedir(), "nayroz_db_backups");

function appendJsonl(file: string, value: unknown) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function webpKeyFor(key: string) {
  return /\.png$/i.test(key) ? key.replace(/\.png$/i, ".webp") : `${key}.webp`;
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index], index);
      }
    })
  );
}

async function listPngElements(): Promise<ElementRow[]> {
  const source = option("--source");
  const limit = Number(option("--limit")) || 0;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text, source, asset_url, thumbnail_url
       FROM editor_element_assets
      WHERE asset_url ~* '\\.png($|[?#])'
        ${source ? "AND source = $1" : ""}
      ORDER BY created_at
      ${limit > 0 ? `LIMIT ${limit}` : ""}`,
    ...(source ? [source] : [])
  )) as ElementRow[];
  return rows;
}

async function convertElements(rows: ElementRow[], runDir: string) {
  const bucket = getPublicStorageBucketName();
  const stats = { converted: 0, skipped: 0, failed: 0, oldBytes: 0, newBytes: 0, reasons: {} as Record<string, number> };
  const mappings: Mapping[] = [];
  await mapLimit(rows, CONCURRENCY, async (row, index) => {
    const oldKey = parsePublicObjectKey(row.asset_url);
    try {
      if (!oldKey) throw new Error("no storage key in asset_url");
      const response = await fetch(row.asset_url);
      if (!response.ok) throw new Error(`download HTTP ${response.status}`);
      const original = Buffer.from(await response.arrayBuffer());
      const result = await convertPngToLosslessWebp(original);
      if (!result.converted) {
        stats.skipped++;
        stats.reasons[result.reason || "?"] = (stats.reasons[result.reason || "?"] || 0) + 1;
        return;
      }
      const newKey = webpKeyFor(oldKey);
      const newUrl = row.asset_url.split(oldKey).join(newKey);
      await uploadObject({
        bucket,
        key: newKey,
        body: result.bytes,
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
        upsert: true,
        skipExistenceCheck: true,
      });
      appendJsonl(path.join(runDir, "elements.jsonl"), row);
      await prisma.$executeRawUnsafe(
        `UPDATE editor_element_assets
            SET asset_url = replace(asset_url, $1, $2),
                thumbnail_url = replace(thumbnail_url, $1, $2),
                source_payload = replace(source_payload::text, $1, $2)::jsonb
          WHERE id = $3::uuid`,
        oldKey,
        newKey,
        row.id
      );
      const mapping: Mapping = {
        id: row.id,
        source: row.source,
        oldKey,
        newKey,
        oldUrl: row.asset_url,
        newUrl,
        oldBytes: original.length,
        newBytes: result.bytes.length,
      };
      appendJsonl(path.join(runDir, "mapping.jsonl"), mapping);
      mappings.push(mapping);
      stats.converted++;
      stats.oldBytes += original.length;
      stats.newBytes += result.bytes.length;
    } catch (error) {
      stats.failed++;
      console.warn(`  ✗ ${row.id} ${error instanceof Error ? error.message : String(error)}`);
    }
    if ((index + 1) % 250 === 0) {
      console.log(`  ${index + 1}/${rows.length} — ${stats.converted} converted, ${stats.skipped} kept as PNG, ${stats.failed} failed`);
    }
  });
  return { stats, mappings };
}

/** Points every Template / TemplateRevision at the WebP keys. Old PNG keys are matched exactly. */
async function rewriteTemplateReferences(mappings: Mapping[], runDir: string) {
  const byOld = new Map(mappings.map((m) => [m.oldKey, m.newKey]));
  if (byOld.size === 0) return { templates: 0, revisions: 0 };
  const pattern = /users\/[A-Za-z0-9._~%\/-]+?\.png/g;
  const rewrite = (text: string) => {
    let changed = false;
    const next = text.replace(pattern, (match) => {
      const replacement = byOld.get(match);
      if (!replacement) return match;
      changed = true;
      return replacement;
    });
    return changed ? next : null;
  };

  let templates = 0;
  const templateRows = (await prisma.$queryRawUnsafe(
    `SELECT id::text, data::text AS data FROM "Template" WHERE data::text LIKE '%.png%'`
  )) as Array<{ id: string; data: string }>;
  for (const row of templateRows) {
    const next = rewrite(row.data);
    if (!next) continue;
    appendJsonl(path.join(runDir, "templates.jsonl"), row);
    await prisma.$transaction([
      preserveTemplateUpdatedAt(),
      prisma.$executeRawUnsafe(`UPDATE "Template" SET data = $1::jsonb WHERE id = $2::uuid`, next, row.id),
    ]);
    templates++;
  }

  let revisions = 0;
  const batch = 200;
  for (let offset = 0; ; offset += batch) {
    const revisionRows = (await prisma.$queryRawUnsafe(
      `SELECT id::text, snapshot::text AS snapshot FROM "TemplateRevision" ORDER BY id LIMIT ${batch} OFFSET ${offset}`
    )) as Array<{ id: string; snapshot: string }>;
    if (revisionRows.length === 0) break;
    for (const row of revisionRows) {
      const next = rewrite(row.snapshot);
      if (!next) continue;
      appendJsonl(path.join(runDir, "revisions.jsonl"), row);
      await prisma.$executeRawUnsafe(`UPDATE "TemplateRevision" SET snapshot = $1::jsonb WHERE id = $2::uuid`, next, row.id);
      revisions++;
    }
  }
  return { templates, revisions };
}

async function restore(runDir: string) {
  const elements = readJsonl<ElementRow & { source_payload?: unknown }>(path.join(runDir, "elements.jsonl"));
  const mappings = readJsonl<Mapping>(path.join(runDir, "mapping.jsonl"));
  for (const m of mappings) {
    await prisma.$executeRawUnsafe(
      `UPDATE editor_element_assets
          SET asset_url = replace(asset_url, $2, $1),
              thumbnail_url = replace(thumbnail_url, $2, $1),
              source_payload = replace(source_payload::text, $2, $1)::jsonb
        WHERE id = $3::uuid`,
      m.oldKey,
      m.newKey,
      m.id
    );
  }
  for (const row of readJsonl<{ id: string; data: string }>(path.join(runDir, "templates.jsonl"))) {
    await prisma.$transaction([
      preserveTemplateUpdatedAt(),
      prisma.$executeRawUnsafe(`UPDATE "Template" SET data = $1::jsonb WHERE id = $2::uuid`, row.data, row.id),
    ]);
  }
  for (const row of readJsonl<{ id: string; snapshot: string }>(path.join(runDir, "revisions.jsonl"))) {
    await prisma.$executeRawUnsafe(`UPDATE "TemplateRevision" SET snapshot = $1::jsonb WHERE id = $2::uuid`, row.snapshot, row.id);
  }
  console.log(`Restored ${mappings.length} elements (${elements.length} backed up), templates and revisions from ${runDir}.`);
}

// Everything that can hold a storage key — the same tables and columns as REFERENCE_SOURCES in
// src/lib/storage/assetReferences.server.js (and scripts/cleanup-orphan-media.ts). Read ONCE: the
// per-key check scans every table for every key (~0.7 s each), which made 8,000 keys take hours.
const REFERENCE_TEXT_SOURCES: Array<[string, string]> = [
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
  ["PushCampaign", `SELECT payload::text AS t FROM "PushCampaign"`],
  ["StoreNotification", `SELECT payload::text AS t FROM "StoreNotification"`],
];

/** Every "users/….png" string anywhere in those tables — absolute URL, proxy path or bare key. */
async function collectReferencedPngKeys() {
  const referenced = new Set<string>();
  const pattern = /users\/[A-Za-z0-9._~%\/-]+?\.png/g;
  for (const [label, sql] of REFERENCE_TEXT_SOURCES) {
    let rows: Array<{ t: string }>;
    try {
      rows = (await prisma.$queryRawUnsafe(sql)) as Array<{ t: string }>;
    } catch (error) {
      // Never treat an unreadable table as "no references" — that would delete live files.
      throw new Error(`Reference scan failed for ${label}: ${error instanceof Error ? error.message : String(error)}. Nothing deleted.`);
    }
    for (const row of rows) {
      for (const match of String(row?.t || "").matchAll(pattern)) referenced.add(match[0]);
    }
  }
  return referenced;
}

async function deleteOld(runDir: string) {
  const mappings = readJsonl<Mapping>(path.join(runDir, "mapping.jsonl"));
  const referenced = await collectReferencedPngKeys();
  const deletable = mappings.map((m) => m.oldKey).filter((key) => !referenced.has(key));
  console.log(`${deletable.length} old PNGs are no longer referenced; ${mappings.length - deletable.length} are still used and stay.`);
  const bucket = getPublicStorageBucketName();
  let deleted = 0;
  for (let index = 0; index < deletable.length; index += 1000) {
    const chunk = deletable.slice(index, index + 1000);
    await deleteObjects(bucket, chunk);
    deleted += chunk.length;
    console.log(`  deleted ${deleted}/${deletable.length}`);
  }
  console.log(`Deleted ${deleted} old PNG objects.`);
}

async function main() {
  const restoreDir = option("--restore");
  if (restoreDir) return restore(restoreDir);
  const deleteDir = option("--delete-old");
  if (deleteDir) return deleteOld(deleteDir);

  const rows = await listPngElements();
  const bySource = rows.reduce<Record<string, number>>((acc, row) => ((acc[row.source] = (acc[row.source] || 0) + 1), acc), {});
  console.log(`PNG elements to convert: ${rows.length}`, bySource);
  if (!flag("--apply")) {
    console.log("Dry run. Re-run with --apply to convert.");
    return;
  }

  const runDir = path.join(BACKUP_ROOT, `element-webp-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(runDir, { recursive: true });
  console.log(`Backups and mapping: ${runDir}`);

  const started = Date.now();
  const { stats, mappings } = await convertElements(rows, runDir);
  const mb = (bytes: number) => Math.round(bytes / 1048576);
  console.log(
    `Converted ${stats.converted}, kept as PNG ${stats.skipped}`,
    stats.reasons,
    `failed ${stats.failed}. ${mb(stats.oldBytes)} MB → ${mb(stats.newBytes)} MB` +
      (stats.oldBytes ? ` (${Math.round((1 - stats.newBytes / stats.oldBytes) * 100)}% smaller)` : "")
  );
  const refs = await rewriteTemplateReferences(mappings, runDir);
  console.log(`Templates rewritten: ${refs.templates}, revisions rewritten: ${refs.revisions}.`);
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s. Old PNGs are still in R2; delete them later with:`);
  console.log(`  npm run convert:element-webp -- --delete-old ${runDir}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
