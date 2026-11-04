import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import { handleApiError } from "@/lib/api/errors";
import { serializeTextEffect } from "@/lib/textEffects/spec";
import { textEffectRowForBrowser } from "@/lib/textEffects/rows.server";

export const runtime = "nodejs";

// The editor's effect catalog: the same published effects and client shape as the mobile API,
// with the files behind the same-origin storage proxy so the canvas stays exportable (R2 sends
// no CORS headers; a texture drawn from it would taint every PNG/MP4 export).
export async function GET() {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    const rows = await prisma.textEffect.findMany({
      where: { published: true },
      orderBy: { sortOrder: "asc" },
    });
    const effects = rows.map((row: unknown) => serializeTextEffect(textEffectRowForBrowser(row)));
    return NextResponse.json({ effects }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return handleApiError(error, "Failed to load text effects");
  }
}
