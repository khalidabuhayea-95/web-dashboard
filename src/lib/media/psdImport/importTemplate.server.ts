import { randomUUID } from "node:crypto";

import { getPublicStorageBucketName, uploadObject } from "@/lib/storage/objectStorage.server";
import { createImportedTemplate } from "@/lib/tools/canvaImportTemplate";
import { createLogger } from "@/lib/logging/logger";

import { convertPsdToMobileProject } from "./convertPsd.server";
import { resolvePsdFontStatus } from "./fontStatus.server";

const logger = createLogger("media.psd-import.template");

function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ""));
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const raw = match[3] || "";
  try {
    const bytes = isBase64 ? Buffer.from(raw, "base64") : Buffer.from(decodeURIComponent(raw), "utf8");
    return bytes.length ? { mime, bytes } : null;
  } catch {
    return null;
  }
}

function extFromMime(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "png";
}

// Run async work with a concurrency cap; preserves input order.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export type PsdImportResult = {
  id: string;
  slug: string;
  name: string;
  layerCount: number;
  uploadedAssets: number;
  // Font families used by the template that are NOT in the catalog — these will
  // render with a fallback font until added.
  missingFonts: string[];
};

// Convert a PSD and persist it as a draft template — the same DB write path the
// Canva extension uses (createImportedTemplate → template + revision). Unlike the
// Canva flow (which inlines image data URLs, capped at 30MB), raster layers are
// uploaded to object storage and referenced by URL, so the stored `data` stays
// small and complex multi-layer PSDs don't blow the inline-payload cap.
export async function importPsdAsTemplate({
  ownerId,
  buffer,
  name,
}: {
  ownerId: string;
  buffer: Buffer;
  name?: string;
}): Promise<PsdImportResult> {
  if (!ownerId) throw new Error("Missing owner id.");

  const result = await convertPsdToMobileProject(buffer, { name });
  const objects = Array.isArray(result.fabricData?.objects) ? result.fabricData.objects : [];
  if (objects.length === 0) {
    throw new Error("No layers were extracted from the PSD, so there is nothing to import.");
  }

  const bucket = getPublicStorageBucketName();
  const assetFolder = randomUUID();
  let uploadedAssets = 0;

  const uploadedObjects = await mapWithConcurrency(objects, 5, async (object, index) => {
    const src = typeof object?.src === "string" ? object.src : "";
    if (!src.startsWith("data:image/")) return object;
    const parsed = parseDataUrl(src);
    if (!parsed) return object;
    const key = [
      "users",
      String(ownerId),
      "templates",
      "psd",
      assetFolder,
      `layer-${String(index).padStart(3, "0")}.${extFromMime(parsed.mime)}`,
    ].join("/");
    const uploaded = await uploadObject({
      bucket,
      key,
      body: parsed.bytes,
      contentType: parsed.mime || "image/png",
      upsert: false,
      cacheControl: "public, max-age=31536000, immutable",
      skipExistenceCheck: true,
    });
    const url = String(uploaded?.url || "").trim();
    if (!url) return object;
    uploadedAssets += 1;
    return { ...object, src: url };
  });

  const fabricData = {
    version: result.fabricData?.version || "7.0.0",
    background: result.fabricData?.background || { type: "color", color: "#FFFFFF" },
    objects: uploadedObjects,
  };

  const created = await createImportedTemplate({
    ownerId,
    fabricData,
    name: name || result.name,
    canvasWidth: result.docWidth,
    canvasHeight: result.docHeight,
    sourceWidth: result.docWidth,
    sourceHeight: result.docHeight,
    thumbnailDataUrl: result.composite || undefined,
    tags: ["psd", "imported"],
    action: "import-psd",
  });

  const fontStatus = await resolvePsdFontStatus(result.stats.fontsUsed);
  const missingFonts = fontStatus.filter((entry) => !entry.available).map((entry) => entry.name);

  logger.info("Imported PSD as template", {
    ownerId,
    templateId: created.id,
    slug: created.slug,
    layerCount: uploadedObjects.length,
    uploadedAssets,
    missingFonts: missingFonts.length,
  });

  return {
    id: created.id,
    slug: created.slug,
    name: created.name,
    layerCount: uploadedObjects.length,
    uploadedAssets,
    missingFonts,
  };
}
