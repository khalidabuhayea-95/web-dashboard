import {
  issueMobileSession,
  upsertMobileIdentity,
  verifyAppleMobileLogin,
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
    scope: "api:mobile:auth:apple",
    limit: 20,
    windowMs: 60_000,
    message: "Too many login attempts. Please retry shortly.",
  });
  if (limited) return limited;

  const body = await parseJsonBody(request);
  if (!body) return handleMissingBody();

  const identityToken = String(body?.identityToken || "").trim();
  if (!identityToken) {
    return authErrorResponse(
      new Error("Apple identityToken is required."),
      "Missing Apple identity token."
    );
  }

  try {
    const profile = await verifyAppleMobileLogin({
      identityToken,
      name: body?.name,
    });
    const mobileUser = await upsertMobileIdentity(profile);
    const session = await issueMobileSession({
      mobileUser,
      userAgent: getUserAgent(request),
      ipAddress: getClientIp(request),
      ...getDeviceFields(body),
    });
    return authSuccessResponse(session);
  } catch (error) {
    return authErrorResponse(error, "Failed to sign in with Apple.");
  }
}
