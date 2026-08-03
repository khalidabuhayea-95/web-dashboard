# Template share links (`/t/<ref>`)

Operator guide for the public share link surface: what it is, the two values that
are still placeholders, and how to verify a deploy.

## URL shape

```
https://nayroz.com/t/<templateIdOrSlug>
```

`<ref>` is either the template **uuid** or its unique **slug** — both resolve,
exactly like `/api/mobile/templates/[slug]`. Build links with
`buildTemplateShareUrl(ref)` from `src/lib/shareLink.js`; never hand-assemble the
origin (a link generated on a dev dashboard must still name the real public host).

One URL, three behaviours:

| Where it is opened | Result |
| --- | --- |
| Android, app installed, `assetlinks.json` verified | App opens on the template |
| iOS, app installed, AASA valid, link **tapped** | App opens on the template |
| iOS, URL **pasted** into Safari | Web page — iOS never hands pasted URLs to apps |
| iOS, link tapped on a page already on `nayroz.com` | Web page — same-domain taps do not trigger Universal Links |
| No app / desktop / in-app browser | Web page (`src/app/t/[ref]/page.js`) |

The landing page is therefore the fallback, not a redirector. Its "افتح القالب في
تطبيق نيروز" button links to `nayroz://template?id=<ref>` rather than to the same
`https://` URL. That is deliberate: a visitor reading this page is already **on**
`nayroz.com`, and iOS does not fire a Universal Link for a same-domain
navigation — an `https` button there would just reload the page. The custom
scheme is registered by both apps (`AndroidManifest.xml` intent filter for
`android:scheme="nayroz"`, iOS `Info.plist` → `CFBundleURLTypes`) and opens them
directly. When the app is not installed the tap does nothing visible (Safari may
show "address is invalid"), which is why the store buttons sit immediately below
it and the copy says the button only works if the app is installed.

Visibility matches the mobile API exactly: `resolveTemplateAudience().statusWhere`
(published for everyone, drafts only for a tester bearer) plus
`isTemplateAllowedByTaxonomy`. A template hidden from the app is a 404 here too.

## The two well-known files

### `apple-app-site-association` (iOS)

Route handler at `src/app/.well-known/apple-app-site-association/route.js`, served
at `/.well-known/apple-app-site-association` as `application/json`, no extension.

It is a route handler and not a file in `public/` on purpose: an extensionless
file in `public/` is served as `application/octet-stream`, and
`X-Content-Type-Options: nosniff` (next.config.mjs, and again in `src/proxy.js`)
prevents anything from correcting that — Apple would reject it.

Body claims one path, `/t/*`, in both the modern (`components`) and legacy
(`apps` + `paths`) forms.

### `assetlinks.json` (Android)

Static file at `public/.well-known/assetlinks.json`, served at
`/.well-known/assetlinks.json` as `application/json` (a `.json` file in `public/`
keeps its extension and correct type, so no route handler is needed).

Standard `delegate_permission/common.handle_all_urls` statement for package
`com.nayroz.android`. JSON cannot carry comments, hence the obviously-fake
`"REPLACE_WITH_PLAY_APP_SIGNING_SHA256"` fingerprint — see below.

## Placeholders that must be replaced

### 1. Android release SHA-256 (`assetlinks.json`)

The repo has no signing config and no keystore for the release build type, so the
real fingerprint is the **Play App Signing** key held by Google.

Play Console → your app → **Test and release → Setup → App signing** → *App
signing key certificate* → copy the **SHA-256 certificate fingerprint**
(colon-separated uppercase hex). That page also generates a ready-made
`assetlinks.json` — paste its fingerprint into
`public/.well-known/assetlinks.json`.

For a locally signed (non-Play) build instead:

```bash
keytool -list -v -keystore <release.jks> -alias <alias>
```

Both fingerprints can coexist in the `sha256_cert_fingerprints` array — add the
Play key *and* any debug/internal key you want App Links to work for.

### 2. Apple team id (`IOS_TEAM_ID`)

Apple Developer → **Membership** (Membership details) → **Team ID** (10
characters). Then set it in **two** places:

- Mobile repo: `iosApp/Configuration/Config.xcconfig` → `TEAM_ID=...` (currently
  empty), and add the Associated Domain entitlement `applinks:nayroz.com`.
- This server: `IOS_TEAM_ID=...` — the AASA `appID` becomes
  `<TEAM_ID>.com.nayroz.ios`.

⚠️ **Universal Links silently do nothing until this is real.** With the
placeholder, iOS fetches the file, matches no installed app, and just opens the
web page. There is no error on device and nothing in this app's logs.

⚠️ **`IOS_TEAM_ID` is read at build time.** The AASA route is
`dynamic = "force-static"`, so its body is prerendered when `next build` runs —
and in the Docker image the build happens inside `docker build`, while
`docker-compose` env is applied only at runtime. Export `IOS_TEAM_ID` in the
**build** environment (e.g. an `ARG`/`ENV` before `npm run build` in the
Dockerfile), then confirm with the curl below; a runtime-only value will leave
the placeholder baked in.

### 3. App Store id (landing page)

`src/app/t/[ref]/appStores.js` → `APP_STORE_APP_ID = "REPLACE_WITH_APP_STORE_ID"`.
The numeric id is assigned by App Store Connect on first submission and exists
nowhere in either repo. Replace it with the digits from App Store Connect → *App
Information* → **Apple ID**; `APP_STORE_URL` switches from the interim
`/download.html` fallback to `https://apps.apple.com/app/id<digits>`
automatically.

The Play link is already correct: `id=com.nayroz.android`. (The mobile Settings
screen still links `id=com.nayroz`, which is wrong — missing the `.android`
suffix.)

## App side

Both platforms are wired in the mobile repo (`PhotoEditor`):

- **Android** — `androidApp/src/main/AndroidManifest.xml` declares an
  `android:autoVerify="true"` `VIEW`/`BROWSABLE` filter for
  `https://nayroz.com/t/*` and `https://www.nayroz.com/t/*`, plus a plain
  `nayroz://` filter. `MainActivity` is `launchMode="singleTask"` and forwards
  both `onCreate` and `onNewIntent` to `AppDeepLinkRegistry`.
- **iOS** — `iosApp/iosApp/iosApp.entitlements` declares
  `com.apple.developer.associated-domains` = `applinks:nayroz.com` (+ `www`), and
  `iOSApp.swift` forwards `onOpenURL` and `onContinueUserActivity` to the same
  registry. `Info.plist` registers the `nayroz` scheme.

Routing lives in `shared/src/commonMain/kotlin/com/nayroz/navigation/`:
`AppDeepLinkCodec.parseLink` accepts `https://nayroz.com/t/<ref>` (hosts
`nayroz.com` / `www.nayroz.com` only) and `nayroz://template?id=<ref>`, and
`TemplateShareLinks` builds the outbound URL. A template link resolves to
`HomeViewModel.openSharedTemplate(ref)`, which fetches the template and opens it
in the editor — the same path a favourite uses.

Still required before links actually open the app: the **SHA-256** and
**`IOS_TEAM_ID`** below. Until then Android shows a chooser instead of opening
directly, and iOS Universal Links do nothing at all.

## Verify after deploy

```bash
# 1. AASA — expect 200, content-type application/json, real team id in appIDs
curl -sI https://nayroz.com/.well-known/apple-app-site-association
curl -s  https://nayroz.com/.well-known/apple-app-site-association

# 2. Android statement list — expect the JSON with a real SHA-256
curl -s https://nayroz.com/.well-known/assetlinks.json

# 3. Google's own verifier (must return the statement, not an error)
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?\
source.web.site=https://nayroz.com&\
relation=delegate_permission/common.handle_all_urls"

# 4. A real landing page and a dead one
curl -s  https://nayroz.com/t/<published-slug> | grep -o '<title>.*</title>'
curl -sI https://nayroz.com/t/definitely-not-a-real-template   # expect 404
```

On device: `adb shell pm get-app-links com.nayroz.android` (states must be
`verified`) and, after installing, `adb shell pm verify-app-links --re-verify
com.nayroz.android` to force a re-check.

Requirements that break verification silently if broken:

- Both files must be served over **https on the exact host** in the link
  (`nayroz.com`; add `www.nayroz.com` too if links are ever shared with the
  `www` prefix), with **no redirect** — Android's verifier does not follow them.
- No authentication and no `Vary`-driven content negotiation on those paths.
- Android only auto-verifies on **install** (and on `pm verify-app-links`), so a
  fingerprint fixed after install needs a reinstall or a forced re-verify.
- Apple caches AASA on its CDN; allow up to 24h, or reinstall the app to force a
  fresh fetch during testing.

## Related env

| Variable | Purpose |
| --- | --- |
| `IOS_TEAM_ID` | Apple team id baked into the AASA `appID` (build time). |
| `NEXT_PUBLIC_SHARE_ORIGIN` | Optional override of the `https://nayroz.com` share origin, for a staging host that serves its own well-known pair. |
