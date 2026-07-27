import {
  issueMobileSession,
  upsertMobileIdentity,
  verifyGoogleMobileLogin,
} from "@/lib/mobile/userAuth.server";

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
    scope: "api:mobile:auth:google",
    limit: 20,
    windowMs: 60_000,
    message: "Too many login attempts. Please retry shortly.",
  });
  if (limited) return limited;

  const body = await parseJsonBody(request);
  if (!body) return handleMissingBody();

  const idToken = String(body?.idToken || "").trim();
  if (!idToken) {
    return authErrorResponse(new Error("Google idToken is required."), "Missing Google token.");
  }

  try {
    const profile = await verifyGoogleMobileLogin({ idToken });
    const mobileUser = await upsertMobileIdentity(profile);
    const session = await issueMobileSession({
      mobileUser,
      userAgent: getUserAgent(request),
      ipAddress: getClientIp(request),
      ...getDeviceFields(body),
    });
    return authSuccessResponse(session);
  } catch (error) {
    return authErrorResponse(error, "Failed to sign in with Google.");
  }
}
