/**
 * Apple App Site Association — iOS Universal Links for template share links.
 *
 * Served at https://nayroz.com/.well-known/apple-app-site-association with
 * `Content-Type: application/json` and NO file extension, which is exactly what
 * Apple's CDN fetches. It is a route handler rather than a file in `public/`
 * because an extensionless file in `public/` is served as
 * `application/octet-stream`, and `X-Content-Type-Options: nosniff` (set
 * globally in next.config.mjs and again in src/proxy.js) stops anything from
 * correcting that — Apple would reject it.
 *
 * ⚠️ UNIVERSAL LINKS SILENTLY DO NOTHING UNTIL `IOS_TEAM_ID` IS REAL. ⚠️
 * The appID below is `<TEAM_ID>.<bundle id>`. With the placeholder team id in
 * place, iOS fetches this file, fails to match any installed app, and just opens
 * the /t/<ref> web page — no error anywhere, on device or in this app's logs.
 * Set IOS_TEAM_ID in the server env (Apple Developer > Membership > Team ID) and
 * redeploy; see docs/share-links.md.
 *
 * The app side must also declare the matching Associated Domain
 * (`applinks:nayroz.com`) — this file alone is not enough.
 */

export const dynamic = "force-static";

/** Obviously-fake so a wrong deployment is visible in the served JSON. */
const PLACEHOLDER_TEAM_ID = "REPLACE_WITH_APPLE_TEAM_ID";

/** Verified from the mobile repo (iosApp bundle identifier). */
const IOS_BUNDLE_ID = "com.nayroz.ios";

/** Single path the app claims. Everything else stays a normal web page. */
const SHARE_PATH_PATTERN = "/t/*";

function resolveAppId() {
  const teamId = String(process.env.IOS_TEAM_ID || "").trim() || PLACEHOLDER_TEAM_ID;
  return `${teamId}.${IOS_BUNDLE_ID}`;
}

export async function GET() {
  const appId = resolveAppId();

  const body = {
    applinks: {
      // `apps` + `paths` are the legacy (iOS 12 and earlier) form; `components`
      // is the modern one. Shipping both is standard and harmless: each iOS
      // version reads the form it understands and ignores the other.
      apps: [],
      details: [
        {
          appIDs: [appId],
          appID: appId,
          components: [
            {
              "/": SHARE_PATH_PATTERN,
              comment: "Template share links",
            },
          ],
          paths: [SHARE_PATH_PATTERN],
        },
      ],
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Apple's CDN caches this aggressively anyway; keep it short enough that a
      // team-id fix propagates without waiting a day.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
