const TRANSLATE_TIMEOUT_MS = 8_000;

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

async function translate(source, { from, to, timeoutMs = TRANSLATE_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", from);
    url.searchParams.set("tl", to);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", source);

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json,text/plain,*/*",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Translate request failed (${response.status}).`);
    }

    const payload = await response.json();
    const translated = Array.isArray(payload?.[0])
      ? payload[0]
          .map((entry) => (Array.isArray(entry) ? sanitizeText(entry[0]) : ""))
          .filter(Boolean)
          .join(" ")
      : "";

    return sanitizeText(translated);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Arabic prompt in, English prompt out — for the image generators, whose text
 * encoders are English-only. Returns the input unchanged when it holds no
 * Arabic, so an English prompt costs no round trip, and on any failure so a
 * translator outage degrades to "the model sees the original" rather than to a
 * dead feature.
 */
export async function translatePromptToEnglish(text) {
  const source = sanitizeText(text);
  if (!source || !containsArabic(source)) return source;
  try {
    return (await translate(source, { from: "ar", to: "en" })) || source;
  } catch {
    return source;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One translation with retries: the free endpoint answers 429 / times out under bursts, and a
 * silent fallback used to leave a quarter of the element catalogue with English "Arabic" tags.
 * Throws after the last attempt so callers can tell "failed" from "translated to itself".
 */
export async function translateText(text, { from = "auto", to, timeoutMs = TRANSLATE_TIMEOUT_MS, attempts = 3 } = {}) {
  const source = sanitizeText(text);
  if (!source) return "";
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    if (attempt > 0) await sleep(400 * 3 ** (attempt - 1));
    try {
      return await translate(source, { from, to, timeoutMs });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Translate request failed.");
}

/**
 * Many texts → Map(text → translation), one request per text (`concurrency` workers, each pausing
 * `delayMs` between requests). A text whose every attempt failed maps to itself and is listed in
 * the returned map's `failed` set. The free endpoint rate-limits bursts (HTTP 429 for up to ~2 h
 * after ~1.2k fast calls), so after `stopAfterFailures` consecutive failures the batch stops
 * calling it: the rest are marked failed at once and `map.stopped` is true.
 *
 * ★Never join several texts into one request (one per line): the answer can come back with the
 * lines SHIFTED while their count still matches — "arrows" came back as «إبريق الشاي الشرقي»,
 * "ui" as «مشغل فيديو» (2026-10-19). One text per request is the only aligned form.
 */
export async function translateBatch(
  texts = [],
  { to, from = "auto", concurrency = 2, attempts = 3, skip = null, delayMs = 400, stopAfterFailures = 8 } = {}
) {
  const unique = Array.from(
    new Set(
      (Array.isArray(texts) ? texts : [])
        .map((value) => sanitizeText(value))
        .filter(Boolean)
    )
  );
  const translatedMap = new Map();
  translatedMap.failed = new Set();
  translatedMap.stopped = false;
  let consecutiveFailures = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < unique.length) {
      const text = unique[cursor];
      cursor += 1;
      if (skip && skip(text)) {
        translatedMap.set(text, text);
        continue;
      }
      if (translatedMap.stopped) {
        translatedMap.set(text, text);
        translatedMap.failed.add(text);
        continue;
      }
      try {
        translatedMap.set(text, (await translateText(text, { from, to, attempts })) || text);
        consecutiveFailures = 0;
      } catch {
        translatedMap.set(text, text);
        translatedMap.failed.add(text);
        consecutiveFailures += 1;
        if (stopAfterFailures > 0 && consecutiveFailures >= stopAfterFailures) translatedMap.stopped = true;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, worker));
  return translatedMap;
}

export async function translateBatchToArabic(texts = []) {
  return translateBatch(texts, { to: "ar", skip: containsArabic });
}
