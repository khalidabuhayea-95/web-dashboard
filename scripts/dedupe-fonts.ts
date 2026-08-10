// One-off dedupe: the Google import and the appchief import both brought in the
// same typefaces, so the picker lists e.g. "Cairo" (google) and "Cairo Regular"
// (appchief) as two families. They are never byte-identical — the gwfh files are
// single-subset — so nothing catches them automatically.
//
// For each google/appchief pair this keeps the family with the wider glyph
// coverage, folds the loser's names in as aliases (findFontFamiliesByNames
// resolves aliases before canonical names, so existing templates keep resolving),
// unions the language categories, and deletes the loser.
//
// Dry run by default; pass --apply to commit.
//
//   node --env-file=.env --env-file=.env.local --import tsx scripts/dedupe-fonts.ts
//   node --env-file=.env --env-file=.env.local --import tsx scripts/dedupe-fonts.ts --apply

import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";
import { getObject } from "@/lib/storage/objectStorage.server";
import { bumpFontCatalogVersion } from "@/lib/fonts/fontCatalogVersion.server";
import { normalizeFontStorageKey } from "@/lib/editor/fontStorage.server";

const APPLY = process.argv.includes("--apply");
// Pairs where neither side is a superset lose a few codepoints either way; keep
// them out of the run unless explicitly allowed.
const ALLOW_LOSS = process.argv.includes("--allow-loss");

// Weight/style words that turn one typeface into several families.
const WEIGHT_SUFFIX =
  /(thin|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|variablefont|vf|wght)+$/;

function typefaceKey(family: string): string {
  return String(family || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(WEIGHT_SUFFIX, "");
}

/** Codepoints with a real glyph, read straight from the sfnt `cmap` table. */
function readCoverage(buf: Buffer): Set<number> {
  const out = new Set<number>();
  if (buf.length < 12) return out;

  const numTables = buf.readUInt16BE(4);
  let cmapOffset = 0;
  let p = 12;
  for (let i = 0; i < numTables && p + 16 <= buf.length; i += 1) {
    if (buf.toString("latin1", p, p + 4) === "cmap") {
      cmapOffset = buf.readUInt32BE(p + 8);
      break;
    }
    p += 16;
  }
  if (!cmapOffset || cmapOffset + 4 > buf.length) return out;

  const subtableCount = buf.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < subtableCount; i += 1) {
    const rec = cmapOffset + 4 + i * 8;
    if (rec + 8 > buf.length) break;
    const sub = cmapOffset + buf.readUInt32BE(rec + 4);
    if (sub + 4 > buf.length) continue;
    readSubtable(buf, sub, out);
  }
  return out;
}

function readSubtable(buf: Buffer, sub: number, out: Set<number>): void {
  const format = buf.readUInt16BE(sub);

  if (format === 0) {
    for (let c = 0; c < 256 && sub + 6 + c < buf.length; c += 1) {
      if (buf[sub + 6 + c]) out.add(c);
    }
    return;
  }

  if (format === 4) {
    const segCountX2 = buf.readUInt16BE(sub + 6);
    const endBase = sub + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    if (rangeBase + segCountX2 > buf.length) return;

    for (let s = 0; s < segCountX2 / 2; s += 1) {
      const end = buf.readUInt16BE(endBase + s * 2);
      const start = buf.readUInt16BE(startBase + s * 2);
      if (start > end || (start === 0xffff && end === 0xffff)) continue;
      const delta = buf.readInt16BE(deltaBase + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);

      for (let c = start; c <= end; c += 1) {
        let glyph = 0;
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          const addr = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (addr + 2 > buf.length) continue;
          glyph = buf.readUInt16BE(addr);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) out.add(c);
      }
    }
    return;
  }

  if (format === 6) {
    const first = buf.readUInt16BE(sub + 6);
    const count = buf.readUInt16BE(sub + 8);
    for (let i = 0; i < count && sub + 10 + i * 2 + 2 <= buf.length; i += 1) {
      if (buf.readUInt16BE(sub + 10 + i * 2)) out.add(first + i);
    }
    return;
  }

  if (format === 12) {
    const groups = buf.readUInt32BE(sub + 12);
    for (let g = 0; g < groups; g += 1) {
      const rec = sub + 16 + g * 12;
      if (rec + 12 > buf.length) break;
      const start = buf.readUInt32BE(rec);
      const end = buf.readUInt32BE(rec + 4);
      // Guard against a corrupt length blowing up memory.
      for (let c = start; c <= end && c - start < 0x10000; c += 1) out.add(c);
    }
  }
}

async function fontBytes(font: any): Promise<Buffer | null> {
  const file =
    font.files.find((f: any) => f.kind === "mobile" && f.storageBucket && f.storagePath) ||
    font.files.find((f: any) => f.storageBucket && f.storagePath);
  if (!file) return null;
  const obj = await getObject(file.storageBucket, file.storagePath);
  return Buffer.from(await obj.Body.transformToByteArray());
}

function categoriesOf(font: any): string[] {
  return Array.isArray(font.categories) ? font.categories.map((c: any) => String(c)) : [];
}

async function main() {
  const families = await prisma.fontFamily.findMany({
    include: { files: true, aliases: true },
  });

  // Group by typeface, then keep groups that have exactly one google family and
  // an appchief family that is the same weight (its "Regular").
  const groups = new Map<string, any[]>();
  for (const font of families) {
    const key = typefaceKey(font.family);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(font);
  }

  const pairs: Array<{ google: any; appchief: any }> = [];
  for (const members of groups.values()) {
    const google = members.filter((f) => f.source === "google");
    if (google.length !== 1) continue;
    const appchief = members.filter(
      (f) => f.source === "appchief" && /(regular|normal)$/i.test(f.family.trim())
    );
    if (appchief.length !== 1) continue;
    pairs.push({ google: google[0], appchief: appchief[0] });
  }

  console.log(`${families.length} families, ${pairs.length} google/appchief duplicate pairs\n`);

  let merged = 0;
  let skipped = 0;
  let failed = 0;

  for (const { google, appchief } of pairs) {
    try {
      const [gBytes, aBytes] = await Promise.all([fontBytes(google), fontBytes(appchief)]);
      if (!gBytes || !aBytes) {
        console.log(`skip (missing file): ${google.family} / ${appchief.family}`);
        skipped += 1;
        continue;
      }

      const gCov = readCoverage(gBytes);
      const aCov = readCoverage(aBytes);
      const googleLacks = [...aCov].filter((c) => !gCov.has(c)).length;
      const appchiefLacks = [...gCov].filter((c) => !aCov.has(c)).length;

      // Survivor is the superset. When neither covers the other, keep the wider
      // one but only with --allow-loss, since some codepoints go away.
      let keep =
        googleLacks === 0 && appchiefLacks === 0
          ? // Same coverage — the gwfh subset is the smaller download.
            gBytes.length <= aBytes.length
            ? google
            : appchief
          : appchiefLacks === 0
            ? appchief
            : googleLacks === 0
              ? google
              : null;
      let lost = 0;
      if (!keep) {
        if (!ALLOW_LOSS) {
          console.log(
            `skip (neither is a superset): "${google.family}" lacks ${googleLacks}, ` +
              `"${appchief.family}" lacks ${appchiefLacks} — rerun with --allow-loss`
          );
          skipped += 1;
          continue;
        }
        keep = aCov.size >= gCov.size ? appchief : google;
        lost = keep === appchief ? appchiefLacks : googleLacks;
      }
      const drop = keep === appchief ? google : appchief;

      // The google row carries the clean name ("Cairo", not "Cairo Regular") and
      // the language categories from the gwfh catalog — keep both regardless of
      // which row survives.
      const displayName =
        String(google.displayName || "").trim() || String(google.family || "").trim();
      const categories = Array.from(
        new Set([...categoriesOf(google), ...categoriesOf(appchief)])
      );

      const aliasValues = [
        drop.family,
        drop.displayName,
        ...drop.aliases.map((a: any) => a.alias),
        google.family,
        appchief.family,
      ];
      const seen = new Set(keep.aliases.map((a: any) => a.normalizedAlias));
      const newAliases: Array<{ alias: string; normalizedAlias: string }> = [];
      for (const value of aliasValues) {
        const alias = String(value || "").trim();
        const normalizedAlias = normalizeFontStorageKey(alias);
        if (!alias || !normalizedAlias || seen.has(normalizedAlias)) continue;
        seen.add(normalizedAlias);
        newAliases.push({ alias, normalizedAlias });
      }

      const note = lost ? ` (loses ${lost} codepoints)` : "";
      console.log(
        `${APPLY ? "merge" : "would merge"}: keep "${keep.family}" [${keep.source}], ` +
          `drop "${drop.family}" [${drop.source}]${note}` +
          (newAliases.length ? ` +aliases ${newAliases.map((a) => a.alias).join(", ")}` : "")
      );

      if (APPLY) {
        await prisma.$transaction(async (tx: any) => {
          // Delete first: normalizedAlias is globally unique, so the dropped
          // row has to release its names before the survivor can claim them.
          await tx.fontFamily.delete({ where: { id: drop.id } });
          await tx.fontFamily.update({
            where: { id: keep.id },
            data: { displayName, categories },
          });
          if (newAliases.length > 0) {
            await tx.fontAlias.createMany({
              data: newAliases.map((a) => ({ id: randomUUID(), fontId: keep.id, ...a })),
              skipDuplicates: true,
            });
          }
        });
      }
      merged += 1;
    } catch (error: any) {
      console.log(`ERROR ${google.family}: ${error?.message || error}`);
      failed += 1;
    }
  }

  if (APPLY && merged > 0) {
    // Catalog changed — advance the version so mobile clients re-fetch.
    await bumpFontCatalogVersion();
  }

  console.log(
    `\n${JSON.stringify({ apply: APPLY, pairs: pairs.length, merged, skipped, failed })}`
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await prisma.$disconnect();
  } catch (_e) {
    // ignore
  }
  process.exit(1);
});
