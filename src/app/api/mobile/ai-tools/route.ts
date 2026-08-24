import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";
import { buildAiToolsCatalog } from "@/lib/mobile/aiTools.server";

export const runtime = "nodejs";

const logger = createLogger("api.mobile.ai-tools");

// The AI Tools tab in one call: magic tools and template categories as a single
// ordered list of sections, so the app renders the tab without knowing that two
// different admin systems produced it.
//
// Prompts are never included — see src/lib/mobile/aiTools.server.ts.
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    // ★PUBLIC on purpose. The catalogue is a shop window: slugs, titles, credit costs and the
    // before/after artwork, all identical for every caller (buildAiToolsCatalog takes no user)
    // and carrying no prompts — the same class of data the template feed already serves openly.
    // Requiring a token here meant a signed-out user saw a bare login wall where the tools
    // should be, with nothing to tell them what they were being asked to sign in FOR.
    // Running a tool stays authenticated and credit-metered in ./run.
    const catalog = await buildAiToolsCatalog();

    return attachRequestIdHeader(
      NextResponse.json(catalog, {
        status: 200,
        headers: {
          // Catalogue changes only when an admin edits it, but a stale tab is
          // worse than a cheap revalidation, so keep it short. Public now that the
          // payload no longer varies per caller.
          "Cache-Control": "public, max-age=60",
        },
      }),
      requestId
    );
  } catch (error) {
    requestLogger.error("AI tools catalog failed", error);
    return attachRequestIdHeader(
      NextResponse.json(
        { error: "Failed to load the AI tools." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      ),
      requestId
    );
  }
}
