import { NextRequest } from "next/server";

import { getDesign, purgeDesign, putDesign } from "@/lib/designSync/designs.server";
import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function designId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return String(params?.id || "").trim();
}

/** One design: its header, its document, and signed download URLs for the files it references. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:read", limit: 240 });
  if (auth.response) return auth.response;
  try {
    return noStore(await getDesign(auth.user, await designId(context)));
  } catch (error) {
    return syncErrorResponse(error, "Failed to load the design.");
  }
}

/**
 * Create or update a design. With `data`: the whole document (every file it references must
 * already be uploaded). Without: only the header — name, Trash, folder.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:write", limit: 240 });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return noStore(await putDesign(auth.user, await designId(context), body));
  } catch (error) {
    return syncErrorResponse(error, "Failed to save the design.");
  }
}

/** Delete a design for good. Idempotent. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:write", limit: 240 });
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    return noStore(await purgeDesign(auth.user, await designId(context), searchParams.get("mutationId")));
  } catch (error) {
    return syncErrorResponse(error, "Failed to delete the design.");
  }
}
