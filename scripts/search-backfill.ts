/**
 * Search data backfill (smart search, 2026-10-19). Idempotent; safe to re-run.
 *
 *   npm run search:backfill                     both parts
 *   npm run search:backfill -- --elements       Arabic title/tags for elements whose import
 *                                               translation fell back to English
 *   npm run search:backfill -- --elements --recheck
 *                                               also rows marked 'translated' whose Arabic fields
 *                                               are still English
 *   npm run search:backfill -- --templates      machine keywords for templates that have none
 *   npm run search:backfill -- --templates --all  recompute every template's keywords
 *   npm run search:backfill -- --templates --missing-language
 *                                               templates whose keywords lack a language the
 *                                               name needs (English names with no Arabic ones)
 *   npm run search:backfill -- --templates --needs ar
 *                                               recompute every template whose name needs Arabic
 *                                               keywords (English and mixed names)
 *   --dry-run      count only, write nothing
 *   --limit N      at most N rows per part
 *   --restore DIR  put back what a previous run changed (from its backup folder)
 *
 * Every run writes the rows it changes, BEFORE changing them, to
 * ~/nayroz_db_backups/search-backfill-<timestamp>/ (elements.jsonl, templates.jsonl).
 * Template writes keep updatedAt; element writes never touch updated_at.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import prisma from "@/lib/prisma";
import { fillMissingElementTranslations } from "@/lib/search/elementTranslations.server";
import { buildTemplateSearchKeywords, keywordTargets } from "@/lib/search/templateKeywords.server";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const dryRun = has("--dry-run");
const limit = Number(valueOf("--limit")) || 0;
const onlyElements = has("--elements") && !has("--templates");
const onlyTemplates = has("--templates") && !has("--elements");

function appendJsonl(file: string, row: unknown) {
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function readJsonl(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function backfillElements(runDir: string) {
  const backup = path.join(runDir, "elements.jsonl");
  const summary = await fillMissingElementTranslations({
    recheck: has("--recheck"),
    limit: limit || undefined,
    dryRun,
    onBackup: (row: any) =>
      appendJsonl(backup, { id: row.id, title_ar: row.title_ar, tags_ar: row.tags_ar, translation_status: row.translation_status }),
    onProgress: (message: string) => console.log(`[elements] ${message}`),
  });
  console.log("[elements]", summary);
}

async function backfillTemplates(runDir: string) {
  const backup = path.join(runDir, "templates.jsonl");
  // --missing-language: every template whose stored keywords lack a language its name needs
  // (an English name with no Arabic keywords, or the other way round) — the fix for names that
  // were sent the wrong way before keywordTargets() decided by letter share.
  const missingLanguage = has("--missing-language");
  const allRows = (await prisma.$queryRawUnsafe(
    `SELECT "id"::text AS id, "name", "searchKeywords" AS keywords FROM "Template"
     ${has("--all") || missingLanguage || valueOf("--needs") ? "" : `WHERE jsonb_array_length("searchKeywords") = 0`}
     ORDER BY "updatedAt" DESC`
  )) as Array<{ id: string; name: string; keywords: unknown }>;
  const hasScript = (keywords: unknown, re: RegExp) => Array.isArray(keywords) && keywords.some((word) => re.test(String(word)));
  // --needs ar|en: recompute every template whose name needs that language (English names → ar).
  const needs = valueOf("--needs");
  const filtered = needs
    ? allRows.filter((row) => keywordTargets(row.name).includes(needs))
    : missingLanguage
    ? allRows.filter((row) => {
        const targets = keywordTargets(row.name);
        return (
          (targets.includes("ar") && !hasScript(row.keywords, /[\u0600-\u06FF]/u)) ||
          (targets.includes("en") && !hasScript(row.keywords, /[a-z]/))
        );
      })
    : allRows;
  const rows = limit ? filtered.slice(0, Math.floor(limit)) : filtered;
  console.log(`[templates] ${rows.length} template(s) to process${dryRun ? " (dry run)" : ""}`);
  if (dryRun) return;
  let updated = 0;
  let failed = 0;
  let empty = 0;
  let cursor = 0;
  let consecutiveFailures = 0;
  let stopped = false;
  const worker = async () => {
    while (cursor < rows.length && !stopped) {
      const row = rows[cursor];
      cursor += 1;
      const { keywords, failed: unreachable } = await buildTemplateSearchKeywords(row.name);
      // ~1.5 requests/s: the free endpoint blocked us for ~2 h after a faster burst.
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (unreachable) {
        failed += 1;
        consecutiveFailures += 1;
        // The free translator rate-limits bursts; hammering a 429 only extends it. Re-run later:
        // only templates still without keywords are picked up.
        if (consecutiveFailures >= 12) stopped = true;
        continue;
      }
      consecutiveFailures = 0;
      if (!keywords.length) empty += 1;
      appendJsonl(backup, { id: row.id, searchKeywords: row.keywords });
      await prisma.$transaction([
        preserveTemplateUpdatedAt(),
        prisma.$executeRawUnsafe(
          `UPDATE "Template" SET "searchKeywords" = $1::jsonb WHERE "id" = $2::uuid AND "name" = $3`,
          JSON.stringify(keywords),
          row.id,
          row.name
        ),
      ]);
      updated += 1;
      if (updated % 100 === 0) console.log(`[templates] ${updated}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: 1 }, worker));
  console.log("[templates]", { processed: rows.length, updated, withoutKeywords: empty, translatorFailed: failed, stopped });
}

async function restore(dir: string) {
  const elements = readJsonl(path.join(dir, "elements.jsonl"));
  for (const row of elements) {
    await prisma.$executeRawUnsafe(
      `UPDATE editor_element_assets SET title_ar = $1, tags_ar = $2::jsonb, translation_status = $3 WHERE id = $4::uuid`,
      row.title_ar,
      JSON.stringify(row.tags_ar),
      row.translation_status,
      row.id
    );
  }
  const templates = readJsonl(path.join(dir, "templates.jsonl"));
  for (const row of templates) {
    await prisma.$transaction([
      preserveTemplateUpdatedAt(),
      prisma.$executeRawUnsafe(
        `UPDATE "Template" SET "searchKeywords" = $1::jsonb WHERE "id" = $2::uuid`,
        JSON.stringify(row.searchKeywords ?? []),
        row.id
      ),
    ]);
  }
  console.log(`Restored ${elements.length} element(s) and ${templates.length} template(s) from ${dir}`);
}

async function main() {
  const restoreDir = valueOf("--restore");
  if (restoreDir) {
    await restore(path.resolve(restoreDir));
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(os.homedir(), "nayroz_db_backups", `search-backfill-${stamp}`);
  if (!dryRun) {
    fs.mkdirSync(runDir, { recursive: true });
    console.log(`Backups: ${runDir}`);
  }
  if (!onlyTemplates) await backfillElements(runDir);
  if (!onlyElements) await backfillTemplates(runDir);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
