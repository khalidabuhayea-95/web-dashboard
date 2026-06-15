import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";

import prisma from "@/lib/prisma";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/tokens";
import { normalizeEmail, sanitizeDisplayName } from "@/lib/auth/utils";
import { getMobileAuthSettings } from "@/lib/settings/mobileAuthSettings.server";

const MOBILE_ACCESS_ISSUER = "web-dashboard-mobile-auth";
const MOBILE_ACCESS_AUDIENCE = "mobile-app";
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function encodeSecret(value) {
  return new TextEncoder().encode(String(value || ""));
}

function serializeMobileUser(user) {
  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    emailVerified: Boolean(user.emailVerified),
  };
}

function pickUserName(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return sanitizeDisplayName(normalized);
  }
  return null;
}

function buildMobileAuthConfig(settings) {
  return {
    google: settings.google,
    facebook: settings.facebook,
    apple: settings.apple,
    bearer: settings.bearer,
  };
}

export async function getMobileAuthConfig() {
  const settings = await getMobileAuthSettings();
  return buildMobileAuthConfig(settings);
}

export async function issueMobileSession({ mobileUser, userAgent, ipAddress }) {
  const settings = await getMobileAuthConfig();
  const accessTokenSecret = String(settings.bearer.accessTokenSecret || "").trim();
  const refreshTokenSecret = String(settings.bearer.refreshTokenSecret || "").trim();

  if (!accessTokenSecret || !refreshTokenSecret) {
    throw new Error("Mobile bearer token settings are not configured.");
  }

  const accessTokenTtlMinutes = Number(settings.bearer.accessTokenTtlMinutes || 60);
  const refreshTokenTtlDays = Number(settings.bearer.refreshTokenTtlDays || 30);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessTokenExpiresAt = nowSeconds + Math.max(accessTokenTtlMinutes, 1) * 60;
  const refreshToken = createOpaqueToken();
  const storedRefreshTokenHash = hashOpaqueToken(`${refreshTokenSecret}:${refreshToken}`);
  const refreshExpiresAt = new Date(Date.now() + Math.max(refreshTokenTtlDays, 1) * 24 * 60 * 60 * 1000);

  await prisma.mobileRefreshToken.create({
    data: {
      mobileUserId: mobileUser.id,
      tokenHash: storedRefreshTokenHash,
      userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
      ipAddress: ipAddress ? String(ipAddress).slice(0, 120) : null,
      expiresAt: refreshExpiresAt,
    },
  });

  const accessToken = await new SignJWT({
    scope: "mobile",
    type: "access",
    email: mobileUser.email || null,
    emailVerified: Boolean(mobileUser.emailVerified),
    name: mobileUser.name || null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(MOBILE_ACCESS_ISSUER)
    .setAudience(MOBILE_ACCESS_AUDIENCE)
    .setSubject(mobileUser.id)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(accessTokenExpiresAt)
    .sign(encodeSecret(accessTokenSecret));

  return {
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    expiresInSeconds: accessTokenExpiresAt - nowSeconds,
    user: serializeMobileUser(mobileUser),
  };
}

export async function verifyMobileAccessToken(token) {
  const settings = await getMobileAuthConfig();
  const accessTokenSecret = String(settings.bearer.accessTokenSecret || "").trim();
  if (!accessTokenSecret) {
    throw new Error("Mobile access token verification is not configured.");
  }

  const verification = await jwtVerify(token, encodeSecret(accessTokenSecret), {
    issuer: MOBILE_ACCESS_ISSUER,
    audience: MOBILE_ACCESS_AUDIENCE,
  });

  const userId = String(verification.payload.sub || "").trim();
  if (!userId) {
    throw new Error("Invalid mobile access token subject.");
  }

  const mobileUser = await prisma.mobileUser.findUnique({
    where: { id: userId },
  });

  if (!mobileUser) {
    throw new Error("Mobile user not found.");
  }

  return {
    payload: verification.payload,
    mobileUser,
  };
}

export function getBearerTokenFromRequest(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }
  return token.trim();
}

export async function resolveOptionalMobileBearer(request) {
  const token = getBearerTokenFromRequest(request);
  if (!token) return null;

  try {
    const { mobileUser } = await verifyMobileAccessToken(token);
    return mobileUser;
  } catch {
    return null;
  }
}

export async function requireMobileBearerUser(request) {
  const token = getBearerTokenFromRequest(request);
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  return verifyMobileAccessToken(token);
}

/**
 * Resolve the logged-in mobile user from the request's bearer token without
 * throwing. Returns a discriminated result so route handlers can map auth
 * failures to a consistent 401 response. The `reason` field is for
 * server-side logging only and is never sent to clients.
 *
 * @typedef {{ ok: true, mobileUser: { id: string, name: string | null, email: string | null, emailVerified: boolean }, payload: import("jose").JWTPayload }} ResolvedMobileBearerUser
 * @typedef {{ ok: false, status: number, error: string, reason: string }} RejectedMobileBearerUser
 *
 * @param {Request} request
 * @returns {Promise<ResolvedMobileBearerUser | RejectedMobileBearerUser>}
 */
export async function resolveMobileBearerUser(request) {
  const token = getBearerTokenFromRequest(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Authentication required. Sign in and include a bearer token.",
      reason: "missing_token",
    };
  }

  try {
    const { mobileUser, payload } = await verifyMobileAccessToken(token);
    return { ok: true, mobileUser, payload };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      error: "Your session is invalid or has expired. Please sign in again.",
      reason: error instanceof Error ? error.message : "invalid_token",
    };
  }
}

export async function refreshMobileSession({ refreshToken, userAgent, ipAddress }) {
  const settings = await getMobileAuthConfig();
  const refreshTokenSecret = String(settings.bearer.refreshTokenSecret || "").trim();
  if (!refreshTokenSecret) {
    throw new Error("Mobile refresh token settings are not configured.");
  }

  const tokenHash = hashOpaqueToken(`${refreshTokenSecret}:${refreshToken}`);
  const storedToken = await prisma.mobileRefreshToken.findUnique({
    where: { tokenHash },
    include: { mobileUser: true },
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt.getTime() <= Date.now()) {
    throw new Error("Refresh token is invalid or expired.");
  }

  await prisma.mobileRefreshToken.update({
    where: { id: storedToken.id },
    data: {
      revokedAt: new Date(),
      lastUsedAt: new Date(),
    },
  });

  await prisma.mobileUser.update({
    where: { id: storedToken.mobileUserId },
    data: { lastLoginAt: new Date() },
  });

  return issueMobileSession({
    mobileUser: storedToken.mobileUser,
    userAgent,
    ipAddress,
  });
}

export async function revokeMobileRefreshToken(refreshToken) {
  const settings = await getMobileAuthConfig();
  const refreshTokenSecret = String(settings.bearer.refreshTokenSecret || "").trim();
  if (!refreshTokenSecret) return;

  const tokenHash = hashOpaqueToken(`${refreshTokenSecret}:${refreshToken}`);
  await prisma.mobileRefreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function upsertMobileIdentity({
  provider,
  providerUserId,
  email,
  emailVerified,
  displayName,
  profile,
}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedProviderUserId = String(providerUserId || "").trim();
  if (!normalizedProvider || !normalizedProviderUserId) {
    throw new Error("Provider and provider user id are required.");
  }

  const normalizedEmail = email ? normalizeEmail(email) : null;
  const canLinkByEmail = Boolean(emailVerified && normalizedEmail);
  const name = pickUserName(displayName, email);

  return prisma.$transaction(async (tx) => {
    let identity = await tx.mobileIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: normalizedProvider,
          providerUserId: normalizedProviderUserId,
        },
      },
      include: { mobileUser: true },
    });

    if (identity) {
      const conflictingUser =
        canLinkByEmail && normalizedEmail
          ? await tx.mobileUser.findFirst({
              where: {
                normalizedEmail,
                NOT: { id: identity.mobileUserId },
              },
            })
          : null;

      const nextUserData = {
        lastLoginAt: new Date(),
      };

      if (!identity.mobileUser.name && name) {
        nextUserData.name = name;
      }
      if (canLinkByEmail && normalizedEmail && !conflictingUser) {
        nextUserData.email = email;
        nextUserData.normalizedEmail = normalizedEmail;
        nextUserData.emailVerified = true;
      }

      const mobileUser = await tx.mobileUser.update({
        where: { id: identity.mobileUserId },
        data: nextUserData,
      });

      identity = await tx.mobileIdentity.update({
        where: { id: identity.id },
        data: {
          email: email || null,
          normalizedEmail,
          emailVerified: Boolean(emailVerified),
          displayName: name,
          profile: profile || null,
        },
        include: { mobileUser: true },
      });

      return mobileUser;
    }

    let mobileUser =
      canLinkByEmail && normalizedEmail
        ? await tx.mobileUser.findFirst({
            where: { normalizedEmail },
          })
        : null;

    if (mobileUser) {
      mobileUser = await tx.mobileUser.update({
        where: { id: mobileUser.id },
        data: {
          lastLoginAt: new Date(),
          ...(name && !mobileUser.name ? { name } : {}),
          ...(canLinkByEmail
            ? {
                email,
                normalizedEmail,
                emailVerified: true,
              }
            : {}),
        },
      });
    } else {
      mobileUser = await tx.mobileUser.create({
        data: {
          name,
          email: canLinkByEmail ? email : null,
          normalizedEmail: canLinkByEmail ? normalizedEmail : null,
          emailVerified: Boolean(canLinkByEmail),
          lastLoginAt: new Date(),
        },
      });
    }

    await tx.mobileIdentity.create({
      data: {
        mobileUserId: mobileUser.id,
        provider: normalizedProvider,
        providerUserId: normalizedProviderUserId,
        email: email || null,
        normalizedEmail,
        emailVerified: Boolean(emailVerified),
        displayName: name,
        profile: profile || null,
      },
    });

    return mobileUser;
  });
}

function ensureProviderEnabled(enabled, providerName) {
  if (!enabled) {
    throw new Error(`${providerName} login is not enabled.`);
  }
}

export async function verifyGoogleMobileLogin({ idToken }) {
  const settings = await getMobileAuthConfig();
  ensureProviderEnabled(settings.google.enabled, "Google");

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(idToken || ""))}`,
    {
      cache: "no-store",
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error_description || payload?.error || "Invalid Google token."));
  }

  const allowedAudiences = new Set([
    ...(Array.isArray(settings.google.androidClientIds) ? settings.google.androidClientIds : []),
    ...(Array.isArray(settings.google.iosClientIds) ? settings.google.iosClientIds : []),
  ]);

  if (allowedAudiences.size > 0 && !allowedAudiences.has(String(payload?.aud || ""))) {
    throw new Error("Google token audience is not allowed.");
  }

  const issuer = String(payload?.iss || "");
  if (issuer && issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") {
    throw new Error("Google token issuer is invalid.");
  }

  return {
    provider: "google",
    providerUserId: String(payload?.sub || ""),
    email: String(payload?.email || "").trim() || null,
    emailVerified: String(payload?.email_verified || "").toLowerCase() === "true",
    displayName: pickUserName(payload?.name, payload?.email),
    profile: payload,
  };
}

export async function verifyFacebookMobileLogin({ accessToken }) {
  const settings = await getMobileAuthConfig();
  ensureProviderEnabled(settings.facebook.enabled, "Facebook");

  const appId = String(settings.facebook.appId || "").trim();
  const appSecret = String(settings.facebook.appSecret || "").trim();
  if (!appId || !appSecret) {
    throw new Error("Facebook login settings are incomplete.");
  }

  const debugResponse = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(
      String(accessToken || "")
    )}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    { cache: "no-store" }
  );
  const debugPayload = await debugResponse.json().catch(() => ({}));
  const debugData = debugPayload?.data || {};
  if (!debugResponse.ok || !debugData?.is_valid) {
    throw new Error("Facebook access token is invalid.");
  }
  if (String(debugData.app_id || "") !== appId) {
    throw new Error("Facebook app id does not match configured settings.");
  }

  const meResponse = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(
      String(accessToken || "")
    )}`,
    { cache: "no-store" }
  );
  const mePayload = await meResponse.json().catch(() => ({}));
  if (!meResponse.ok || !mePayload?.id) {
    throw new Error("Unable to load Facebook profile.");
  }

  return {
    provider: "facebook",
    providerUserId: String(mePayload.id || ""),
    email: String(mePayload.email || "").trim() || null,
    emailVerified: Boolean(mePayload.email),
    displayName: pickUserName(mePayload.name, mePayload.email),
    profile: {
      debug: debugData,
      me: mePayload,
    },
  };
}

export async function verifyAppleMobileLogin({ identityToken, name }) {
  const settings = await getMobileAuthConfig();
  ensureProviderEnabled(settings.apple.enabled, "Apple");

  const allowedAudiences = Array.isArray(settings.apple.iosBundleIds)
    ? settings.apple.iosBundleIds.filter(Boolean)
    : [];
  if (allowedAudiences.length === 0) {
    throw new Error("Apple login settings are incomplete.");
  }

  const verification = await jwtVerify(String(identityToken || ""), APPLE_JWKS, {
    issuer: "https://appleid.apple.com",
    audience: allowedAudiences,
  });

  const payload = verification.payload;
  return {
    provider: "apple",
    providerUserId: String(payload.sub || ""),
    email: String(payload.email || "").trim() || null,
    emailVerified: String(payload.email_verified || "").toLowerCase() === "true",
    displayName: pickUserName(name, payload.email),
    profile: payload,
  };
}
