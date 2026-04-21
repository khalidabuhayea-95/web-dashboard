import {
  issueMobileSession,
  upsertMobileIdentity,
  verifyFacebookMobileLogin,
} from "@/lib/mobile/userAuth.server";

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
    });
    return authSuccessResponse(session);
  } catch (error) {
    return authErrorResponse(error, "Failed to sign in with Facebook.");
  }
}
