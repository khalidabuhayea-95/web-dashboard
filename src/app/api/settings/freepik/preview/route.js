import { NextResponse } from "next/server";

import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";
import { getEditorSession } from "@/lib/templates/server";
import {
  getFreepikImportSettings,
  normalizeFreepikQueryInput,
  previewFreepikIcons,
} from "@/lib/tools/freepikImport.server";

const FREEPIK_PREVIEW_RATE_LIMIT = {
  limit: 40,
  windowMs: 60_000,
};

function sanitizeApiKey(value) {
  return String(value || "").trim();
}

export const runtime = "nodejs";

export async function POST(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const rateLimitState = checkRateLimit({
    scope: "api:settings:freepik:preview",
    identifier: session.userId || resolveRequestIp(request),
    limit: FREEPIK_PREVIEW_RATE_LIMIT.limit,
    windowMs: FREEPIK_PREVIEW_RATE_LIMIT.windowMs,
  });
  if (!rateLimitState.allowed) {
    return createRateLimitResponse(
      "Too many Freepik preview requests. Please retry shortly.",
      rateLimitState
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const settings = await getFreepikImportSettings();
    const overrideApiKey = sanitizeApiKey(body?.apiKeyOverride || body?.apiKey);
    const query = normalizeFreepikQueryInput({
      ...(settings?.defaults || {}),
      ...(body?.query && typeof body.query === "object" ? body.query : body),
    });

    const preview = await previewFreepikIcons({
      query,
      apiKey: overrideApiKey || settings?.apiKey,
    });

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to preview Freepik icons." },
      { status: 422 }
    );
  }
}
