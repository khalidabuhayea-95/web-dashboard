import { NextRequest, NextResponse } from "next/server";

import { getMobileUserDetail } from "@/lib/mobile/mobileUsers.server";
import { handleApiError, handleValidationError } from "@/lib/api/errors";

import { requireMobileUsersAdmin } from "../_shared";

export const runtime = "nodejs";

// Expanded view for one mobile account: linked social identities, sessions,
// push devices and favorited templates.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileUsersAdmin(request, "detail", { limit: 120 });
    if ("error" in auth) return auth.error;

    const { id } = await params;
    const userId = String(id || "").trim();
    if (!userId) {
      return handleValidationError([
        { path: ["id"], message: "Mobile user id is required", code: "custom" },
      ]);
    }

    const user = await getMobileUserDetail(userId);

    return NextResponse.json({ user });
  } catch (error) {
    return handleApiError(
      error,
      error instanceof Error ? error.message : "Failed to load mobile user"
    );
  }
}
