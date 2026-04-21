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
