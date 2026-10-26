import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import { upsertEditorCustomFont } from "@/lib/editor/customFonts.server";
import { extractFontFaceInfo } from "@/lib/editor/fontName.server";
import prisma from "@/lib/prisma";
import { createLogger } from "@/lib/logging/logger";
import { attachRequestIdHeader, getRequestLogContext, resolveRequestId } from "@/lib/logging/request";
import { checkRateLimit, createRateLimitResponse, resolveRequestIp } from "@/lib/security/rateLimit.server";
import { verifyCanvaImportToken } from "@/lib/tools/canvaImportAuth";
import { createImportedTemplate } from "@/lib/tools/canvaImportTemplate";
import {
  mapCapcutDraftToFabric,
  normalizeCapcutFontKey,
  readCapcutPackage,
} from "@/lib/tools/capcutDraft";
import { loadCapcutFonts } from "@/lib/tools/capcutFonts.server";
import {
  animatedGifInfo,
  capcutEffectOverlayWebp,
  capcutStickerWebp,
  cropCapcutImage,
  maskCapcutImage,
  videoPosterFrame,
} from "@/lib/tools/capcutMedia.server";
import { sanitizeImportPayloadAssets } from "@/lib/tools/importAssetSanitizer";
import {
  buildImportMetadata,
  buildLayerTreeFromFabricObjects,
  deriveLayerStatsFromFabricObjects,
} from "@/lib/tools/importParity";

// CapCut templates through the same Chrome extension and import token as Canva. The extension
// sends the editor's get_package_info response as-is; the mapping lives in capcutDraft.js.
export const runtime = "nodejs";
export const maxDuration = 120;
const logger = createLogger("api.tools.capcut-import");

const IMPORT_IP_LIMIT = { limit: 60, windowMs: 60_000 };
const IMPORT_USER_LIMIT = { limit: 12, windowMs: 60_000 };
const MEDIA_FETCH_TIMEOUT_MS = 60_000;
const MEDIA_FETCH_CONCURRENCY = 4;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Private-Network": "true",
};

function withCors(response) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

// The extension's shared uploader sends a multipart body whose `payload` field holds the JSON;
// its tab-bridge fallback sends the same JSON as the whole body.
async function readBody(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const manifest = formData.get("payload");
    if (typeof manifest !== "string" || !manifest) throw new Error("Missing multipart payload.");
    return JSON.parse(manifest);
  }
  return request.json();
}

function getToken(request, body) {
  const auth = String(request.headers.get("authorization") || "");
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return String(body?.token || "").trim();
}

/**
 * CapCut's media CDN answers every download as `application/x-www-form-urlencoded`, so the import
 * sanitizer would file a clip as an image. Fetch here with the type from the filer list and hand
 * the sanitizer a data URI that says what the bytes are.
 */
async function fetchCapcutMedia(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error("empty response");
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

function mimeTypeFor(object) {
  const declared = String(object.capcutMimeType || "").toLowerCase();
  if (/^(image|video)\//.test(declared)) return declared;
  return object.type === "video" ? "video/mp4" : "image/png";
}

async function inlineCapcutMedia(objects, warnings) {
  const media = objects.filter((object) => (object.type === "image" || object.type === "video") && object.src);
  const bySource = new Map();
  media.forEach((object) => {
    if (!bySource.has(object.src)) bySource.set(object.src, mimeTypeFor(object));
  });
  const downloaded = new Map();
  const sources = [...bySource.entries()];
  for (let index = 0; index < sources.length; index += MEDIA_FETCH_CONCURRENCY) {
    await Promise.all(
      sources.slice(index, index + MEDIA_FETCH_CONCURRENCY).map(async ([url, mimeType]) => {
        try {
          downloaded.set(url, await fetchCapcutMedia(url));
        } catch (error) {
          warnings.push(`A CapCut ${mimeType.split("/")[0]} could not be downloaded (${error?.message || "error"}).`);
        }
      })
    );
  }
  // One data URI per (file, crop, mask): the same photo can be cut differently on two layers.
  const dataUris = new Map();
  const kept = [];
  for (const object of objects) {
    const {
      capcutMimeType: _mime,
      capcutCrop: crop,
      capcutMask: mask,
      capcutAnimated: animated,
      capcutStickerPackage: stickerPackage,
      capcutEffectOverlay: effectOverlay,
      ...rest
    } = object;
    if (effectOverlay) {
      // A CapCut overlay effect (the veil): its package's alpha-packed clip, baked to an animated
      // WebP and stretched back over the canvas box the mapper gave the layer.
      try {
        const overlay = await capcutEffectOverlayWebp(await fetchCapcutMedia(effectOverlay.packageUrl), effectOverlay);
        kept.push({
          ...rest,
          src: `data:image/webp;base64,${overlay.bytes.toString("base64")}`,
          width: overlay.width,
          height: overlay.height,
          sourceWidth: overlay.width,
          sourceHeight: overlay.height,
          scaleX: (rest.width * rest.scaleX) / overlay.width,
          scaleY: (rest.height * rest.scaleY) / overlay.height,
          animatedImage: { kind: "gif", frameCount: overlay.frameCount, durationMs: overlay.durationMs, loop: true },
          posterSrc: `data:image/png;base64,${overlay.poster.toString("base64")}`,
          ...(overlay.blendMode ? { blendMode: overlay.blendMode } : {}),
        });
      } catch (error) {
        warnings.push(`CapCut effect "${object.layerName}" could not be rebuilt (${error?.message || "error"}) and was skipped.`);
      }
      continue;
    }
    if (object.type !== "image" && object.type !== "video") {
      kept.push(rest);
      continue;
    }
    const bytes = downloaded.get(object.src);
    if (!bytes) continue;
    const key = `${object.src}#${JSON.stringify(crop || null)}#${JSON.stringify(mask || null)}`;
    if (!dataUris.has(key)) {
      let mimeType = bySource.get(object.src);
      let output = bytes;
      if (crop) {
        try {
          output = await cropCapcutImage(output, crop);
          mimeType = "image/png";
        } catch (error) {
          warnings.push(`CapCut crop on "${object.layerName}" could not be applied (${error?.message || "error"}); the full image was imported.`);
        }
      }
      if (mask) {
        try {
          output = await maskCapcutImage(output, mask);
          mimeType = "image/png";
        } catch (error) {
          warnings.push(`CapCut mask on "${object.layerName}" could not be applied (${error?.message || "error"}).`);
        }
      }
      dataUris.set(key, `data:${mimeType};base64,${output.toString("base64")}`);
    }
    if (animated) {
      // A CapCut sticker becomes the editor's animated sticker: preferably the WebP rebuilt from
      // its sprite sheet (soft alpha), else its GIF preview; the first frame is the poster for
      // thumbnails and clients that cannot play it.
      if (stickerPackage) {
        try {
          const sticker = await capcutStickerWebp(await fetchCapcutMedia(stickerPackage));
          kept.push({
            ...rest,
            src: `data:image/webp;base64,${sticker.bytes.toString("base64")}`,
            width: sticker.width,
            height: sticker.height,
            sourceWidth: sticker.width,
            sourceHeight: sticker.height,
            animatedImage: { kind: "gif", frameCount: sticker.frameCount, durationMs: sticker.durationMs, loop: true },
            posterSrc: `data:image/png;base64,${sticker.poster.toString("base64")}`,
          });
          continue;
        } catch (error) {
          warnings.push(`CapCut sticker "${object.layerName}" kept its GIF preview (${error?.message || "sprite sheet unreadable"}).`);
        }
      }
      try {
        const gif = await animatedGifInfo(bytes);
        kept.push({
          ...rest,
          src: dataUris.get(key),
          ...(gif.frameCount > 1
            ? { animatedImage: { kind: "gif", frameCount: gif.frameCount, durationMs: gif.durationMs, loop: gif.loop } }
            : {}),
          posterSrc: `data:image/png;base64,${gif.poster.toString("base64")}`,
        });
      } catch (error) {
        warnings.push(`CapCut sticker "${object.layerName}" could not be read (${error?.message || "error"}).`);
      }
      continue;
    }
    if (object.type === "video") {
      // The clip's first frame stands in until the video decodes (no black flash at the cut).
      try {
        const poster = await videoPosterFrame(bytes, object.videoStart);
        kept.push({ ...rest, src: dataUris.get(key), posterSrc: `data:image/jpeg;base64,${poster.toString("base64")}` });
        continue;
      } catch (error) {
        warnings.push(`No poster frame for a CapCut video (${error?.message || "error"}); it may flash black while loading.`);
      }
    }
    kept.push({ ...rest, src: dataUris.get(key) });
  }
  return kept;
}

/**
 * Add CapCut's own font files to the font library — the families it lacks, and the cuts it lacks
 * of families it has (Playfair Display's real italic instead of a slanted upright) — the way the
 * Canva import does: named from the file, merged into an existing family, never replacing one.
 * Each text then names the stored family and the file's weight/style. Returns how many fonts or
 * cuts were added and are mobile-ready.
 */
async function registerCapcutFonts(objects, fontFiles, warnings) {
  const texts = objects.filter((object) => object.type === "textbox" && fontFiles.has(object.capcutFontId));
  const byFont = new Map();
  for (const object of texts) {
    const list = byFont.get(object.capcutFontId) || [];
    list.push(object);
    byFont.set(object.capcutFontId, list);
  }
  let imported = 0;
  for (const [fontId, layers] of byFont) {
    const file = fontFiles.get(fontId);
    const info = extractFontFaceInfo(file.bytes);
    const guessedFamily = layers[0].fontFamily;
    const family = String(info?.family || guessedFamily || "").trim();
    if (!family) continue;
    const fontWeight = info?.weightClass || layers[0].fontWeight || 400;
    const fontStyle = info?.italic ? "italic" : layers[0].fontStyle || "normal";
    const mimeType = /\.otf$/i.test(file.fileName) ? "font/otf" : "font/ttf";
    const sample = layers.map((layer) => layer.text).join(" ");
    try {
      const result = await upsertEditorCustomFont({
        family,
        dataUrl: `data:${mimeType};base64,${file.bytes.toString("base64")}`,
        mimeType,
        fileName: file.fileName,
        fontWeight,
        fontStyle,
        categories: ["EXCLUSIVE", /[\u0600-\u06FF]/.test(sample) ? "ARABIC" : "ENGLISH"],
        // The name the draft's file name suggested keeps resolving to the stored family.
        aliases:
          layers[0].capcutFontGuessed && normalizeCapcutFontKey(guessedFamily) !== normalizeCapcutFontKey(family)
            ? [guessedFamily]
            : [],
        mergeCuts: true,
        includeFontList: false,
      });
      const storedFamily = String(result?.font?.family || family).trim();
      for (const layer of layers) {
        layer.fontFamily = storedFamily;
        layer.fontWeight = fontWeight;
        layer.fontStyle = fontStyle;
      }
      if (result?.skippedDuplicate) continue;
      const status = String(result?.conversionStatus || result?.font?.conversionStatus || "").toLowerCase();
      if (status === "ready") imported += 1;
      else if (status) warnings.push(`Font "${storedFamily}" was added but is not mobile-ready yet${result?.font?.conversionError ? `: ${result.font.conversionError}` : ""}.`);
    } catch (error) {
      warnings.push(`Could not add CapCut font "${family}" to the library (${error?.message || "error"}).`);
    }
  }
  return imported;
}

/** Point every text layer at the library's spelling of its font; report the ones we lack. */
async function resolveCapcutFonts(objects, warnings) {
  const texts = objects.filter((object) => object.type === "textbox");
  const keys = [...new Set(texts.map((object) => normalizeCapcutFontKey(object.fontFamily)).filter(Boolean))];
  if (keys.length === 0) return;
  const [families, aliases] = await Promise.all([
    prisma.fontFamily.findMany({ where: { normalizedFamily: { in: keys } }, select: { family: true, normalizedFamily: true } }),
    prisma.fontAlias.findMany({ where: { normalizedAlias: { in: keys } }, select: { normalizedAlias: true, font: { select: { family: true } } } }),
  ]);
  const byKey = new Map();
  aliases.forEach((alias) => byKey.set(alias.normalizedAlias, alias.font.family));
  families.forEach((font) => byKey.set(font.normalizedFamily, font.family));
  const missing = new Set();
  for (const object of texts) {
    const stored = byKey.get(normalizeCapcutFontKey(object.fontFamily));
    if (stored) object.fontFamily = stored;
    else missing.add(object.fontFamily);
    delete object.capcutFontFile;
    delete object.capcutFontId;
    delete object.capcutFontGuessed;
  }
  if (missing.size > 0) {
    warnings.push(`Fonts not in the library yet (layers fall back): ${[...missing].join(", ")}.`);
  }
}

function previewDataUri({ previewImageBase64 }) {
  const base64 = String(previewImageBase64 || "").replace(/^data:[^,]*,/, "").trim();
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return "";
  return `data:image/webp;base64,${base64}`;
}

export async function POST(request) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));
  const respond = (body, status) => attachRequestIdHeader(withCors(NextResponse.json(body, { status })), requestId);

  const ipLimit = checkRateLimit({
    scope: "api:tools:capcut-import:ip",
    identifier: resolveRequestIp(request),
    ...IMPORT_IP_LIMIT,
  });
  if (!ipLimit.allowed) {
    return attachRequestIdHeader(withCors(createRateLimitResponse("Too many import requests.", ipLimit)), requestId);
  }

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    requestLogger.warn("Invalid CapCut import body", { reason: String(error?.message || error) });
    return respond({ error: "Invalid request body." }, 400);
  }

  const verification = verifyCanvaImportToken(getToken(request, body));
  if (!verification.valid) {
    return respond({ error: "Unauthorized extension request.", details: verification.reason }, 401);
  }
  const userLimit = checkRateLimit({
    scope: "api:tools:capcut-import:user",
    identifier: verification.userId,
    ...IMPORT_USER_LIMIT,
  });
  if (!userLimit.allowed) {
    return attachRequestIdHeader(withCors(createRateLimitResponse("Too many imports for this account.", userLimit)), requestId);
  }

  try {
    const capcutPackage = readCapcutPackage(body?.packageInfo);
    // Development only: keep the last package the extension sent, to replay an import locally
    // (`curl` it back with a fresh token) — a capcut.com page cannot post to localhost itself.
    if (process.env.NODE_ENV !== "production") {
      void writeFile(path.join(tmpdir(), "nayroz-capcut-last-package.json"), JSON.stringify(body?.packageInfo || null)).catch(() => undefined);
    }
    if (!capcutPackage.draft) {
      return respond({ error: "Invalid CapCut payload.", details: "The package has no draft." }, 400);
    }
    // CapCut sizes text by its own font files' line boxes; read them before mapping.
    const fonts = await loadCapcutFonts({ draft: capcutPackage.draft, materialList: capcutPackage.materialList });
    const mapped = mapCapcutDraftToFabric({
      draft: capcutPackage.draft,
      filerAssets: capcutPackage.filerAssets,
      fontLineBoxes: fonts.lineBoxes,
      fontMeasures: fonts.measures,
      materialList: capcutPackage.materialList,
    });
    const warnings = [...mapped.warnings];
    if (fonts.failures.length > 0) {
      warnings.push(`CapCut font files unreadable, text sized with a default line box: ${fonts.failures.join(", ")}.`);
    }
    const importedCustomFonts = await registerCapcutFonts(mapped.objects, fonts.files, warnings);
    await resolveCapcutFonts(mapped.objects, warnings);
    const objects = await inlineCapcutMedia(mapped.objects, warnings);
    if (objects.length === 0) {
      return respond({ error: "Nothing to import.", details: "No text, image or video layer could be read.", warnings }, 422);
    }

    const sanitized = await sanitizeImportPayloadAssets({
      ownerId: verification.userId,
      imageDataUrl: "",
      thumbnailDataUrl: previewDataUri(capcutPackage),
      fabricData: { version: "7.0.0", backgroundColor: "#000000", objects },
      sourceLabel: "capcut-extension",
      preserveSvg: false,
      traceRasterToSvg: false,
      convertPngToWebp: true,
      rewriteExternalUrls: true,
    });
    if (Array.isArray(sanitized.warnings)) warnings.push(...sanitized.warnings);
    const fabricData = sanitized.fabricData;
    const fabricObjects = fabricData.objects;

    const page = {
      id: "capcut-page-1",
      name: "CapCut Page 1",
      width: mapped.canvasWidth,
      height: mapped.canvasHeight,
      sourceWidth: mapped.canvasWidth,
      sourceHeight: mapped.canvasHeight,
      ...(mapped.durationMs > 0 ? { durationMs: mapped.durationMs } : {}),
    };
    const importMetadata = buildImportMetadata(
      {
        source: "capcut-extension",
        importVersion: 2,
        page,
        layerTree: buildLayerTreeFromFabricObjects(fabricObjects),
        layerStats: deriveLayerStatsFromFabricObjects(fabricObjects),
        usedFonts: [...new Set(fabricObjects.filter((o) => o.type === "textbox").map((o) => o.fontFamily))],
        warnings: [...new Set(warnings)],
        assetManifest: sanitized.assetManifest,
        provenance: { source: "capcut", via: "extension", layers: true },
      },
      { page: { width: mapped.canvasWidth, height: mapped.canvasHeight } }
    );

    const name = String(body?.name || "").trim() || String(body?.title || "").trim() || mapped.name || "CapCut template";
    const template = await createImportedTemplate({
      ownerId: verification.userId,
      thumbnailDataUrl: sanitized.thumbnailDataUrl,
      fabricData,
      name,
      slug: String(body?.slug || "").trim(),
      canvasWidth: mapped.canvasWidth,
      canvasHeight: mapped.canvasHeight,
      sourceWidth: mapped.canvasWidth,
      sourceHeight: mapped.canvasHeight,
      tags: [],
      action: "import-capcut-extension",
      importMetadata,
    });

    requestLogger.info("CapCut template imported", {
      templateId: String(template?.id || ""),
      layerCount: fabricObjects.length,
      warningsCount: importMetadata.warnings?.length || 0,
    });
    return respond(
      {
        message: "CapCut template imported from Chrome extension.",
        template,
        layerCount: fabricObjects.length,
        usedFonts: importMetadata.usedFonts,
        warnings: importMetadata.warnings,
        importedCustomFonts,
      },
      201
    );
  } catch (error) {
    requestLogger.error("CapCut import failed", {}, error);
    return respond({ error: "Failed to import CapCut template.", details: error?.message || "Unknown error." }, 422);
  }
}
