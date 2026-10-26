/**
 * Query-time translation for search: each concept surface that no synonym already bridges is
 * translated into the other language (Arabic ⇄ English) with the free translate endpoint the
 * catalogue importers use.
 *
 * Searches must stay fast, so: results are cached in memory (a word is translated once per server
 * process), every uncached word of one query is requested in parallel, and the whole step gives up
 * after SEARCH_TRANSLATE_BUDGET_MS — the search then runs on synonyms and the bilingual data alone.
 * A failure is cached briefly so an outage does not add the budget to every search.
 */
import { translateText } from "@/lib/tools/arabicTranslate.server";
import { attachTranslations, buildSearchPlan, surfacesNeedingTranslation } from "@/lib/search/searchPlan";

// Google answers in 150–400 ms; a first-time word never holds a search longer than this.
export const SEARCH_TRANSLATE_BUDGET_MS = 800;
const CACHE_LIMIT = 5000;
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // `${target}:${surface}` → { value: string | null, expiresAt }

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency (Map keeps insertion order; the oldest entry is evicted first).
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function writeCache(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/** Test seam: clears the in-memory cache. */
export function clearSearchTranslationCache() {
  cache.clear();
}

/**
 * @param {Array<{ surface: string, target: "ar" | "en" }>} requests
 * @returns {Promise<Map<string, string>>} surface → translation (only successful, non-identical ones)
 */
export async function translateSearchSurfaces(requests, { budgetMs = SEARCH_TRANSLATE_BUDGET_MS, translator = translateText } = {}) {
  const out = new Map();
  const pending = [];
  for (const { surface, target } of requests || []) {
    const key = `${target}:${surface}`;
    const cached = readCache(key);
    if (cached !== undefined) {
      if (cached) out.set(surface, cached);
      continue;
    }
    pending.push(
      translator(surface, { from: target === "en" ? "ar" : "en", to: target, timeoutMs: budgetMs, attempts: 1 })
        .then((value) => {
          const clean = String(value || "").trim();
          const useful = clean && clean.toLowerCase() !== surface ? clean : null;
          writeCache(key, useful, useful ? HIT_TTL_MS : MISS_TTL_MS);
          if (useful) out.set(surface, useful);
        })
        .catch(() => writeCache(key, null, MISS_TTL_MS))
    );
  }
  if (pending.length) {
    let timer;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
    clearTimeout(timer);
  }
  return out;
}

/**
 * Query → plan with synonyms, derived forms and (when reachable in time) translations.
 * `translate: false` skips the translator; `translator` / `budgetMs` are test seams.
 */
export async function planSearchQuery(query, { translate = true, translator, budgetMs } = {}) {
  const plan = buildSearchPlan(query);
  if (!plan.concepts.length || translate === false) return plan;
  const translations = await translateSearchSurfaces(surfacesNeedingTranslation(plan), {
    ...(translator ? { translator } : {}),
    ...(budgetMs ? { budgetMs } : {}),
  });
  return attachTranslations(plan, translations);
}
