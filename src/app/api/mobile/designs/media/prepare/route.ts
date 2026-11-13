import { NextRequest } from "next/server";

import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";
import { prepareMediaUploads } from "@/lib/designSync/media.server";

export const runtime = "nodejs";

/**
 * The files a design needs, by content hash → which ones the server lacks, each with a signed URL
 * the device PUTs the file to directly. Reserves the space for them, or refuses the whole request
 * with `storage_quota_exceeded`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:media", limit: 120 });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return noStore(await prepareMediaUploads(auth.user, (body as { files?: unknown } | null)?.files));
  } catch (error) {
    return syncErrorResponse(error, "Failed to prepare the upload.");
  }
}
