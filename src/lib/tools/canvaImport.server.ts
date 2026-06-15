import path from "node:path";
import { spawn } from "node:child_process";

import prisma from "@/lib/prisma";
import { sanitizeImportPayloadAssets } from "@/lib/tools/importAssetSanitizer";
import { buildFabricData, createImportedTemplate } from "@/lib/tools/canvaImportTemplate";
import {
  attachImportMetadataToFabricData,
  buildImportMetadata,
  buildLayerTreeFromFabricObjects,
  deriveLayerStatsFromFabricObjects,
} from "@/lib/tools/importParity";
import { hydrateFabricRasterPalettes } from "@/lib/tools/rasterPalette.server";

// Framework-free Canva import logic. This module deliberately avoids any
// `next/*` imports so it can run inside the standalone import worker
// (see scripts/worker.ts) as well as the Next route handler that wraps it
// (src/app/api/tools/canva-import/route.ts).

function clampNumber(value: any, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isCanvaUrl(value: any): boolean {
  try {
    const parsed = new URL(String(value || "").trim());
    return /(\.|^)canva\.com$/i.test(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function parseTemplateId(output: string): string {
  const match = String(output || "").match(/Template ID:\s*([0-9a-f-]+)/i);
  return match?.[1] || "";
}

function titleToTemplateName(title: string): string {
  const source = String(title || "").trim();
  const cleaned = source
    .replace(/\s*\|\s*Canva\s*$/i, "")
    .replace(/\s*-\s*Canva\s*$/i, "")
    .trim();
  return cleaned || "Imported Canva Template";
}

function tail(text: string, maxLength = 2000): string {
  const value = String(text || "");
  if (value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMetaContent(html: string, key: string, expectedValue: string): string {
  const safeValue = escapeRegExp(expectedValue);
  const directPattern = new RegExp(
    `<meta[^>]*${key}=["']${safeValue}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const reversePattern = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${key}=["']${safeValue}["'][^>]*>`,
    "i"
  );
  return html.match(directPattern)?.[1] || html.match(reversePattern)?.[1] || "";
}

function extractDocumentTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return title.replace(/\s+/g, " ").trim();
}

interface ImageDimensions {
  width: number;
  height: number;
}

function getImageDimensions(buffer: Buffer): ImageDimensions | null {
  if (!buffer || buffer.length < 24) return null;

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 4 >= buffer.length) break;

      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (!segmentLength || segmentLength < 2) break;

      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isStartOfFrame && offset + 8 < buffer.length) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }

      offset += 2 + segmentLength;
    }
  }

  return null;
}

interface ImporterResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runImporter(options: {
  url: string;
  name?: string;
  slug?: string;
  ownerId: string;
  maxDimension: number;
  timeoutMs: number;
  interactiveBrowser: boolean;
}): Promise<ImporterResult> {
  const { url, name, slug, ownerId, maxDimension, timeoutMs, interactiveBrowser } = options;
  const scriptPath = path.join(process.cwd(), "scripts", "import-canva-template.mjs");
  const args = [
    scriptPath,
    "--url",
    url,
    "--owner-id",
    ownerId,
    "--no-prompt",
    "--timeout-ms",
    String(timeoutMs),
    "--retry-timeout-ms",
    String(Math.min(Math.max(Math.round(timeoutMs * 0.75), 30_000), 180_000)),
    "--max-dimension",
    String(maxDimension),
    "--profile-dir",
    path.join(process.cwd(), ".tmp", "canva-import-profile"),
  ];

  if (name) {
    args.push("--name", name);
  }
  if (slug) {
    args.push("--slug", slug);
  }
  if (!interactiveBrowser) {
    args.push("--headless");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error(tail(stderr || stdout || `Importer exited with code ${code}.`)));
    });
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function importFromPreviewScrape(options: {
  url: string;
  name?: string;
  slug?: string;
  ownerId: string;
  maxDimension: number;
  timeoutMs: number;
}): Promise<any> {
  const { url, name, slug, ownerId, maxDimension, timeoutMs } = options;

  const htmlResponse = await fetchWithTimeout(url, timeoutMs, {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });

  if (!htmlResponse.ok) {
    throw new Error(`Preview scrape failed with HTTP ${htmlResponse.status}.`);
  }

  const html = await htmlResponse.text();
  const pageTitle =
    extractMetaContent(html, "property", "og:title") ||
    extractMetaContent(html, "name", "twitter:title") ||
    extractDocumentTitle(html);
  const imageCandidate =
    extractMetaContent(html, "property", "og:image:secure_url") ||
    extractMetaContent(html, "property", "og:image") ||
    extractMetaContent(html, "name", "twitter:image");

  if (!imageCandidate) {
    throw new Error("Could not locate preview image in Canva page metadata.");
  }

  const imageUrl = new URL(imageCandidate, htmlResponse.url).toString();
  const imageResponse = await fetchWithTimeout(imageUrl, timeoutMs, {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  });
  if (!imageResponse.ok) {
    throw new Error(`Preview image request failed with HTTP ${imageResponse.status}.`);
  }

  const contentType = String(imageResponse.headers.get("content-type") || "image/png")
    .split(";")[0]
    .trim();
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const dimensions = getImageDimensions(imageBuffer);
  const sourceWidth = Math.max(1, Number(dimensions?.width || maxDimension));
  const sourceHeight = Math.max(1, Number(dimensions?.height || maxDimension));
  const downscale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvasWidth = Math.max(1, Math.round(sourceWidth * downscale));
  const canvasHeight = Math.max(1, Math.round(sourceHeight * downscale));
  const dataUrl = `data:${contentType};base64,${imageBuffer.toString("base64")}`;

  const requestedName = name || titleToTemplateName(pageTitle);
  const requestedSlug = String(slug || "").trim();
  const templateData = buildFabricData(
    dataUrl,
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight
  );

  const sanitizedPayload = await sanitizeImportPayloadAssets({
    ownerId,
    imageDataUrl: dataUrl,
    thumbnailDataUrl: dataUrl,
    fabricData: templateData,
    sourceLabel: "canva-preview-scrape",
    preserveSvg: false,
    traceRasterToSvg: false,
    rewriteExternalUrls: true,
  });

  const sanitizedFabricData = sanitizedPayload.fabricData;
  const rasterPaletteHydration = await hydrateFabricRasterPalettes(sanitizedFabricData, {
    maxColors: 6,
  });
  const sanitizedObjects = Array.isArray(sanitizedFabricData?.objects)
    ? sanitizedFabricData.objects
    : [];
  const importWarnings = Array.isArray(sanitizedPayload.warnings) ? [...sanitizedPayload.warnings] : [];
  if (rasterPaletteHydration.failedCount > 0) {
    importWarnings.push(
      `Raster palette extraction failed for ${rasterPaletteHydration.failedCount} imported Canva image layer${rasterPaletteHydration.failedCount === 1 ? "" : "s"}.`
    );
  }
  const importMetadata = buildImportMetadata(
    {
      source: "canva-preview-scrape",
      importVersion: 2,
      page: {
        id: "canva-page-1",
        name: "Canva Page 1",
        width: canvasWidth,
        height: canvasHeight,
        sourceWidth,
        sourceHeight,
      },
      layerTree: buildLayerTreeFromFabricObjects(sanitizedObjects),
      layerStats: deriveLayerStatsFromFabricObjects(sanitizedObjects),
      usedFonts: [],
      warnings: importWarnings,
      assetManifest: sanitizedPayload.assetManifest,
    },
    {
      page: {
        width: canvasWidth,
        height: canvasHeight,
      },
    }
  );

  return createImportedTemplate({
    ownerId,
    imageDataUrl: sanitizedPayload.imageDataUrl,
    thumbnailDataUrl: sanitizedPayload.thumbnailDataUrl,
    fabricData: sanitizedFabricData,
    editorData: undefined,
    name: requestedName,
    slug: requestedSlug,
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight,
    tags: ["canva", "imported", "preview"],
    action: "import-canva-preview",
    importMetadata,
  });
}

async function findTemplateForOwner(ownerId: string, templateId: string): Promise<any | null> {
  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) return null;
  if (String(template.ownerId || "") !== String(ownerId || "")) return null;
  return template;
}

async function rewriteImportedTemplateAssets(template: any): Promise<any> {
  if (!template || !template.id || !template.ownerId) return template;

  const sanitizedPayload = await sanitizeImportPayloadAssets({
    ownerId: template.ownerId,
    imageDataUrl: "",
    thumbnailDataUrl: String(template.thumbnailDataUrl || ""),
    fabricData: template.data,
    sourceLabel: "canva-playwright",
    preserveSvg: false,
    traceRasterToSvg: false,
    rewriteExternalUrls: true,
  });

  const nextFabricData = sanitizedPayload.fabricData || template.data;
  const rasterPaletteHydration = await hydrateFabricRasterPalettes(nextFabricData, {
    maxColors: 6,
  });
  const hasExistingImportMetadata =
    template?.data &&
    typeof template.data === "object" &&
    template.data.meta &&
    typeof template.data.meta === "object" &&
    template.data.meta.import &&
    typeof template.data.meta.import === "object";
  const existingImportMetadata = hasExistingImportMetadata ? template.data.meta.import : null;
  const canvasWidth = Math.max(1, Math.round(Number(template?.canvasSize?.width || 1080)));
  const canvasHeight = Math.max(1, Math.round(Number(template?.canvasSize?.height || 1080)));
  const objects = Array.isArray(nextFabricData?.objects) ? nextFabricData.objects : [];
  const importWarnings =
    Array.isArray(existingImportMetadata?.warnings) && existingImportMetadata.warnings.length > 0
      ? [...existingImportMetadata.warnings]
      : [];
  if (rasterPaletteHydration.failedCount > 0) {
    importWarnings.push(
      `Raster palette extraction failed for ${rasterPaletteHydration.failedCount} imported Canva image layer${rasterPaletteHydration.failedCount === 1 ? "" : "s"}.`
    );
  }
  const importMetadata = buildImportMetadata(
    {
      source: existingImportMetadata?.source || "canva-playwright",
      importVersion: existingImportMetadata?.importVersion || 2,
      page: {
        id: existingImportMetadata?.page?.id || "canva-page-1",
        name: existingImportMetadata?.page?.name || "Canva Page 1",
        width: canvasWidth,
        height: canvasHeight,
        sourceWidth: Math.max(
          1,
          Math.round(Number(existingImportMetadata?.page?.sourceWidth || canvasWidth))
        ),
        sourceHeight: Math.max(
          1,
          Math.round(Number(existingImportMetadata?.page?.sourceHeight || canvasHeight))
        ),
      },
      layerTree:
        Array.isArray(existingImportMetadata?.layerTree) &&
        existingImportMetadata.layerTree.length > 0
          ? existingImportMetadata.layerTree
          : buildLayerTreeFromFabricObjects(objects),
      layerStats: existingImportMetadata?.layerStats || deriveLayerStatsFromFabricObjects(objects),
      usedFonts:
        Array.isArray(existingImportMetadata?.usedFonts) && existingImportMetadata.usedFonts.length > 0
          ? existingImportMetadata.usedFonts
          : [],
      warnings: importWarnings,
      assetManifest: sanitizedPayload.assetManifest,
    },
    {
      page: {
        width: canvasWidth,
        height: canvasHeight,
      },
    }
  );
  const nextData = attachImportMetadataToFabricData(nextFabricData, importMetadata);

  const dataChanged = JSON.stringify(nextData) !== JSON.stringify(template.data);
  const thumbnailChanged =
    String(sanitizedPayload.thumbnailDataUrl || "") !== String(template.thumbnailDataUrl || "");
  if (!dataChanged && !thumbnailChanged) return template;

  return prisma.template.update({
    where: { id: template.id },
    data: {
      data: nextData,
      thumbnailDataUrl: sanitizedPayload.thumbnailDataUrl || template.thumbnailDataUrl || null,
    },
  });
}

interface ImportResult {
  status: number;
  payload: any;
}

type TemplateProducedHook = (templateId: string) => Promise<void> | void;

// Fire the "a template now exists for this job" hook as soon as a template row
// is created — before the most failure-prone steps (asset rewrite, verification)
// run — so a crash/timeout mid-run is recoverable without producing a duplicate.
async function reportTemplateProduced(
  hook: TemplateProducedHook | undefined,
  templateId: string
): Promise<void> {
  if (typeof hook !== "function") return;
  const id = String(templateId || "").trim();
  if (!id) return;
  try {
    await hook(id);
  } catch (_error) {
    // Best-effort: recording the produced template id must never fail the import.
  }
}

function dedupePayload(template: any): ImportResult {
  const importMeta = template?.data?.meta?.import;
  return {
    status: 200,
    payload: {
      message: "Canva URL import already completed (deduplicated retry).",
      template,
      source: "dedupe",
      fidelity: "legacy-low",
      importVersion: importMeta?.importVersion || null,
      layerStats: importMeta?.layerStats || null,
      warnings: Array.isArray(importMeta?.warnings) ? [...importMeta.warnings] : [],
    },
  };
}

export async function runCanvaImportForOwner(options: {
  ownerId: string;
  url: string;
  name?: string;
  slug?: string;
  maxDimension?: number;
  timeoutMs?: number;
  interactiveBrowser?: boolean;
  // Dedupe hooks used when this import runs as a retriable background job.
  // `existingTemplateId` is the template a prior attempt of the SAME job
  // already produced; `onTemplateProduced` records the template id the moment
  // it is created so a later retry can short-circuit instead of duplicating.
  existingTemplateId?: string;
  onTemplateProduced?: TemplateProducedHook;
}): Promise<ImportResult> {
  const {
    ownerId,
    url,
    name = "",
    slug = "",
    maxDimension = 1920,
    timeoutMs = 180_000,
    interactiveBrowser = false,
    existingTemplateId = "",
    onTemplateProduced,
  } = options;

  const safeOwnerId = String(ownerId || "").trim();
  const safeUrl = String(url || "").trim();
  const safeName = String(name || "").trim();
  const safeSlug = String(slug || "").trim();
  const safeMaxDimension = clampNumber(maxDimension, 1920, 320, 4096);
  const safeTimeoutMs = clampNumber(timeoutMs, 180_000, 15_000, 300_000);
  const safeInteractiveBrowser = interactiveBrowser === true;

  if (!safeOwnerId) {
    const error = new Error("Missing import owner.");
    (error as any).status = 400;
    throw error;
  }
  if (!safeUrl) {
    const error = new Error("Canva URL is required.");
    (error as any).status = 400;
    throw error;
  }
  if (!isCanvaUrl(safeUrl)) {
    const error = new Error("Expected a valid canva.com URL.");
    (error as any).status = 400;
    throw error;
  }

  // Retry-safety: if a previous attempt of this job already created a template
  // (and the user hasn't since deleted it), reuse it instead of importing again.
  const safeExistingTemplateId = String(existingTemplateId || "").trim();
  if (safeExistingTemplateId) {
    const alreadyImported = await findTemplateForOwner(safeOwnerId, safeExistingTemplateId);
    if (alreadyImported) {
      return dedupePayload(alreadyImported);
    }
  }

  let importerFailure = "";

  try {
    const output = await runImporter({
      url: safeUrl,
      name: safeName,
      slug: safeSlug,
      ownerId: safeOwnerId,
      maxDimension: safeMaxDimension,
      timeoutMs: safeTimeoutMs,
      interactiveBrowser: safeInteractiveBrowser,
    });

    const templateId = parseTemplateId(output.stdout);
    if (!templateId) {
      throw new Error("Import completed but template id was not found in importer output.");
    }

    let template = await findTemplateForOwner(safeOwnerId, templateId);
    if (!template) {
      throw new Error("Imported template not found.");
    }
    // Record the produced template before the failure-prone rewrite step.
    await reportTemplateProduced(onTemplateProduced, template.id);
    let rewriteWarning = "";
    try {
      template = await rewriteImportedTemplateAssets(template);
    } catch (assetRewriteError: any) {
      rewriteWarning = `Imported template asset rewrite failed: ${assetRewriteError?.message || "unknown error"}`;
    }
    const importMeta = template?.data?.meta?.import;
    const warnings = Array.isArray(importMeta?.warnings) ? [...importMeta.warnings] : [];
    if (rewriteWarning) warnings.push(rewriteWarning);

    return {
      status: 200,
      payload: {
        message: "Canva URL import completed (legacy low-fidelity mode).",
        template,
        source: "playwright",
        fidelity: "legacy-low",
        importVersion: importMeta?.importVersion || null,
        layerStats: importMeta?.layerStats || null,
        warnings,
      },
    };
  } catch (error: any) {
    importerFailure = error?.message || "Unknown importer error.";
  }

  try {
    const template = await importFromPreviewScrape({
      url: safeUrl,
      name: safeName,
      slug: safeSlug,
      ownerId: safeOwnerId,
      maxDimension: safeMaxDimension,
      timeoutMs: safeTimeoutMs,
    });

    // Record the produced template before the verification round-trip.
    await reportTemplateProduced(onTemplateProduced, template?.id);

    const verifiedTemplate = await findTemplateForOwner(safeOwnerId, template.id);
    if (!verifiedTemplate) {
      throw new Error("Imported template not found.");
    }

    return {
      status: 201,
      payload: {
        message: "Canva preview import completed (legacy low-fidelity mode).",
        template: verifiedTemplate,
        source: "preview-scrape",
        fidelity: "legacy-low",
        importVersion: verifiedTemplate?.data?.meta?.import?.importVersion || null,
        layerStats: verifiedTemplate?.data?.meta?.import?.layerStats || null,
        warnings: verifiedTemplate?.data?.meta?.import?.warnings || [],
        importerWarning: importerFailure || undefined,
      },
    };
  } catch (fallbackError: any) {
    const detailParts = [];
    if (importerFailure) {
      detailParts.push(`Playwright import: ${importerFailure}`);
    }
    detailParts.push(`Preview scrape: ${fallbackError?.message || "Unknown error."}`);

    const error = new Error("Failed to import Canva template.");
    (error as any).status = 422;
    (error as any).payload = {
      error: "Failed to import Canva template.",
      details: detailParts.join(" | "),
    };
    throw error;
  }
}
