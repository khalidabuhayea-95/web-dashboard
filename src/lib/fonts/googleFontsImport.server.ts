import { upsertEditorCustomFont } from "@/lib/editor/customFonts.server";
import {
  findFontFamiliesByNames,
  normalizeFontStorageKey,
} from "@/lib/editor/fontStorage.server";
import { createLogger } from "@/lib/logging/logger";

// Bulk-import the Google Fonts corpus (Latin/English + Arabic) into the
// FontFamily/FontFile tables, categorized by language. Fonts are sourced from
// google-webfonts-helper (no API key, direct TTF URLs) and re-hosted to our R2
// storage by the shared upsertEditorCustomFont pipeline (which requires a
// dataUrl to actually upload — the [id]/file route streams bytes, never redirects).

const logger = createLogger("fonts.google-import");

const GWFH_LIST_URL = "https://gwfh.mranftl.com/api/fonts?subsets=latin,arabic&sort=alpha";
const GWFH_DETAIL_URL = "https://gwfh.mranftl.com/api/fonts/";

const CATALOG_TTL_MS = 10 * 60 * 1000;
// upsertEditorCustomFont rejects fonts over its own 5MB cap; skip larger ones
// up front so we don't waste an upload attempt.
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_LIMIT = 40;
const IMPORT_CONCURRENCY = 4;

const CATEGORY_EXCLUSIVE = "EXCLUSIVE";
const CATEGORY_ENGLISH = "ENGLISH";
const CATEGORY_ARABIC = "ARABIC";

type FontCandidate = {
  id: string;
  family: string;
  subsets: string[];
  categories: string[];
};

export type GoogleFontsBatchResult = {
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  nextOffset: number;
  done: boolean;
  counts: { english: number; arabic: number };
  errors: Array<{ family: string; message: string }>;
};

function inferLanguageCategories(subsets: string[]): string[] {
  const tokens = (Array.isArray(subsets) ? subsets : []).map((s) => String(s || "").toLowerCase());
  const hasArabic = tokens.some((t) => t.includes("arabic"));
  const hasEnglish = tokens.some(
    (t) => t.includes("latin") || t.includes("western") || t.includes("english")
  );
  if (!hasArabic && !hasEnglish) return [];
  const categories = [CATEGORY_EXCLUSIVE];
  if (hasArabic) categories.push(CATEGORY_ARABIC);
  if (hasEnglish) categories.push(CATEGORY_ENGLISH);
  return categories;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "web-dashboard-font-import/1.0" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let catalogCache: FontCandidate[] | null = null;
let catalogFetchedAt = 0;

export async function fetchGoogleFontsCatalog(force = false): Promise<FontCandidate[]> {
  if (!force && catalogCache && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const response = await fetchWithTimeout(GWFH_LIST_URL, 45_000);
  if (!response?.ok) {
    throw new Error(`Failed to fetch the Google Fonts catalog (${response?.status || "network error"}).`);
  }
  const list = await response.json();
  const catalog = (Array.isArray(list) ? list : [])
    .map((entry: any) => {
      const id = String(entry?.id || "").trim();
      const family = String(entry?.family || "").trim();
      const subsets = Array.isArray(entry?.subsets) ? entry.subsets.map((s: any) => String(s || "")) : [];
      const categories = inferLanguageCategories(subsets);
      if (!id || !family || categories.length === 0) return null;
      return { id, family, subsets, categories } as FontCandidate;
    })
    .filter(Boolean) as FontCandidate[];

  catalogCache = catalog;
  catalogFetchedAt = Date.now();
  logger.info("Fetched Google Fonts catalog", { total: catalog.length });
  return catalog;
}

// Resolve the regular (400) TTF URL for a family via the gwfh detail endpoint.
async function resolveRegularTtf(candidate: FontCandidate): Promise<{ ttfUrl: string; family: string } | null> {
  const preferredSubset = candidate.subsets.some((s) => s.toLowerCase().includes("arabic"))
    ? "arabic"
    : candidate.subsets.some((s) => s.toLowerCase().includes("latin"))
      ? "latin"
      : candidate.subsets[0] || "latin";
  const url = `${GWFH_DETAIL_URL}${encodeURIComponent(candidate.id)}?subsets=${encodeURIComponent(preferredSubset)}`;
  const response = await fetchWithTimeout(url, 25_000);
  if (!response?.ok) return null;
  const detail = await response.json();
  const variants: any[] = Array.isArray(detail?.variants) ? detail.variants : [];
  const regular =
    variants.find((v) => String(v?.id || "").toLowerCase() === "regular") ||
    variants.find(
      (v) => String(v?.fontStyle || "").toLowerCase() === "normal" && String(v?.fontWeight || "") === "400"
    );
  const ttfUrl = String(regular?.ttf || "").trim();
  if (!ttfUrl) return null;
  return { ttfUrl, family: String(detail?.family || candidate.family).trim() };
}

async function fetchTtfDataUrl(ttfUrl: string): Promise<string | null> {
  const response = await fetchWithTimeout(ttfUrl, 30_000);
  if (!response?.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_FONT_BYTES) return null;
  return `data:font/ttf;base64,${bytes.toString("base64")}`;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export async function importGoogleFontsBatch({
  offset = 0,
  limit = 20,
}: {
  offset?: number;
  limit?: number;
} = {}): Promise<GoogleFontsBatchResult> {
  const catalog = await fetchGoogleFontsCatalog();
  const total = catalog.length;
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(Number(limit) || 20)));
  const slice = catalog.slice(start, start + size);

  // Skip families already present (idempotent / resumable). One lookup per batch.
  const existing = await findFontFamiliesByNames(slice.map((c) => c.family)).catch(() => new Map());
  const toImport = slice.filter((c) => !existing.has(normalizeFontStorageKey(c.family)));
  let skipped = slice.length - toImport.length;

  let imported = 0;
  let failed = 0;
  const counts = { english: 0, arabic: 0 };
  const errors: Array<{ family: string; message: string }> = [];

  await runWithConcurrency(toImport, IMPORT_CONCURRENCY, async (candidate) => {
    try {
      const resolved = await resolveRegularTtf(candidate);
      if (!resolved?.ttfUrl) {
        failed += 1;
        if (errors.length < 8) errors.push({ family: candidate.family, message: "No TTF variant found." });
        return;
      }
      const dataUrl = await fetchTtfDataUrl(resolved.ttfUrl);
      if (!dataUrl) {
        failed += 1;
        if (errors.length < 8) errors.push({ family: candidate.family, message: "Download failed or too large." });
        return;
      }
      const result = await upsertEditorCustomFont({
        family: resolved.family,
        fileName: `${resolved.family}.ttf`,
        dataUrl,
        mimeType: "font/ttf",
        categories: candidate.categories,
        source: "google",
        sourceId: candidate.id,
        removable: true,
        includeFontList: false,
      });
      if (result?.skippedDuplicate) {
        // Already present (e.g. added under its real name via Canva) — not a new import.
        skipped += 1;
        return;
      }
      imported += 1;
      if (candidate.categories.includes(CATEGORY_ARABIC)) counts.arabic += 1;
      if (candidate.categories.includes(CATEGORY_ENGLISH)) counts.english += 1;
    } catch (error) {
      failed += 1;
      if (errors.length < 8) {
        errors.push({
          family: candidate.family,
          message: error instanceof Error ? error.message : "Import failed.",
        });
      }
    }
  });

  const nextOffset = start + slice.length;
  const done = nextOffset >= total;

  logger.info("Google Fonts import batch", {
    start,
    size: slice.length,
    imported,
    skipped,
    failed,
    total,
    done,
  });

  return { total, processed: slice.length, imported, skipped, failed, nextOffset, done, counts, errors };
}
