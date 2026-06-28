import { NextResponse } from "next/server";

import { handleApiError, handleBadRequest } from "@/lib/api/errors";

export function getClientIp(request) {
  const forwardedFor = String(request.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  if (forwardedFor) return forwardedFor;
  return String(request.headers.get("x-real-ip") || "").trim() || null;
}

export function getUserAgent(request) {
  return String(request.headers.get("user-agent") || "").trim() || null;
}

// Optional push fields the app may include on auth requests so the backend can
// register the device's FCM token for push targeting. All fields are optional
// and backward compatible.
export function getDeviceFields(body) {
  const deviceToken = String(body?.deviceToken || "").trim();
  if (!deviceToken) return {};
  const devicePlatform = String(body?.devicePlatform || "").trim().toLowerCase();
  const appVersion = String(body?.appVersion || "").trim();
  return {
    deviceToken,
    devicePlatform: devicePlatform === "ios" ? "ios" : "android",
    appVersion: appVersion || undefined,
  };
}

export async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch (_error) {
    return null;
  }
}

export function handleMissingBody() {
  return handleBadRequest("Invalid JSON body");
}

export function authSuccessResponse(payload) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function authErrorResponse(error, fallback, status = 400) {
  return handleApiError(error, fallback, status);
}
