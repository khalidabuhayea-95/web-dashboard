import { NextRequest } from "next/server";

import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";
import { completeMediaUploads } from "@/lib/designSync/media.server";

export const runtime = "nodejs";

/** "These files are uploaded": the server checks each one in storage before it believes it. */
export async function POST(request: NextRequest) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:media", limit: 120 });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return noStore(await completeMediaUploads(auth.user, (body as { sha256s?: unknown } | null)?.sha256s));
  } catch (error) {
    return syncErrorResponse(error, "Failed to confirm the upload.");
  }
}
