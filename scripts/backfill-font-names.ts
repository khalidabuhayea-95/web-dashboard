// One-off backfill: give Canva-imported fonts a readable displayName.
// Fonts imported from Canva are stored with an opaque id (e.g. "YADkLzugzJU_0")
// as family AND displayName, so the editor shows "font". This reads the real
// family name from each font's stored file and updates displayName (family is
// left untouched — text layers + @font-face reference the id).
//
//   node --env-file=.env --import tsx scripts/backfill-font-names.ts

import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";
import { getObject } from "@/lib/storage/objectStorage.server";
import { extractFontFamilyName } from "@/lib/editor/fontName.server";
import { isSyntheticFontFamily } from "@/lib/editor/customFontLabel";

async function main() {
  const families = await prisma.fontFamily.findMany({
    select: { id: true, family: true, displayName: true },
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const fam of families) {
    if (!isSyntheticFontFamily(fam.displayName)) {
      skipped += 1;
      continue;
    }

    const file =
      (await prisma.fontFile.findFirst({
        where: { fontId: fam.id, kind: "mobile" },
        select: { storageBucket: true, storagePath: true },
      })) ||
      (await prisma.fontFile.findFirst({
        where: { fontId: fam.id },
        select: { storageBucket: true, storagePath: true },
      }));

    if (!file?.storageBucket || !file?.storagePath) {
      console.log(`skip (no file): ${fam.family}`);
      failed += 1;
      continue;
    }

    try {
      const obj = await getObject(file.storageBucket, file.storagePath);
      const bytes = Buffer.from(await obj.Body.transformToByteArray());
      const realName = extractFontFamilyName(bytes);

      if (!realName || isSyntheticFontFamily(realName)) {
        console.log(`skip (no real name): ${fam.family} -> ${JSON.stringify(realName)}`);
        skipped += 1;
        continue;
      }

      await prisma.fontFamily.update({
        where: { id: fam.id },
        data: { displayName: realName },
      });

      // Best-effort: add a searchable alias under the real name.
      try {
        const normalizedAlias = realName.trim().toLowerCase();
        const exists = await prisma.fontAlias.findFirst({
          where: { fontId: fam.id, normalizedAlias },
          select: { id: true },
        });
        if (!exists) {
          await prisma.fontAlias.create({
            data: { id: randomUUID(), fontId: fam.id, alias: realName, normalizedAlias },
          });
        }
      } catch (aliasError: any) {
        console.log(`  (alias skipped: ${aliasError?.message || aliasError})`);
      }

      console.log(`updated: ${fam.family} -> "${realName}"`);
      updated += 1;
    } catch (error: any) {
      console.log(`ERROR ${fam.family}: ${error?.message || error}`);
      failed += 1;
    }
  }

  console.log(JSON.stringify({ total: families.length, updated, skipped, failed }));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await prisma.$disconnect();
  } catch (_e) {
    /* noop */
  }
  process.exit(1);
});
