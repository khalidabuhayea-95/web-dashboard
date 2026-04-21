import { refreshMobileSession } from "@/lib/mobile/userAuth.server";

import {
  authErrorResponse,
  authSuccessResponse,
  getClientIp,
  getUserAgent,
  handleMissingBody,
  parseJsonBody,
} from "../_shared";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body) return handleMissingBody();

  const refreshToken = String(body?.refreshToken || "").trim();
  if (!refreshToken) {
    return authErrorResponse(
      new Error("Refresh token is required."),
      "Missing refresh token."
    );
  }

  try {
    const session = await refreshMobileSession({
      refreshToken,
      userAgent: getUserAgent(request),
      ipAddress: getClientIp(request),
    });
    return authSuccessResponse(session);
  } catch (error) {
    return authErrorResponse(error, "Failed to refresh session.", 401);
  }
}
