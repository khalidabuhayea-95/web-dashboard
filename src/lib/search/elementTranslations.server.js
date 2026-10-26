/**
 * Fills the Arabic title and tags of catalogue elements whose import translation fell back to
 * English (translation_status = 'fallback': the free translator was rate-limited or down). On
 * 2026-10-19 that was a quarter of the catalogue — 2,495 elements an Arabic search could not see.
 *
 * Known pairs come from the catalogue itself first (every English tag some other element already
 * carries in Arabic), so most strings never reach the translator; the rest are translated with
 * retries. tags_ar stays index-aligned with tags_en, the way the importers write it. `updated_at`
 * is left alone (it orders the catalogue). Rows whose strings all translated, or translated to
 * themselves (brand names), become 'translated'; rows with a failed string stay 'fallback' for the
 * next sweep.
 *
 * Runs after every Freepik import job and every canvas publish (a small sweep), and in bulk via
 * `npm run search:backfill -- --elements` (which can also recheck rows marked 'translated' whose
 * Arabic fields are still English).
 */
import { after } from "next/server";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { translateBatch } from "@/lib/tools/arabicTranslate.server";

const ARABIC_RE = /[؀-ۿ]/u;
const LATIN_RE = /[A-Za-z]/;
const ARABIC_SQL = "[؀-ۿ]";

const needsArabic = (english, arabic) => LATIN_RE.test(String(english || "")) && !ARABIC_RE.test(String(arabic || ""));

/** Rows to fix: fallbacks always; with `recheck`, also 'translated' rows still lacking Arabic. */
async function selectRows({ ids, limit, recheck }) {
  const where = [
    recheck
      ? `(translation_status = 'fallback' OR title_ar !~ '${ARABIC_SQL}' OR (jsonb_array_length(tags_en) > 0 AND tags_ar::text !~ '${ARABIC_SQL}'))`
      : `translation_status = 'fallback'`,
  ];
  const params = [];
  if (Array.isArray(ids) && ids.length) {
    params.push(ids.map(String));
    where.push(`id = ANY($${params.length}::uuid[])`);
  }
  const limitSql = Number(limit) > 0 ? `LIMIT ${Math.floor(Number(limit))}` : "";
  return prisma.$queryRawUnsafe(
    `SELECT id::text AS id, title_en, title_ar, tags_en, tags_ar, translation_status
     FROM editor_element_assets WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC ${limitSql}`,
    ...params
  );
}

/**
 * English → Arabic pairs the catalogue already holds. Only rows whose two tag lists have the SAME
 * length count (558 Freepik rows have a shorter / longer Arabic list, so their positions do not
 * line up), and only the Arabic a tag gets most often, seen at least twice — one stray row never
 * decides a pair. Titles pair 1:1 and need no such care.
 */
async function loadKnownPairs(strings) {
  const known = new Map();
  if (!strings.length) return known;
  const rows = await prisma.$queryRawUnsafe(
    `WITH wanted AS (SELECT unnest($1::text[]) AS en),
     pairs AS (
       SELECT title_en AS en, title_ar AS ar FROM editor_element_assets
       UNION ALL
       SELECT en_tag.value AS en, ar_tag.value AS ar
       FROM editor_element_assets,
            jsonb_array_elements_text(tags_en) WITH ORDINALITY AS en_tag(value, n)
            JOIN jsonb_array_elements_text(tags_ar) WITH ORDINALITY AS ar_tag(value, n) USING (n)
       WHERE jsonb_array_length(tags_en) = jsonb_array_length(tags_ar)
     ),
     counted AS (
       SELECT en, ar, count(*) AS uses FROM pairs
       WHERE en IN (SELECT en FROM wanted) AND ar ~ '${ARABIC_SQL}'
       GROUP BY en, ar
     )
     SELECT DISTINCT ON (en) en, ar FROM counted WHERE uses >= 2 ORDER BY en, uses DESC, ar`,
    strings
  );
  for (const row of rows) known.set(String(row.en), String(row.ar));
  return known;
}

/**
 * @param {{ ids?: string[], limit?: number, recheck?: boolean, dryRun?: boolean,
 *           onBackup?: (row: object) => void, onProgress?: (message: string) => void }} options
 * @returns {Promise<{ scanned: number, updated: number, translatedStrings: number, failedStrings: number, fromCatalogue: number, stopped: boolean }>}
 *   stopped = the translator kept refusing (rate limit); the rest waits for the next run
 */
export async function fillMissingElementTranslations(options = {}) {
  const rows = await selectRows(options);
  const summary = { scanned: rows.length, updated: 0, translatedStrings: 0, failedStrings: 0, fromCatalogue: 0, stopped: false };
  // Chunks keep progress: each chunk is translated and WRITTEN before the next one starts, so a
  // rate limit halfway through loses nothing already done.
  const chunkSize = Math.max(1, Number(options.chunkSize) || 150);
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    // Once the translator refuses, the remaining chunks still get every pair the catalogue knows.
    const part = await fillChunk(chunk, { ...options, translatorDown: summary.stopped });
    summary.updated += part.updated;
    summary.translatedStrings += part.translatedStrings;
    summary.failedStrings += part.failedStrings;
    summary.fromCatalogue += part.fromCatalogue;
    summary.stopped = summary.stopped || part.stopped;
    options.onProgress?.(
      `${Math.min(start + chunkSize, rows.length)}/${rows.length} rows · ${summary.updated} updated · ${summary.translatedStrings} translated · ${summary.fromCatalogue} from the catalogue · ${summary.failedStrings} failed${summary.stopped ? " · translator refusing, stopped" : ""}`
    );
  }
  return summary;
}

async function fillChunk(rows, options) {
  const summary = { updated: 0, translatedStrings: 0, failedStrings: 0, fromCatalogue: 0, stopped: false };
  if (!rows.length) return summary;

  const wanted = new Set();
  for (const row of rows) {
    if (needsArabic(row.title_en, row.title_ar)) wanted.add(String(row.title_en).trim());
    const tagsEn = Array.isArray(row.tags_en) ? row.tags_en : [];
    const tagsAr = Array.isArray(row.tags_ar) ? row.tags_ar : [];
    tagsEn.forEach((tag, index) => {
      if (needsArabic(tag, tagsAr[index])) wanted.add(String(tag).trim());
    });
  }
  const known = await loadKnownPairs([...wanted]);
  summary.fromCatalogue = known.size;
  const toTranslate = [...wanted].filter((text) => !known.has(text));
  // `options.translate` (tests): a plain { english: arabic } object stands in for the translator.
  const fake = options.translate && typeof options.translate === "object" ? options.translate : null;
  const runTranslate = fake
    ? async (texts) => Object.assign(new Map(texts.map((text) => [text, fake[text] ?? text])), { failed: new Set(), stopped: false })
    : options.translatorDown
      ? async (texts) => Object.assign(new Map(texts.map((text) => [text, text])), { failed: new Set(texts), stopped: true })
      : (texts) =>
        translateBatch(texts, {
          to: "ar",
          from: "en",
          concurrency: Number(options.concurrency) || 1,
          delayMs: Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 600,
        });
  if (options.dryRun) {
    // Counts only: a dry run never spends the translator's rate limit.
    summary.translatedStrings = toTranslate.length;
    summary.updated = rows.length;
    return summary;
  }
  const translated = toTranslate.length ? await runTranslate(toTranslate) : new Map();
  const failed = translated.failed || new Set();
  summary.stopped = Boolean(translated.stopped);
  summary.translatedStrings = toTranslate.length - failed.size;
  summary.failedStrings = failed.size;
  const arabicFor = (english) => {
    const key = String(english || "").trim();
    if (known.has(key)) return known.get(key);
    const value = translated.get(key);
    return value && ARABIC_RE.test(value) ? value : null;
  };

  for (const row of rows) {
    let anyFailed = false;
    const nextTitle = needsArabic(row.title_en, row.title_ar) ? arabicFor(row.title_en) : null;
    if (needsArabic(row.title_en, row.title_ar) && failed.has(String(row.title_en).trim())) anyFailed = true;
    const tagsEn = Array.isArray(row.tags_en) ? row.tags_en : [];
    const tagsAr = Array.isArray(row.tags_ar) ? [...row.tags_ar] : [];
    let tagsChanged = false;
    const nextTags = tagsEn.map((tag, index) => {
      const current = tagsAr[index] ?? tag;
      if (!needsArabic(tag, current)) return current;
      if (failed.has(String(tag).trim())) anyFailed = true;
      const arabic = arabicFor(tag);
      if (!arabic) return current;
      tagsChanged = true;
      return arabic;
    });
    const status = anyFailed ? "fallback" : "translated";
    if (!nextTitle && !tagsChanged && status === row.translation_status) continue;
    summary.updated += 1;
    options.onBackup?.(row);
    await prisma.$executeRawUnsafe(
      `UPDATE editor_element_assets SET title_ar = $1, tags_ar = $2::jsonb, translation_status = $3 WHERE id = $4::uuid`,
      nextTitle || row.title_ar,
      JSON.stringify(nextTags),
      status,
      row.id
    );
  }
  return summary;
}

/** A small sweep after an import, once the response is out (or in the background in a job). */
export function scheduleElementTranslationSweep({ limit = 300 } = {}) {
  const run = () =>
    fillMissingElementTranslations({ limit })
      .then((summary) => {
        if (summary.updated) logger.info("Element translation sweep", summary);
      })
      .catch((error) => {
        logger.warn("Element translation sweep failed", { error: error instanceof Error ? error.message : String(error) });
      });
  try {
    after(run);
  } catch {
    void run();
  }
}
