import { NextRequest } from "next/server";

import { deleteFolder, putFolder } from "@/lib/designSync/designs.server";
import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function folderId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return String(params?.id || "").trim();
}

/** Create or update a folder (name and colour). */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:write", limit: 240 });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return noStore(await putFolder(auth.user, await folderId(context), body));
  } catch (error) {
    return syncErrorResponse(error, "Failed to save the folder.");
  }
}

/** Delete a folder. Its designs stay, in no folder. Idempotent. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:write", limit: 240 });
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    return noStore(await deleteFolder(auth.user, await folderId(context), searchParams.get("mutationId")));
  } catch (error) {
    return syncErrorResponse(error, "Failed to delete the folder.");
  }
}
