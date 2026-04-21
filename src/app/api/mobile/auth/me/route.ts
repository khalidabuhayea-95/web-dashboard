import { NextResponse } from "next/server";

import { requireMobileBearerUser } from "@/lib/mobile/userAuth.server";

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
