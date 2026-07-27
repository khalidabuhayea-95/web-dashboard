import {
  issueMobileSession,
  upsertMobileIdentity,
  verifyFacebookMobileLogin,
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
    scope: "api:mobile:auth:facebook",
    limit: 20,
    windowMs: 60_000,
    message: "Too many login attempts. Please retry shortly.",
  });
  if (limited) return limited;

  const body = await parseJsonBody(request);
  if (!body) return handleMissingBody();

  const accessToken = String(body?.accessToken || "").trim();
  if (!accessToken) {
    return authErrorResponse(
      new Error("Facebook accessToken is required."),
      "Missing Facebook access token."
    );
  }

  try {
    const profile = await verifyFacebookMobileLogin({ accessToken });
    const mobileUser = await upsertMobileIdentity(profile);
    const session = await issueMobileSession({
      mobileUser,
      userAgent: getUserAgent(request),
      ipAddress: getClientIp(request),
      ...getDeviceFields(body),
    });
    return authSuccessResponse(session);
  } catch (error) {
    return authErrorResponse(error, "Failed to sign in with Facebook.");
  }
}
