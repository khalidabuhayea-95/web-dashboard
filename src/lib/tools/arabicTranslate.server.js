const TRANSLATE_TIMEOUT_MS = 8_000;

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

async function translateOneToArabic(text) {
  const source = sanitizeText(text);
  if (!source) return "";
  if (containsArabic(source)) return source;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", "ar");
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

export async function translateBatchToArabic(texts = []) {
  const unique = Array.from(
    new Set(
      (Array.isArray(texts) ? texts : [])
        .map((value) => sanitizeText(value))
        .filter(Boolean)
    )
  );

  const translatedMap = new Map();
  for (const text of unique) {
    try {
      const translated = await translateOneToArabic(text);
      translatedMap.set(text, translated || text);
    } catch {
      translatedMap.set(text, text);
    }
  }

  return translatedMap;
}
