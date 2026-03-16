import { NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  deleteEditorCustomFont,
  getEditorCustomFonts,
  upsertEditorCustomFont,
} from "@/lib/editor/customFonts.server";
import { getEditorSyncedFonts } from "@/lib/editor/syncedFonts.server";

export const runtime = "nodejs";
export const maxDuration = 60;
const EDITOR_FONTS_RATE_LIMIT = {
  limit: 90,
  windowMs: 60_000,
};

function containsArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function normalizeCategories(value, fallbackSample = "") {
  const categories = Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => item === "EXCLUSIVE" || item === "ARABIC" || item === "ENGLISH")
    : [];
  if (!categories.includes("EXCLUSIVE")) categories.unshift("EXCLUSIVE");
  if (!categories.includes("ARABIC") && !categories.includes("ENGLISH")) {
    categories.push(containsArabicScript(fallbackSample) ? "ARABIC" : "ENGLISH");
  }
  return Array.from(new Set(categories));
}

function toEditorCustomFont(font) {
  return {
    ...font,
    categories: normalizeCategories(font?.categories, font?.family),
    source: "custom",
    removable: true,
  };
}

function toEditorSyncedFont(font) {
  const id = String(font?.id || "").trim();
  const resolvedFileUrl = id
    ? `/api/mobile/fonts/${encodeURIComponent(id)}/file`
    : String(font?.fileUrl || "").trim();

  return {
    id,
    family: String(font?.family || "").trim(),
    fileName: String(font?.fileName || "").trim(),
    mimeType: String(font?.mimeType || "").trim(),
    fileUrl: resolvedFileUrl,
    dataUrl: undefined,
    displayName: String(font?.displayName || "").trim(),
    categories: normalizeCategories(font?.categories, font?.family),
    source: String(font?.source || "synced").trim() || "synced",
    sourceLabel: String(font?.sourceLabel || "").trim(),
    removable: false,
    createdAt: font?.createdAt,
    updatedAt: font?.updatedAt,
  };
}

function normalizeFontKey(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/[_\s-]+/g, "")
    .toLowerCase();
}

async function buildEditorFontList() {
  const [customFonts, syncedFonts] = await Promise.all([
    getEditorCustomFonts().catch(() => []),
    getEditorSyncedFonts().catch(() => []),
  ]);

  const byId = new Set();
  const byFamily = new Set();
  const merged = [
    ...(Array.isArray(customFonts) ? customFonts.map(toEditorCustomFont) : []),
    ...(Array.isArray(syncedFonts) ? syncedFonts.map(toEditorSyncedFont) : []),
  ].filter((font) => {
    const idKey = String(font?.id || "").trim();
    const familyKey = normalizeFontKey(font?.family);
    if (!idKey || !familyKey) return false;
    if (byId.has(idKey) || byFamily.has(familyKey)) return false;
    byId.add(idKey);
    byFamily.add(familyKey);
    return true;
  });

  return merged;
}

function applyFontsRateLimit(request, session, scopeSuffix) {
  const rateLimitState = checkRateLimit({
    scope: `api:editor:fonts:${scopeSuffix}`,
    identifier: session.userId || resolveRequestIp(request),
    limit: EDITOR_FONTS_RATE_LIMIT.limit,
    windowMs: EDITOR_FONTS_RATE_LIMIT.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse("Too many font requests. Please retry shortly.", rateLimitState);
  }
  return null;
}

export async function GET(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;
  const rateLimitedResponse = applyFontsRateLimit(request, session, "list");
  if (rateLimitedResponse) return rateLimitedResponse;

  const fonts = await buildEditorFontList();
  return NextResponse.json({ fonts });
}

export async function POST(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;
  const rateLimitedResponse = applyFontsRateLimit(request, session, "upsert");
  if (rateLimitedResponse) return rateLimitedResponse;

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await upsertEditorCustomFont({
      family: body?.family,
      fileName: body?.fileName,
      dataUrl: body?.dataUrl,
      fileUrl: body?.fileUrl,
      mimeType: body?.mimeType,
      categories: body?.categories,
    });
    const fonts = await buildEditorFontList();
    const statusCode = result?.skippedDuplicate ? 200 : 201;
    return NextResponse.json({ ...result, fonts }, { status: statusCode });
  } catch (error) {
    return NextResponse.json(
      {
        error: error?.message || "Failed to save custom font.",
      },
      { status: 422 }
    );
  }
}

export async function DELETE(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;
  const rateLimitedResponse = applyFontsRateLimit(request, session, "delete");
  if (rateLimitedResponse) return rateLimitedResponse;

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const targetId = String(body?.id || "").trim();
    if (targetId.startsWith("synced-")) {
      return NextResponse.json(
        {
          error: "Synced fonts cannot be removed from editor.",
        },
        { status: 422 }
      );
    }

    const result = await deleteEditorCustomFont({
      id: body?.id,
      family: body?.family,
    });
    const fonts = await buildEditorFontList();
    return NextResponse.json({ ...result, fonts });
  } catch (error) {
    return NextResponse.json(
      {
        error: error?.message || "Failed to delete custom font.",
      },
      { status: 422 }
    );
  }
}
