import { refreshMobileSession } from "@/lib/mobile/userAuth.server";

import {
  authErrorResponse,
  authSuccessResponse,
  getClientIp,
  getDeviceFields,
  getUserAgent,
  handleMissingBody,
  parseJsonBody,
} from "../_shared";
import { enforceIpRateLimit } from "@/lib/security/rateLimit.server";

export async function POST(request: Request) {
  const limited = enforceIpRateLimit(request, {
    scope: "api:mobile:auth:refresh",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

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
      ...getDeviceFields(body),
    });
    return authSuccessResponse(session);
  } catch (error) {
    return authErrorResponse(error, "Failed to refresh session.", 401);
  }
}
