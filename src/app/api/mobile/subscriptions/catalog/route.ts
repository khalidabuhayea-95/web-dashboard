import { NextRequest, NextResponse } from "next/server";

import { buildSubscriptionCatalog } from "@/lib/billing/publicCatalog.server";
import { createLogger } from "@/lib/logging/logger";
import {
  attachRequestIdHeader,
  getRequestLogContext,
  resolveRequestId,
} from "@/lib/logging/request";

export const runtime = "nodejs";

const logger = createLogger("api.mobile.subscriptions.catalog");

// Packages, allowances and dashboard prices for the paywall — the app's price
// source wherever the store returns no products (simulator, dev, storefront
// outage). Store prices win whenever they exist; see publicCatalog.server.ts.
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const requestLogger = logger.child(getRequestLogContext(request, requestId));

  try {
    // ★PUBLIC on purpose, same reasoning as the AI-tools catalogue: identical
    // for every caller, no per-user data, and the paywall must render for a
    // signed-out user — the sign-in wall lives at the purchase CTA.
    const catalog = await buildSubscriptionCatalog();

    return attachRequestIdHeader(
      NextResponse.json(catalog, {
        status: 200,
        headers: {
          // Changes only when an admin saves the Subscriptions page; a short
          // public cache keeps the paywall's reload-on-every-open cheap.
          "Cache-Control": "public, max-age=60",
        },
      }),
      requestId
    );
  } catch (error) {
    requestLogger.error("Building the subscription catalog failed", { error });
    return attachRequestIdHeader(
      NextResponse.json({ error: "Failed to load the subscription catalog" }, { status: 500 }),
      requestId
    );
  }
}
