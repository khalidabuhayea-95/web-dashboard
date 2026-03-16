import { NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  deleteImportedElementAsset,
  listImportedElementAssets,
} from "@/lib/editor/importedElements.server";

const IMPORTED_ELEMENTS_RATE_LIMIT = {
  limit: 120,
  windowMs: 60_000,
};

export const runtime = "nodejs";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export async function GET(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const rateLimitState = checkRateLimit({
    scope: "api:editor:elements:imported",
    identifier: session.userId || resolveRequestIp(request),
    limit: IMPORTED_ELEMENTS_RATE_LIMIT.limit,
    windowMs: IMPORTED_ELEMENTS_RATE_LIMIT.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse(
      "Too many imported elements requests. Please retry shortly.",
      rateLimitState
    );
  }

  const { searchParams } = new URL(request.url);

  try {
    const result = await listImportedElementAssets({
      source: searchParams.get("source") || "freepik",
      kind: searchParams.get("kind") || "all",
      query: searchParams.get("query") || "",
      page: parsePositiveInt(searchParams.get("page"), 1),
      pageSize: parsePositiveInt(searchParams.get("pageSize"), 40),
      locale: searchParams.get("lang") || "en",
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch imported elements." },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const rateLimitState = checkRateLimit({
    scope: "api:editor:elements:imported",
    identifier: session.userId || resolveRequestIp(request),
    limit: IMPORTED_ELEMENTS_RATE_LIMIT.limit,
    windowMs: IMPORTED_ELEMENTS_RATE_LIMIT.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse(
      "Too many imported elements requests. Please retry shortly.",
      rateLimitState
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Imported element id is required." }, { status: 400 });
    }

    const result = await deleteImportedElementAsset({
      id,
      ownerId: session.userId,
      isAdmin: session.role === "admin",
    });

    if (!result.deleted) {
      return NextResponse.json({ error: "Imported element not found." }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to delete imported element." },
      { status: 422 }
    );
  }
}
