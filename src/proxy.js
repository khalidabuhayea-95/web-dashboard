import { updateSession } from "@/lib/supabase/proxy";
import {
  attachRequestIdHeader,
  ensureRequestIdHeaders,
} from "@/lib/logging/request";

export async function proxy(request) {
  const { requestId, requestHeaders } = ensureRequestIdHeaders(request.headers);
  const response = await updateSession(request, requestHeaders);
  return attachRequestIdHeader(response, requestId);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
