import type { Browser } from "playwright";

import prisma from "@/lib/prisma";
import { resolvePreferredFontFile } from "@/lib/editor/fontStorage.server";
import { bumpFontCatalogVersion } from "@/lib/fonts/fontCatalogVersion.server";
import {
  appendVersionParam,
  getObject,
  getPublicObjectUrl,
  getPublicStorageBucketName,
  uploadObject,
} from "@/lib/storage/objectStorage.server";

const ARABIC_RANGE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

// Rendering knobs. Height/width scale with FONT_SIZE * deviceScaleFactor.
const FONT_SIZE = 72;
const DEVICE_SCALE = 2;
const LIGHT_TEXT_COLOR = "#111827"; // near-black — for light UI backgrounds
const DARK_TEXT_COLOR = "#F9FAFB"; // near-white — for dark UI backgrounds
const ARABIC_SAMPLE = "أبجد هوز حطي";
const LATIN_SAMPLE = "The quick brown fox";
const RENDER_TIMEOUT_MS = 20_000;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const { chromium } = await import("playwright");
    browserPromise = chromium
      .launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

/** Close the shared browser (best-effort; safe to call when none is open). */
export async function closeFontPreviewBrowser(): Promise<void> {
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  try {
    const browser = await current;
    await browser.close();
  } catch {
    // ignore
  }
}

function fontFormatHint(format: string): { css: string; mime: string } {
  const normalized = String(format || "").trim().toLowerCase();
  if (normalized === "otf" || normalized === "opentype") return { css: "opentype", mime: "font/otf" };
  if (normalized === "woff") return { css: "woff", mime: "font/woff" };
  if (normalized === "woff2") return { css: "woff2", mime: "font/woff2" };
  return { css: "truetype", mime: "font/ttf" };
}

function resolvePreviewText(font: any): string {
  const explicit = String(font?.previewText || "").trim();
  if (explicit) return explicit;
  const categories = Array.isArray(font?.categories) ? font.categories.map(String) : [];
  const label = `${font?.displayName || ""} ${font?.family || ""}`;
  const isArabic =
    categories.some((c) => c.toUpperCase() === "ARABIC") || ARABIC_RANGE.test(label);
  return isArabic ? ARABIC_SAMPLE : LATIN_SAMPLE;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadFontBytes(file: any): Promise<Buffer> {
  const bucket = String(file?.storageBucket || "").trim();
  const path = String(file?.storagePath || "").trim();
  if (bucket && path) {
    const obj: any = await getObject(bucket, path);
    if (obj?.Body?.transformToByteArray) {
      return Buffer.from(await obj.Body.transformToByteArray());
    }
  }
  const publicUrl = String(file?.publicUrl || "").trim();
  if (publicUrl) {
    const res = await fetch(publicUrl);
    if (!res.ok) throw new Error(`Font fetch failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("Font file has no storage path or public URL.");
}

function buildHtml(fontBase64: string, format: string, previewText: string): string {
  const { css, mime } = fontFormatHint(format);
  const rtl = ARABIC_RANGE.test(previewText);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'PF';src:url(data:${mime};base64,${fontBase64}) format('${css}');font-display:block;}
html,body{margin:0;padding:0;background:transparent;}
#w{display:inline-block;padding:18px 24px;}
#t{font-family:'PF';font-weight:normal;font-size:${FONT_SIZE}px;line-height:1.4;white-space:nowrap;color:${LIGHT_TEXT_COLOR};}
</style></head><body><div id="w"><div id="t" dir="${rtl ? "rtl" : "ltr"}">${escapeHtml(previewText)}</div></div></body></html>`;
}

/**
 * Playwright only screenshots PNG/JPEG, so re-encode to WebP here. Lossless is
 * both smaller *and* pixel-exact for this content — flat anti-aliased glyphs on
 * transparency have no gradients for a lossy encoder to win on, so lossless beat
 * quality-90 by a wide margin when measured (~67% under PNG vs ~45%).
 */
async function toWebp(png: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
}

export interface FontPreviewResult {
  id: string;
  ok: boolean;
  previewImageUrl?: string | null;
  previewImageDarkUrl?: string | null;
  error?: string;
}

/**
 * Generate light + dark preview images for each font family id, upload them to
 * R2 at `fonts/{id}/preview-light.webp` and `preview-dark.webp`, and persist the
 * public URLs on the FontFamily row. Processes ids sequentially on one shared
 * browser page. Individual failures are captured per id and do not abort the batch.
 */
export async function generateFontFamilyPreviews(
  ids: string[],
  options: { force?: boolean } = {}
): Promise<FontPreviewResult[]> {
  const uniqueIds = Array.from(new Set((ids || []).map((v) => String(v || "").trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const bucket = getPublicStorageBucketName();
  const browser = await getBrowser();
  const context = await browser.newContext({ deviceScaleFactor: DEVICE_SCALE });
  const page = await context.newPage();
  const results: FontPreviewResult[] = [];

  try {
    for (const id of uniqueIds) {
      try {
        const font = await prisma.fontFamily.findUnique({
          where: { id },
          include: { files: true },
        });
        if (!font) {
          results.push({ id, ok: false, error: "Font not found." });
          continue;
        }
        if (!options.force && font.previewImageUrl && font.previewImageDarkUrl) {
          results.push({
            id,
            ok: true,
            previewImageUrl: font.previewImageUrl,
            previewImageDarkUrl: font.previewImageDarkUrl,
          });
          continue;
        }

        const file = resolvePreferredFontFile(font);
        if (!file) {
          results.push({ id, ok: false, error: "No usable font file." });
          continue;
        }

        const bytes = await loadFontBytes(file);
        const previewText = resolvePreviewText(font);
        const html = buildHtml(bytes.toString("base64"), String(file.format || "ttf"), previewText);

        await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
        await Promise.race([
          page.evaluate(async () => {
            await (document as any).fonts.load(`72px PF`);
            await (document as any).fonts.ready;
          }),
          new Promise((resolve) => setTimeout(resolve, RENDER_TIMEOUT_MS)),
        ]);

        const el = page.locator("#w");
        const lightPng = await el.screenshot({ omitBackground: true, timeout: RENDER_TIMEOUT_MS });
        await page.evaluate((color) => {
          const node = document.getElementById("t");
          if (node) node.style.color = color;
        }, DARK_TEXT_COLOR);
        const darkPng = await el.screenshot({ omitBackground: true, timeout: RENDER_TIMEOUT_MS });

        const [lightWebp, darkWebp] = await Promise.all([
          toWebp(lightPng),
          toWebp(darkPng),
        ]);

        const version = String(Date.now());
        const lightKey = `fonts/${id}/preview-light.webp`;
        const darkKey = `fonts/${id}/preview-dark.webp`;
        await uploadObject({
          bucket,
          key: lightKey,
          body: lightWebp,
          contentType: "image/webp",
          cacheControl: "public, max-age=86400",
          upsert: true,
        });
        await uploadObject({
          bucket,
          key: darkKey,
          body: darkWebp,
          contentType: "image/webp",
          cacheControl: "public, max-age=86400",
          upsert: true,
        });

        const previewImageUrl = appendVersionParam(getPublicObjectUrl(bucket, lightKey), version);
        const previewImageDarkUrl = appendVersionParam(getPublicObjectUrl(bucket, darkKey), version);

        await prisma.fontFamily.update({
          where: { id },
          data: { previewImageUrl, previewImageDarkUrl, previewImageUpdatedAt: new Date() },
        });

        results.push({ id, ok: true, previewImageUrl, previewImageDarkUrl });
      } catch (error) {
        results.push({
          id,
          ok: false,
          error: error instanceof Error ? error.message : "Preview generation failed.",
        });
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  // Generated previews changed the cached font records — advance the version.
  if (results.some((r) => r.ok)) {
    await bumpFontCatalogVersion();
  }

  return results;
}
