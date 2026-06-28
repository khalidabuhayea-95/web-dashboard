import { NextResponse } from "next/server";

import { revokeMobileRefreshToken } from "@/lib/mobile/userAuth.server";
import { deactivateDeviceToken } from "@/lib/push/deviceTokens.server";

import { parseJsonBody } from "../_shared";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const refreshToken = String(body?.refreshToken || "").trim();
  const deviceToken = String(body?.deviceToken || "").trim();

  if (refreshToken) {
    await revokeMobileRefreshToken(refreshToken);
  }

  // Stop targeting this device once it signs out.
  if (deviceToken) {
    await deactivateDeviceToken(deviceToken);
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
