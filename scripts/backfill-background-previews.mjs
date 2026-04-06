#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";

import {
  createBackgroundPreview,
  downloadRemoteAsset,
  uploadBackgroundPreviewToStorage,
} from "../src/lib/editor/backgroundPreview.server.js";

function loadLocalEnv() {
  const envFiles = [".env", ".env.local"];
  for (const filename of envFiles) {
    const fullPath = path.join(process.cwd(), filename);
    try {
      const raw = readFileSync(fullPath, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] == null) {
          process.env[key] = value;
        }
      }
    } catch (_error) {
      // Ignore missing env files.
    }
  }
}

function parseArgs(argv) {
  const options = {
    limit: 0,
    force: false,
    source: "all",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--limit" && next) {
      options.limit = Math.max(0, Number.parseInt(next, 10) || 0);
      index += 1;
    } else if (arg === "--source" && next) {
      options.source = String(next || "").trim().toLowerCase() || "all";
      index += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  node scripts/backfill-background-previews.mjs [options]",
          "",
          "Options:",
          "  --limit <n>      Process at most n backgrounds.",
          "  --source <name>  Restrict to one background source (default: all).",
          "  --force          Rebuild previews even when thumbnailUrl already differs from assetUrl.",
          "  --help           Show this help.",
        ].join("\n")
      );
      process.exit(0);
    }
  }

  return options;
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const params = [];
    const nextParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const clauses = [];
    if (!options.force) {
      clauses.push("(COALESCE(NULLIF(TRIM(thumbnail_url), ''), asset_url) = asset_url)");
    }
    if (options.source && options.source !== "all") {
      clauses.push(`source = ${nextParam(options.source)}`);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitSql = options.limit > 0 ? `LIMIT ${nextParam(options.limit)}` : "";

    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT id, owner_id, source, source_asset_id, asset_url, thumbnail_url
        FROM editor_background_assets
        ${whereSql}
        ORDER BY updated_at DESC
        ${limitSql}
      `,
      ...params
    );

    const items = Array.isArray(rows) ? rows : [];
    console.log(`Found ${items.length} background(s) to process.`);

    let updated = 0;
    let unchanged = 0;
    let failed = 0;

    for (let index = 0; index < items.length; index += 1) {
      const row = items[index] || {};
      const id = String(row.id || "").trim();
      const ownerId = String(row.owner_id || "").trim();
      const sourceAssetId = String(row.source_asset_id || row.id || "").trim();
      const assetUrl = String(row.asset_url || "").trim();

      if (!id || !assetUrl) {
        failed += 1;
        console.log(`[${index + 1}/${items.length}] Skipped invalid row.`);
        continue;
      }

      try {
        const downloaded = await downloadRemoteAsset(assetUrl);
        const preview = await createBackgroundPreview({
          bytes: downloaded.bytes,
          mimeType: downloaded.mimeType,
        });

        if (!preview.generated) {
          unchanged += 1;
          console.log(`[${index + 1}/${items.length}] ${sourceAssetId}: original already suitable for preview.`);
          continue;
        }

        const previewUrl = await uploadBackgroundPreviewToStorage({
          ownerId,
          sourceAssetId,
          bytes: preview.bytes,
          mimeType: preview.mimeType,
        });

        await prisma.$executeRaw`
          UPDATE editor_background_assets
          SET thumbnail_url = ${previewUrl}, updated_at = NOW()
          WHERE id = ${id}::uuid
        `;

        updated += 1;
        console.log(`[${index + 1}/${items.length}] ${sourceAssetId}: preview updated.`);
      } catch (error) {
        failed += 1;
        console.log(
          `[${index + 1}/${items.length}] ${sourceAssetId}: failed - ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    }

    console.log(`Done. Updated: ${updated}, unchanged: ${unchanged}, failed: ${failed}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
