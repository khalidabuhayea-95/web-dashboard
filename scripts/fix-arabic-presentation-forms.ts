// One-off data fix for production audit H-04 / D-02: Canva-imported text stored as Arabic
// Presentation Forms in VISUAL order (e.g. template 5376886b's curved title ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ", which
// is «تذكير اليوم:»). The import pipeline normalises new imports now
// (resolveImportedTemplateData → src/lib/text/arabicPresentationForms.js); this repairs the rows
// that were imported before it.
//
// Dry run (default) — reads only, prints every change, writes a backup of the affected rows:
//   node --env-file=.env --import tsx scripts/fix-arabic-presentation-forms.ts
// Apply — same, then updates each affected template in its own transaction:
//   node --env-file=.env --import tsx scripts/fix-arabic-presentation-forms.ts --apply
//
// Applying bumps `version` (and the DB trigger stamps `updatedAt`) so the app refetches, and adds a
// TemplateRevision (action "fix-arabic-presentation-forms") holding the fixed snapshot, like a
// dashboard save. A row whose version moved since the scan is skipped and reported, never
// overwritten. Restore from the backup by writing `data` (and `version`) back for its ids.
//
// Only targets a loopback / private-network database unless --allow-remote is passed (local DB
// first; production is migrated in bulk at go-live).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import prisma from "@/lib/prisma";
import { buildSnapshot } from "@/lib/templates/serverCore";
import { normalizeTemplateArabicTextInPlace } from "@/lib/text/arabicPresentationForms";

const APPLY = process.argv.includes("--apply");
const ALLOW_REMOTE = process.argv.includes("--allow-remote");
const REVISION_ACTION = "fix-arabic-presentation-forms";

function describeTarget() {
  const url = new URL(String(process.env.DATABASE_URL || ""));
  const host = url.hostname;
  const privateHost =
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return { label: `${host}:${url.port || "5432"}${url.pathname}`, privateHost };
}

function codePoints(text: string) {
  return [...text].map((char) => char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
}

async function main() {
  const target = describeTarget();
  console.log(`Database: ${target.label}  mode: ${APPLY ? "APPLY" : "dry run"}`);
  if (!target.privateHost && !ALLOW_REMOTE) {
    throw new Error("Refusing to touch a non-local database without --allow-remote.");
  }

  // Candidates: any template whose JSON contains a presentation-form code point at all. Most are
  // legitimate (the ﷺ honorific, ﴾ ﴿); the normaliser decides what actually changes.
  const candidates: Array<{ id: string }> = await prisma.$queryRaw`
    SELECT "id"::text AS id FROM "Template"
    WHERE "data"::text ~ ${"[ﭐ-﷿ﹰ-ﻼ]"}
    ORDER BY "createdAt" ASC
  `;
  console.log(`Templates containing a presentation-form code point: ${candidates.length}`);

  const affected: Array<{ row: any; fixedData: unknown; changes: ReturnType<typeof normalizeTemplateArabicTextInPlace> }> = [];
  for (const { id } of candidates) {
    const row = await prisma.template.findUnique({ where: { id } });
    if (!row) continue;
    const fixedData = structuredClone(row.data);
    const changes = normalizeTemplateArabicTextInPlace(fixedData);
    if (changes.length > 0) affected.push({ row, fixedData, changes });
  }
  console.log(`Templates the fix changes: ${affected.length} (${candidates.length - affected.length} left as they are)\n`);

  for (const { row, changes } of affected) {
    console.log(`● ${row.id}  v${row.version}  ${row.status}  "${row.name}"`);
    console.log(`  preview: ${row.previewStatus || "none"}${row.previewUpdatedAt ? ` (${row.previewUpdatedAt.toISOString()})` : ""}`);
    for (const change of changes) {
      console.log(`  ${change.path}  ${change.reordered ? "[visual → logical + fold]" : "[fold only]"}`);
      console.log(`    - ${JSON.stringify(change.before)}   ${codePoints(change.before)}`);
      console.log(`    + ${JSON.stringify(change.after)}   ${codePoints(change.after)}`);
      console.log(`    isRtl: ${JSON.stringify(change.isRtlBefore)} → ${JSON.stringify(change.isRtlAfter)}`);
    }
  }
  if (affected.length === 0) return;

  const backupDir = path.join(process.cwd(), "tmp");
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `arabic-presentation-forms-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        database: target.label,
        mode: APPLY ? "apply" : "dry-run",
        rows: affected.map(({ row, changes }) => ({
          id: row.id,
          ownerId: row.ownerId,
          slug: row.slug,
          name: row.name,
          status: row.status,
          version: row.version,
          updatedAt: row.updatedAt,
          previewStatus: row.previewStatus,
          previewUpdatedAt: row.previewUpdatedAt,
          data: row.data,
          plannedChanges: changes,
        })),
      },
      null,
      2
    )
  );
  console.log(`\nBackup of ${affected.length} row(s) written to ${path.relative(process.cwd(), backupPath)}`);

  if (!APPLY) {
    console.log("Dry run: nothing was written to the database. Re-run with --apply to fix.");
    return;
  }

  let fixed = 0;
  let conflicts = 0;
  for (const { row, fixedData, changes } of affected) {
    const updated = await prisma.$transaction(async (tx: any) => {
      // Guarded by the scanned version: a template edited since the scan is left alone.
      const { count } = await tx.template.updateMany({
        where: { id: row.id, version: row.version },
        data: { data: fixedData, version: { increment: 1 } },
      });
      if (count === 0) return null;
      const item = await tx.template.findUnique({ where: { id: row.id } });
      await tx.templateRevision.create({
        data: {
          templateId: item.id,
          version: item.version,
          action: REVISION_ACTION,
          actorId: item.ownerId,
          snapshot: buildSnapshot(item),
        },
      });
      return item;
    });
    if (!updated) {
      conflicts += 1;
      console.log(`✗ ${row.id}: changed since the scan (version ${row.version}); skipped`);
      continue;
    }
    // Verify: the stored text normalises to itself now.
    const recheck = normalizeTemplateArabicTextInPlace(structuredClone(updated.data));
    fixed += 1;
    console.log(
      `✓ ${row.id}: ${changes.length} layer(s) fixed, version ${row.version} → ${updated.version}, ` +
        `updatedAt ${updated.updatedAt.toISOString()}, re-check ${recheck.length === 0 ? "clean" : `${recheck.length} change(s) left!`}`
    );
  }
  console.log(`\nApplied: ${fixed} fixed, ${conflicts} skipped (changed since scan).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
