import { NextRequest } from "next/server";

import { listChanges } from "@/lib/designSync/designs.server";
import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";

export const runtime = "nodejs";

/**
 * Everything in the signed-in user's design library that changed after `since` (a cursor from a
 * previous call; 0 for a first sync): design headers — tombstones for deleted designs included —
 * and folders, oldest change first, plus the user's storage usage and limit.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:read", limit: 240 });
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    return noStore(await listChanges(auth.user, searchParams.get("since"), searchParams.get("limit")));
  } catch (error) {
    return syncErrorResponse(error, "Failed to load design changes.");
  }
}
