#!/usr/bin/env node
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/import-canva-template.mjs --url <canva-edit-url> [options]",
      "",
      "Options:",
      "  --url <url>            Canva design URL (required).",
      "  --name <name>          Template name override.",
      "  --slug <slug>          Template slug override.",
      "  --owner-id <uuid>      Owner user id in templates table (default: latest template owner).",
      "  --profile-dir <path>   Playwright persistent profile directory.",
      "  --headless             Run browser headless (default: headed).",
      "  --no-prompt            Do not prompt in terminal; wait using retry timeout instead.",
      "  --retry-timeout-ms <ms> Extra wait if canvas is not found (default: 120000).",
      "  --timeout-ms <ms>      Wait timeout for Canva editor (default: 180000).",
      "  --max-dimension <px>   Max imported canvas side (default: 1920, keeps ratio).",
      "  --snapshot-path <path> Save captured PNG to disk for inspection.",
      "  --help                 Show this help.",
      "",
      "Notes:",
      "  - First run will likely require login in the opened browser profile.",
      "  - Import is flattened as a single image layer (best-effort scraping).",
    ].join("\n")
  );
}

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
    url: "",
    name: "",
    slug: "",
    ownerId: "",
    profileDir: path.join(process.cwd(), ".tmp", "canva-import-profile"),
    headless: false,
    noPrompt: false,
    timeoutMs: 180_000,
    retryTimeoutMs: 120_000,
    maxDimension: 1_920,
    snapshotPath: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--url" && next) {
      options.url = next;
      i += 1;
    } else if (arg === "--name" && next) {
      options.name = next;
      i += 1;
    } else if (arg === "--slug" && next) {
      options.slug = next;
      i += 1;
    } else if (arg === "--owner-id" && next) {
      options.ownerId = next;
      i += 1;
    } else if (arg === "--profile-dir" && next) {
      options.profileDir = path.resolve(next);
      i += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number(next) || options.timeoutMs;
      i += 1;
    } else if (arg === "--retry-timeout-ms" && next) {
      options.retryTimeoutMs = Number(next) || options.retryTimeoutMs;
      i += 1;
    } else if (arg === "--max-dimension" && next) {
      options.maxDimension = Number(next) || options.maxDimension;
      i += 1;
    } else if (arg === "--snapshot-path" && next) {
      options.snapshotPath = path.resolve(next);
      i += 1;
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--no-prompt") {
      options.noPrompt = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
  }

  return options;
}

function normalizeCanvaUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_error) {
    throw new Error("Invalid --url value.");
  }

  if (!/(\.|^)canva\.com$/i.test(parsed.hostname)) {
    throw new Error("Expected a Canva URL (canva.com).");
  }

  return parsed.toString();
}

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function titleToTemplateName(title) {
  const source = String(title || "").trim();
  const cleaned = source
    .replace(/\s*\|\s*Canva\s*$/i, "")
    .replace(/\s*-\s*Canva\s*$/i, "")
    .trim();
  return cleaned || "Imported Canva Template";
}

async function ensureUniqueSlug(prisma, requestedSlug) {
  const base = normalizeSlug(requestedSlug) || `canva-import-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (true) {
    const existing = await prisma.template.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    counter += 1;
    candidate = `${base}-${counter}`;
  }
}

async function ensureUniqueName(prisma, ownerId, requestedName) {
  const base = String(requestedName || "").trim() || `Imported Canva Template ${new Date().toISOString().slice(0, 10)}`;
  let candidate = base;
  let counter = 1;

  while (true) {
    const existing = await prisma.template.findFirst({
      where: { ownerId, name: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    counter += 1;
    candidate = `${base} (${counter})`;
  }
}

async function resolveOwnerId(prisma, explicitOwnerId) {
  if (explicitOwnerId) return explicitOwnerId;
  const latest = await prisma.template.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { ownerId: true },
  });
  if (!latest?.ownerId) {
    throw new Error("Unable to infer owner id. Pass --owner-id <uuid>.");
  }
  return latest.ownerId;
}

async function waitForManualContinue(message) {
  if (!process.stdin.isTTY) {
    throw new Error(`${message} Cannot prompt in non-interactive mode.`);
  }
  return new Promise((resolve) => {
    process.stdout.write(`${message}\nPress Enter to continue... `);
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function getLargestCanvasCapture(page) {
  const canvases = page.locator("canvas");
  const count = await canvases.count();
  if (count === 0) return null;

  let best = null;
  for (let i = 0; i < count; i += 1) {
    const node = canvases.nth(i);
    const box = await node.boundingBox();
    if (!box || box.width < 60 || box.height < 60) continue;
    const area = box.width * box.height;
    if (!best || area > best.area) {
      const meta = await node.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          cssWidth: Math.round(rect.width),
          cssHeight: Math.round(rect.height),
          pixelWidth: Number(element.width || 0),
          pixelHeight: Number(element.height || 0),
        };
      });
      best = {
        index: i,
        area,
        box,
        meta,
      };
    }
  }
  if (!best) return null;

  const screenshotBuffer = await canvases.nth(best.index).screenshot({ type: "png" });
  return {
    screenshotBuffer,
    cssWidth: best.meta.cssWidth || Math.round(best.box.width),
    cssHeight: best.meta.cssHeight || Math.round(best.box.height),
    pixelWidth: best.meta.pixelWidth,
    pixelHeight: best.meta.pixelHeight,
  };
}

// Canva fronts automated browsers with a Cloudflare interstitial ("We'll have you designing
// again soon" / Turnstile "Verifying..."). That page contains canvases of its own, so a plain
// largest-canvas wait happily captures the CHALLENGE SCREEN and imports garbage. Detect it and
// keep waiting instead — the non-interactive check usually clears on its own, and an
// interactive one can be clicked in the headed window.
async function isChallengePage(page) {
  try {
    return await page.evaluate(() => {
      const title = String(document.title || "").toLowerCase();
      const bodyText = String(document.body?.innerText || "").slice(0, 4000).toLowerCase();
      return (
        title.includes("just a moment") ||
        bodyText.includes("verifying...") ||
        bodyText.includes("have you designing again soon") ||
        bodyText.includes("verify you are human") ||
        Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"]'))
      );
    });
  } catch (_error) {
    return false;
  }
}

async function isCanvaEditorReady(page) {
  try {
    return await page.evaluate(
      () => document.querySelectorAll("[data-page-id]").length > 0
    );
  } catch (_error) {
    return false;
  }
}

async function waitForCanvaCanvas(page, timeoutMs) {
  const start = Date.now();
  let challengeLogged = false;
  while (Date.now() - start < timeoutMs) {
    if (await isChallengePage(page)) {
      if (!challengeLogged) {
        challengeLogged = true;
        console.log(
          "Cloudflare verification detected — waiting it out. If a checkbox appears in the browser window, click it."
        );
      }
      await page.waitForTimeout(1500);
      continue;
    }
    // Only capture once the real editor DOM is present; any earlier canvas belongs to a
    // loading/challenge/preview page.
    if (await isCanvaEditorReady(page)) {
      const capture = await getLargestCanvasCapture(page);
      if (capture) return capture;
    }
    await page.waitForTimeout(1200);
  }
  return null;
}

const MAX_IMPORT_PAGES = 10;

// Multi-page designs: capture every [data-page-id] node (document order = Canva page order)
// as its own snapshot. Returns null for single-page designs so the legacy largest-canvas
// capture keeps handling them.
async function captureCanvaPageNodes(page, maxPages = MAX_IMPORT_PAGES) {
  let pageIds = [];
  try {
    pageIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-page-id]"))
        .map((node) => String(node.getAttribute("data-page-id") || ""))
        .filter(Boolean)
    );
  } catch (_error) {
    return null;
  }
  const orderedIds = [...new Set(pageIds)];
  if (orderedIds.length <= 1) return null;

  const captures = [];
  const truncated = Math.max(0, orderedIds.length - maxPages);
  for (const pageId of orderedIds.slice(0, maxPages)) {
    const locator = page
      .locator(`[data-page-id="${pageId.replace(/"/g, '\\"')}"]`)
      .first();
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      // Let Canva lazy-render the freshly scrolled page before shooting it.
      await page.waitForTimeout(800);
      const box = await locator.boundingBox();
      if (!box || box.width < 60 || box.height < 60) continue;
      const screenshotBuffer = await locator.screenshot({ type: "png", timeout: 20_000 });
      captures.push({
        pageId,
        screenshotBuffer,
        cssWidth: Math.round(box.width),
        cssHeight: Math.round(box.height),
      });
    } catch (error) {
      console.warn(`Page capture failed for Canva page ${pageId}: ${error.message}`);
    }
  }
  if (captures.length <= 1) return null;
  return { captures, truncated };
}

async function captureCanva(url, options) {
  await fs.mkdir(options.profileDir, { recursive: true });
  let context;
  try {
    try {
      context = await chromium.launchPersistentContext(options.profileDir, {
        channel: "chrome",
        headless: options.headless,
        viewport: { width: 1600, height: 1000 },
      });
    } catch (_chromeChannelError) {
      context = await chromium.launchPersistentContext(options.profileDir, {
        headless: options.headless,
        viewport: { width: 1600, height: 1000 },
      });
    }

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

    let capture = await waitForCanvaCanvas(page, options.timeoutMs);
    if (!capture) {
      if (options.noPrompt || !process.stdin.isTTY) {
        capture = await waitForCanvaCanvas(page, options.retryTimeoutMs);
      } else {
        await waitForManualContinue(
          "Canva canvas not detected yet. Log in/open the design in this browser window first."
        );
        capture = await waitForCanvaCanvas(page, 60_000);
      }
    }
    if (!capture) {
      if (await isChallengePage(page)) {
        throw new Error(
          "Blocked by Canva's Cloudflare verification. Re-run and complete the verification in the opened browser window, or use the Chrome extension import instead."
        );
      }
      throw new Error(
        "Could not detect Canva design canvas. Make sure the design is open and accessible in this browser profile."
      );
    }

    // Best effort to clear active object selections/handles from the captured frame.
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
    const refreshedCapture = await getLargestCanvasCapture(page);
    if (refreshedCapture) {
      capture = refreshedCapture;
    }

    // Multi-page designs: one snapshot per page. Null → single-page legacy capture.
    const multiPage = await captureCanvaPageNodes(page);

    const title = await page.title();
    const finalUrl = page.url();
    return {
      ...capture,
      multiPage,
      title,
      finalUrl,
    };
  } finally {
    if (context) {
      await context.close();
    }
  }
}

function buildSnapshotImageObject(snapshotDataUrl, canvasWidth, canvasHeight, sourceWidth, sourceHeight, extra = {}) {
  const resolvedSourceWidth = Math.max(1, Math.round(sourceWidth || canvasWidth));
  const resolvedSourceHeight = Math.max(1, Math.round(sourceHeight || canvasHeight));
  const scaleX = canvasWidth / resolvedSourceWidth;
  const scaleY = canvasHeight / resolvedSourceHeight;

  return {
    type: "Image",
    version: "7.0.0",
    originX: "left",
    originY: "top",
    left: 0,
    top: 0,
    width: resolvedSourceWidth,
    height: resolvedSourceHeight,
    scaleX,
    scaleY,
    angle: 0,
    opacity: 1,
    src: snapshotDataUrl,
    layerType: "image",
    layerName: "Imported Canva Snapshot",
    layerLocked: false,
    layerHidden: false,
    sourceWidth: resolvedSourceWidth,
    sourceHeight: resolvedSourceHeight,
    ...extra,
  };
}

function buildFabricData(snapshotDataUrl, canvasWidth, canvasHeight, sourceWidth, sourceHeight) {
  return {
    version: "7.0.0",
    objects: [
      buildSnapshotImageObject(snapshotDataUrl, canvasWidth, canvasHeight, sourceWidth, sourceHeight),
    ],
  };
}

// Multi-page: one full-page snapshot object per page, tagged with importPageIndex, plus the
// meta.import.pages descriptor list the dashboard/editor/mobile pipeline partitions on.
function buildMultiPageFabricData(pageSnapshots, canvasWidth, canvasHeight) {
  const objects = pageSnapshots.map((snapshot, index) =>
    buildSnapshotImageObject(
      snapshot.dataUrl,
      canvasWidth,
      canvasHeight,
      snapshot.sourceWidth,
      snapshot.sourceHeight,
      {
        layerName: `Page ${index + 1} Snapshot`,
        importNodeId: `canva-page-snapshot-${index + 1}`,
        importPageIndex: index,
      }
    )
  );
  const pages = pageSnapshots.map((snapshot, index) => ({
    id: `canva-page-${index + 1}`,
    name: `Page ${index + 1}`,
    width: canvasWidth,
    height: canvasHeight,
    sourceWidth: Math.max(1, Math.round(snapshot.sourceWidth || canvasWidth)),
    sourceHeight: Math.max(1, Math.round(snapshot.sourceHeight || canvasHeight)),
  }));

  return {
    version: "7.0.0",
    objects,
    meta: {
      import: {
        importVersion: 2,
        source: "canva-playwright",
        page: pages[0],
        pages,
        layerTree: objects.map((object, index) => ({
          id: String(object.importNodeId),
          parentId: null,
          zIndex: index,
          name: String(object.layerName),
          kind: "image",
        })),
        layerStats: {
          detected: objects.length,
          editable: 0,
          rasterized: objects.length,
          skipped: 0,
        },
        usedFonts: [],
        warnings: [],
      },
    },
  };
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) {
    usage();
    process.exit(1);
  }

  const sourceUrl = normalizeCanvaUrl(options.url);
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (from .env or environment).");
  }

  const capture = await captureCanva(sourceUrl, options);
  // Multi-page captures anchor everything (canvas size, thumbnail) on page 1's snapshot;
  // single-page keeps the legacy largest-canvas capture.
  const primaryPageCapture = capture.multiPage ? capture.multiPage.captures[0] : null;
  const dataUrl = primaryPageCapture
    ? `data:image/png;base64,${primaryPageCapture.screenshotBuffer.toString("base64")}`
    : `data:image/png;base64,${capture.screenshotBuffer.toString("base64")}`;
  const sourceWidth = Math.max(
    1,
    Math.round(
      primaryPageCapture
        ? primaryPageCapture.cssWidth
        : capture.pixelWidth || capture.cssWidth || 1080
    )
  );
  const sourceHeight = Math.max(
    1,
    Math.round(
      primaryPageCapture
        ? primaryPageCapture.cssHeight
        : capture.pixelHeight || capture.cssHeight || 1080
    )
  );
  const maxDimension = Math.max(320, Number(options.maxDimension) || 1920);
  const downscale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * downscale));
  const height = Math.max(1, Math.round(sourceHeight * downscale));

  if (options.snapshotPath) {
    await fs.mkdir(path.dirname(options.snapshotPath), { recursive: true });
    await fs.writeFile(options.snapshotPath, capture.screenshotBuffer);
  }

  const prisma = new PrismaClient();
  try {
    const ownerId = await resolveOwnerId(prisma, options.ownerId);
    const requestedName = options.name || titleToTemplateName(capture.title);
    const templateName = await ensureUniqueName(prisma, ownerId, requestedName);
    const templateSlug = await ensureUniqueSlug(prisma, options.slug || templateName);

    let templateData;
    let pageCount = 1;
    if (capture.multiPage) {
      const pageSnapshots = capture.multiPage.captures.map((pageCapture) => ({
        dataUrl: `data:image/png;base64,${pageCapture.screenshotBuffer.toString("base64")}`,
        sourceWidth: pageCapture.cssWidth,
        sourceHeight: pageCapture.cssHeight,
      }));
      templateData = buildMultiPageFabricData(pageSnapshots, width, height);
      pageCount = pageSnapshots.length;
      if (capture.multiPage.truncated > 0) {
        templateData.meta.import.warnings.push(
          `Design has ${pageCount + capture.multiPage.truncated} pages; imported the first ${pageCount} (page cap).`
        );
      }
    } else {
      templateData = buildFabricData(dataUrl, width, height, sourceWidth, sourceHeight);
    }

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.template.create({
        data: {
          ownerId,
          name: templateName,
          slug: templateSlug,
          status: "draft",
          version: 1,
          canvasSize: { width, height },
          pageCount,
          category: "general",
          subCategory: "general",
          tags: ["canva", "imported"],
          thumbnailDataUrl: dataUrl,
          data: templateData,
        },
      });

      await tx.templateRevision.create({
        data: {
          templateId: item.id,
          version: item.version,
          action: "import-canva",
          actorId: ownerId,
          snapshot: {
            name: item.name,
            slug: item.slug,
            status: item.status,
            canvasSize: item.canvasSize,
            category: item.category,
            subCategory: item.subCategory,
            tags: item.tags,
            thumbnailDataUrl: item.thumbnailDataUrl,
            data: item.data,
          },
        },
      });

      return item;
    });

    console.log("Canva import completed.");
    console.log(`Template ID: ${created.id}`);
    console.log(`Name: ${created.name}`);
    console.log(`Slug: ${created.slug}`);
    console.log(`Canvas: ${width}x${height}`);
    console.log(`Pages: ${pageCount}`);
    console.log(`Captured source: ${sourceWidth}x${sourceHeight}`);
    console.log(`Source URL: ${capture.finalUrl}`);
    console.log(`Editor: http://localhost:3000/editor?templateId=${encodeURIComponent(created.id)}`);
    if (options.snapshotPath) {
      console.log(`Snapshot: ${options.snapshotPath}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`Canva import failed: ${error.message}`);
  process.exit(1);
});
