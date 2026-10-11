/**
 * Production audit H-24, end to end: the real mobile route handlers, with the database
 * unreachable. DATABASE_URL points at a closed local port BEFORE any module that creates the
 * Prisma client is imported, so every query fails exactly as it does in an outage — no mocks, and
 * no shared database is touched.
 *
 * Run: node --import tsx --test src/lib/api/outageRoutes.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

// Set before any route (and so the Prisma client) is imported — every import below is dynamic.
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/unreachable?connect_timeout=2";

const BEARER = { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.not-a-real-signature" };

function request(path, init = {}) {
  return new NextRequest(`http://localhost${path}`, init);
}

async function assertOutage(response, label) {
  assert.equal(response.status, 503, `${label}: status`);
  assert.equal(response.headers.get("cache-control"), "no-store", `${label}: cache-control`);
  const body = await response.json();
  assert.equal(body.code, "service_unavailable", `${label}: code`);
  assert.doesNotMatch(JSON.stringify(body), /prisma|database server|127\.0\.0\.1|P10\d\d/i, `${label}: leak`);
}

test("taxonomy: an outage is 503 + no-store, never the hard-coded legacy taxonomy", async () => {
  const { GET } = await import("@/app/api/mobile/templates/taxonomy/route.js");
  await assertOutage(await GET(request("/api/mobile/templates/taxonomy?locale=ar")), "taxonomy");
  // A second request must not be served from a poisoned in-memory cache either.
  await assertOutage(await GET(request("/api/mobile/templates/taxonomy?locale=en")), "taxonomy again");
});

test("template list, search and rails answer 503", async () => {
  const list = await import("@/app/api/mobile/templates/route");
  const search = await import("@/app/api/mobile/templates/search/route");
  const rails = await import("@/app/api/mobile/templates/by-subcategory/route.js");
  await assertOutage(await list.GET(request("/api/mobile/templates?categoryId=islamic-religious")), "list");
  await assertOutage(
    await search.GET(request(`/api/mobile/templates/search?query=${encodeURIComponent("رمضان")}`)),
    "search"
  );
  await assertOutage(await rails.GET(request("/api/mobile/templates/by-subcategory")), "rails");
});

test("auth: an outage is 503, not the 401 that makes the app sign the user out", async () => {
  const refresh = await import("@/app/api/mobile/auth/refresh/route");
  const me = await import("@/app/api/mobile/auth/me/route");
  const logout = await import("@/app/api/mobile/auth/logout/route");
  const refreshResponse = await refresh.POST(
    request("/api/mobile/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "a-refresh-token" }),
    })
  );
  await assertOutage(refreshResponse, "refresh");
  await assertOutage(await me.GET(request("/api/mobile/auth/me", { headers: BEARER })), "me");
  const logoutResponse = await logout.POST(
    request("/api/mobile/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "a-refresh-token" }),
    })
  );
  await assertOutage(logoutResponse, "logout");
});

test("bearer-authenticated routes answer 503 instead of 401", async () => {
  const credits = await import("@/app/api/mobile/media/credits/route");
  const tashkeel = await import("@/app/api/mobile/text/tashkeel/route");
  await assertOutage(await credits.GET(request("/api/mobile/media/credits", { headers: BEARER })), "credits");
  const tashkeelResponse = await tashkeel.POST(
    request("/api/mobile/text/tashkeel", {
      method: "POST",
      headers: { ...BEARER, "content-type": "application/json" },
      body: JSON.stringify({ text: "مرحبا" }),
    })
  );
  await assertOutage(tashkeelResponse, "tashkeel");
});

test("settings-backed catalogs answer 503 instead of their built-in defaults", async () => {
  const appSettings = await import("@/app/api/mobile/app-settings/route");
  const backgrounds = await import("@/app/api/mobile/background-categories/route");
  const elements = await import("@/app/api/mobile/element-categories/route");
  await assertOutage(
    await appSettings.GET(request("/api/mobile/app-settings?deviceType=ios&appVersion=1")),
    "app-settings"
  );
  await assertOutage(await backgrounds.GET(request("/api/mobile/background-categories")), "background-categories");
  await assertOutage(await elements.GET(request("/api/mobile/element-categories")), "element-categories");
});
