import { NextResponse } from "next/server";

import { revokeMobileRefreshToken } from "@/lib/mobile/userAuth.server";

import { parseJsonBody } from "../_shared";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const refreshToken = String(body?.refreshToken || "").trim();

  if (refreshToken) {
    await revokeMobileRefreshToken(refreshToken);
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
