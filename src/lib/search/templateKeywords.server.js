/**
 * Machine search keywords for templates: the template's name translated into the language it is
 * NOT written in (an Arabic name gets English keywords, an English name Arabic ones), folded and
 * cleaned. Stored in Template."searchKeywords" and folded into the generated "searchTags" column
 * (migration 20261019120000), so «دعوة زفاف» templates answer "wedding invitation" and the other
 * way round without anyone typing tags. Human `tags` are never touched.
 *
 * Written on every create / rename (scheduleTemplateSearchKeywords, after the response is sent)
 * and in bulk by `npm run search:backfill`. The write keeps `updatedAt` (it is not an edit: a bump
 * would hide a ready preview video and reload an open editor).
 */
import { after } from "next/server";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { isSearchStopword } from "@/lib/search/searchPlan";
import { normalizeSearchText, tokenizeSearchQuery } from "@/lib/text/arabicSearch";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";
import { translateText } from "@/lib/tools/arabicTranslate.server";

export const MAX_TEMPLATE_KEYWORDS = 24;

// Size and housekeeping words Canva appends to every name ("- مقاس A4 (تصميم أفقي)"): they say
// nothing about the design, so they are not worth a keyword. Folded forms.
const NOISE = new Set(
  [
    "مقاس", "بيكسل", "بكسل", "تصميم", "نسخة", "قالب", "عمودي", "أفقي", "سم",
    "px", "pixel", "pixels", "size", "design", "copy", "untitled", "template", "vertical", "horizontal",
    "landscape", "portrait", "cm", "mm", "in",
  ].map((word) => normalizeSearchText(word))
);

/** Folded keywords of a text: no stopwords, no size noise, no bare numbers, de-duplicated. */
export function keywordsFromText(text) {
  const out = [];
  for (const word of tokenizeSearchQuery(text, { maxTokens: 64 })) {
    if ([...word].length < 2 || /^[0-9]+$/.test(word) || NOISE.has(word) || isSearchStopword(word)) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * @returns {Promise<{ keywords: string[], failed: boolean }>} failed = the translator could not
 *   be reached (the caller keeps the old keywords and a later backfill retries).
 */
/**
 * Which language(s) a name needs keywords in. Decided by LETTER COUNT, not by the mere presence
 * of a script: Canva appends Arabic size labels to English names ("Black Minimal Food Menu
 * Instagram Story - قصتك"), which once sent those names to English and left them with no Arabic
 * keywords. A name with a real share of both scripts gets both.
 */
export function keywordTargets(name) {
  const text = String(name || "");
  const arabic = (text.match(/[\u0600-\u06FF]/gu) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = arabic + latin;
  if (total < 3) return [];
  const targets = [];
  if (arabic >= 3 && arabic / total >= 0.3) targets.push("en");
  if (latin >= 3 && latin / total >= 0.3) targets.push("ar");
  return targets;
}

export async function buildTemplateSearchKeywords(name, { translate = translateText } = {}) {
  const source = String(name || "").trim();
  const targets = keywordTargets(source);
  if (!source || targets.length === 0) return { keywords: [], failed: false };
  const own = new Set(keywordsFromText(source));
  const keywords = [];
  let failures = 0;
  for (const target of targets) {
    try {
      // Only the words written in the source language are sent, with that language named: a mixed
      // name ("… Car Rental Mobile Video - فيديو للهاتف") sent whole comes back mostly untouched,
      // and auto-detect reads it as already Arabic.
      const part = (target === "ar" ? source.replace(/[\u0600-\u06FF]+/gu, " ") : source.replace(/[A-Za-z]+/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (!part) continue;
      const translated = await translate(part, { from: target === "ar" ? "en" : "ar", to: target, attempts: 3 });
      for (const word of keywordsFromText(translated)) {
        if (!own.has(word) && !keywords.includes(word)) keywords.push(word);
      }
    } catch {
      failures += 1;
    }
  }
  // Only a name whose every translation failed counts as failed (a later run retries it).
  return { keywords: keywords.slice(0, MAX_TEMPLATE_KEYWORDS), failed: failures === targets.length };
}

/** Recomputes one template's keywords from its current name. */
export async function refreshTemplateSearchKeywords(templateId, options = {}) {
  const rows = await prisma.$queryRawUnsafe(`SELECT "name" FROM "Template" WHERE "id" = $1::uuid`, String(templateId));
  const name = rows?.[0]?.name;
  if (typeof name !== "string") return { updated: false, failed: false };
  const { keywords, failed } = await buildTemplateSearchKeywords(name, options);
  if (failed) return { updated: false, failed: true };
  await prisma.$transaction([
    preserveTemplateUpdatedAt(),
    // `name = $3`: a rename that landed meanwhile schedules its own refresh; never write stale words.
    prisma.$executeRawUnsafe(
      `UPDATE "Template" SET "searchKeywords" = $1::jsonb WHERE "id" = $2::uuid AND "name" = $3`,
      JSON.stringify(keywords),
      String(templateId),
      name
    ),
  ]);
  return { updated: true, failed: false, keywords };
}

/**
 * Refreshes the keywords after the current response is sent (Next's after()); outside a request
 * (scripts) it simply runs in the background. Never throws into the caller.
 */
export function scheduleTemplateSearchKeywords(templateId) {
  if (!templateId) return;
  const run = () =>
    refreshTemplateSearchKeywords(templateId).catch((error) => {
      logger.warn("Template search keywords refresh failed", {
        templateId: String(templateId),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
