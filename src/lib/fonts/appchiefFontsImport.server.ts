import { upsertEditorCustomFont } from "@/lib/editor/customFonts.server";
import {
  defaultWeightVariants,
  findFontFamiliesByNames,
  normalizeFontStorageKey,
} from "@/lib/editor/fontStorage.server";
import { createLogger } from "@/lib/logging/logger";

// Import fonts from the app's own font catalog API (designData) into the
// FontFamily/FontFile tables. Fonts come as direct TTF/OTF URLs grouped by
// language; each is re-hosted to R2 via the shared upsertEditorCustomFont
// pipeline, which also DEDUPES (skipIfExists) so existing fonts aren't re-added.

const logger = createLogger("fonts.appchief-import");

const APPCHIEF_FONTS_URL = "https://and.appchief.dev/api/v2.2/designData";
const CATALOG_TTL_MS = 10 * 60 * 1000;
const MAX_FONT_BYTES = 5 * 1024 * 1024; // matches upsertEditorCustomFont's cap
const MAX_BATCH_LIMIT = 40;
const IMPORT_CONCURRENCY = 4;

type AppchiefFont = {
  id: string;
  family: string;
  url: string;
  mimeType: string;
  categories: string[];
  premium: boolean;
};

export type AppchiefBatchResult = {
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

function sanitizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeUrl(value: unknown): string {
  const raw = sanitizeText(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    return new URL(raw).toString();
  } catch {
    return "";
  }
}

function mimeForUrl(url: string): string {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith(".otf")) return "font/otf";
  if (clean.endsWith(".ttc")) return "font/ttc";
  return "font/ttf";
}

// Map the API's language group title to our font language categories. The app is
// Arabic-first, so the "exclusive" (حصري) group and any unknown title default to
// Arabic (re-categorizable in the Fonts tab).
function categoriesForGroupTitle(title: string): string[] {
  const t = sanitizeText(title);
  if (t.includes("انجليز") || /english/i.test(t)) return ["ENGLISH"];
  if (t.includes("عرب") || /arabic/i.test(t)) return ["ARABIC"];
  return ["ARABIC"];
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "web-dashboard-font-import/1.0", ...(init?.headers || {}) },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let catalogCache: AppchiefFont[] | null = null;
let catalogFetchedAt = 0;

export async function fetchAppchiefFontsCatalog(force = false): Promise<AppchiefFont[]> {
  if (!force && catalogCache && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const response = await fetchWithTimeout(APPCHIEF_FONTS_URL, 60_000);
  if (!response?.ok) {
    throw new Error(`Failed to fetch the app fonts catalog (${response?.status || "network error"}).`);
  }
  const payload = await response.json();
  const groups = Array.isArray(payload?.data?.fonts?.fonts) ? payload.data.fonts.fonts : [];

  const byKey = new Map<string, AppchiefFont>();
  for (const group of groups) {
    const categories = categoriesForGroupTitle(group?.title);
    const subGroups = Array.isArray(group?.sub_groups) ? group.sub_groups : [];
    for (const sub of subGroups) {
      const fonts = Array.isArray(sub?.fonts) ? sub.fonts : [];
      for (const font of fonts) {
        const family = sanitizeText(font?.full_name || font?.postscript || font?.save_name);
        const url = sanitizeUrl(font?.url);
        if (!family || !url) continue;
        const key = normalizeFontStorageKey(family);
        if (!key || byKey.has(key)) continue; // de-dupe within the source catalog
        byKey.set(key, {
          id: sanitizeText(font?.id) || key,
          family,
          url,
          mimeType: mimeForUrl(url),
          categories,
          premium: Boolean(font?.is_premium),
        });
      }
    }
  }

  const catalog = Array.from(byKey.values());
  catalogCache = catalog;
  catalogFetchedAt = Date.now();
  logger.info("Fetched app fonts catalog", { total: catalog.length });
  return catalog;
}

async function fetchFontDataUrl(url: string, mimeType: string): Promise<string | null> {
  const response = await fetchWithTimeout(url, 30_000);
  if (!response?.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_FONT_BYTES) return null;
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
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

export async function importAppchiefFontsBatch({
  offset = 0,
  limit = 20,
}: {
  offset?: number;
  limit?: number;
} = {}): Promise<AppchiefBatchResult> {
  const catalog = await fetchAppchiefFontsCatalog();
  const total = catalog.length;
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(Number(limit) || 20)));
  const slice = catalog.slice(start, start + size);

  // Skip families already in the library (idempotent / "don't add if it exists").
  // Matches default-weight spellings too, so "Cairo Regular" here recognises an
  // already-imported "Cairo" and doesn't re-download it.
  const existing = await findFontFamiliesByNames(
    slice.flatMap((f) => [f.family, ...defaultWeightVariants(f.family)])
  ).catch(() => new Map());
  const toImport = slice.filter(
    (f) =>
      ![f.family, ...defaultWeightVariants(f.family)].some((name) =>
        existing.has(normalizeFontStorageKey(name))
      )
  );
  let skipped = slice.length - toImport.length;

  let imported = 0;
  let failed = 0;
  const counts = { english: 0, arabic: 0 };
  const errors: Array<{ family: string; message: string }> = [];

  await runWithConcurrency(toImport, IMPORT_CONCURRENCY, async (font) => {
    try {
      const dataUrl = await fetchFontDataUrl(font.url, font.mimeType);
      if (!dataUrl) {
        failed += 1;
        if (errors.length < 8) errors.push({ family: font.family, message: "Download failed or too large." });
        return;
      }
      const result = await upsertEditorCustomFont({
        family: font.family,
        fileName: `${font.family}.${font.mimeType.includes("otf") ? "otf" : "ttf"}`,
        dataUrl,
        mimeType: font.mimeType,
        categories: font.categories,
        source: "appchief",
        sourceId: font.id,
        removable: true,
        includeFontList: false,
      });
      if (result?.skippedDuplicate) {
        skipped += 1;
        return;
      }
      imported += 1;
      if (font.categories.includes("ARABIC")) counts.arabic += 1;
      if (font.categories.includes("ENGLISH")) counts.english += 1;
    } catch (error) {
      failed += 1;
      if (errors.length < 8) {
        errors.push({ family: font.family, message: error instanceof Error ? error.message : "Import failed." });
      }
    }
  });

  const nextOffset = start + slice.length;
  const done = nextOffset >= total;

  logger.info("App fonts import batch", { start, size: slice.length, imported, skipped, failed, total, done });

  return { total, processed: slice.length, imported, skipped, failed, nextOffset, done, counts, errors };
}
