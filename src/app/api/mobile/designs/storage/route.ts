import { NextRequest } from "next/server";

import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";
import { getStorageSummary } from "@/lib/designSync/quota.server";

export const runtime = "nodejs";

/** How much cloud storage the signed-in user is using, and their tier's limit. */
export async function GET(request: NextRequest) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:read", limit: 240 });
  if (auth.response) return auth.response;
  try {
    return noStore({ storage: await getStorageSummary(auth.user) });
  } catch (error) {
    return syncErrorResponse(error, "Failed to load storage usage.");
  }
}
