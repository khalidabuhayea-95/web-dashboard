import { NextResponse } from "next/server";

import { requireMobileBearerUser } from "@/lib/mobile/userAuth.server";
import { normalizeMobileUserRole } from "@/lib/mobile/mobileUserRoles";

import { authErrorResponse } from "../_shared";

export async function GET(request: Request) {
  try {
    const { mobileUser } = await requireMobileBearerUser(request);
    return NextResponse.json(
      {
        user: {
          id: mobileUser.id,
          name: mobileUser.name || null,
          email: mobileUser.email || null,
          emailVerified: Boolean(mobileUser.emailVerified),
          role: normalizeMobileUserRole(mobileUser.role),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return authErrorResponse(error, "Unauthorized.", 401);
  }
}
