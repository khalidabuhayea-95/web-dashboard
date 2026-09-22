import { NextResponse } from "next/server";

import { handleApiError, handleBadRequest, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { isIsoDate } from "@/lib/occasions/dates";
import { createOccasion, listOccasions, serializeOccasion } from "@/lib/occasions/occasions.server";
import { OccasionValidationError } from "@/lib/occasions/validate";
import { getEditorSession } from "@/lib/templates/server";

export const runtime = "nodejs";

// Occasions calendar. Reading is open to every dashboard role (designers plan content
// around it too); creating, editing and deleting occasions is admin-only, while linking
// content lives in ./[id]/items and is open to designers as well.
export async function GET(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const { searchParams } = new URL(request.url);
    const fromIso = String(searchParams.get("from") || "").trim();
    const toIso = String(searchParams.get("to") || "").trim();
    if ((fromIso || toIso) && (!isIsoDate(fromIso) || !isIsoDate(toIso) || fromIso > toIso)) {
      return handleBadRequest('"from" and "to" must both be YYYY-MM-DD dates, from ≤ to');
    }

    const payload = await listOccasions(fromIso && toIso ? { fromIso, toIso } : {});
    return NextResponse.json({ ok: true, ...payload }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "Failed to load occasions");
  }
}

export async function POST(request: Request) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") return handleForbidden("Only admins can create occasions");

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const row = await createOccasion(body);
    logger.info("Occasion created", { userId: session.userId, slug: row.slug });
    const { today } = await listOccasions({});
    return NextResponse.json({ ok: true, occasion: serializeOccasion(row, today.iso) }, { status: 201 });
  } catch (error) {
    if (error instanceof OccasionValidationError) return handleBadRequest(error.message);
    return handleApiError(error, "Failed to create occasion");
  }
}
