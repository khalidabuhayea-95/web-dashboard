import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth/auth";
import {
  checkRateLimit,
  createRateLimitResponse,
  resolveRequestIp,
} from "@/lib/security/rateLimit.server";

const handler = NextAuth(authOptions);

export const GET = handler;

export async function POST(request, context) {
  // Throttle credential-verification attempts per IP to blunt online password
  // brute-forcing against the dashboard (NextAuth has no built-in lockout).
  const pathname = new URL(request.url).pathname;
  if (pathname.includes("/callback/credentials")) {
    const rateLimit = checkRateLimit({
      scope: "auth:login",
      identifier: resolveRequestIp(request) || "anonymous",
      limit: 10,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(
        "Too many login attempts. Please wait a minute and try again.",
        rateLimit
      );
    }
  }
  return handler(request, context);
}
