import { NextRequest } from "next/server";

import { deleteFont, putFont } from "@/lib/designSync/fonts.server";
import { authenticateSyncRequest, noStore, syncErrorResponse } from "@/lib/designSync/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function fontId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return String(params?.id || "").trim();
}

/** Adds an installed font to the account (its file uploaded first, like design media). Idempotent. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:write", limit: 240 });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return noStore(await putFont(auth.user, await fontId(context), body));
  } catch (error) {
    return syncErrorResponse(error, "Failed to save the font.");
  }
}

/** Removes a font from the account; every device learns of it. Idempotent. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSyncRequest(request, { scope: "api:mobile:designs:write", limit: 240 });
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    return noStore(await deleteFont(auth.user, await fontId(context), searchParams.get("mutationId")));
  } catch (error) {
    return syncErrorResponse(error, "Failed to delete the font.");
  }
}
