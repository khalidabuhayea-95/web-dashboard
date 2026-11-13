import { NextRequest } from "next/server";

import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";
import { prepareMediaParts } from "@/lib/designSync/media.server";

export const runtime = "nodejs";

/**
 * A large file's parts: which ones storage already holds and a signed URL for each missing one.
 * Called again after any interruption — the upload resumes from what storage has.
 */
export async function POST(request: NextRequest) {
  // A 2 GB file is 128 parts and a slow upload asks again after each break: a roomier limit.
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:media", limit: 240 });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return noStore(await prepareMediaParts(auth.user, (body as { sha256?: unknown } | null)?.sha256));
  } catch (error) {
    return syncErrorResponse(error, "Failed to prepare the upload parts.");
  }
}
