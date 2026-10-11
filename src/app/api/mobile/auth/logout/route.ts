import { NextResponse } from "next/server";

import { revokeMobileRefreshToken } from "@/lib/mobile/userAuth.server";
import { deactivateDeviceToken } from "@/lib/push/deviceTokens.server";

import { authErrorResponse, parseJsonBody } from "../_shared";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const refreshToken = String(body?.refreshToken || "").trim();
  const deviceToken = String(body?.deviceToken || "").trim();

  try {
    if (refreshToken) {
      await revokeMobileRefreshToken(refreshToken);
    }

    // Stop targeting this device once it signs out.
    if (deviceToken) {
      await deactivateDeviceToken(deviceToken);
    }
  } catch (error) {
    // An outage answers 503 (the app keeps the token and can retry the revoke); anything else
    // a generic 500 — never an unhandled framework error page.
    return authErrorResponse(error, "Failed to sign out.", 500);
  }

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
