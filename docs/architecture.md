# Project architecture: website, dashboard, api

One repository and one Next.js build, made of three **surfaces**. Each one is
served on its own subdomain:

| Surface   | Domain             | What it serves                                                      | Code                                   |
| --------- | ------------------ | ------------------------------------------------------------------- | -------------------------------------- |
| website   | `nayroz.com`       | Marketing site, template share pages `/t/<ref>`, `.well-known` files | `public/website/`, `src/app/(website)/` |
| dashboard | `admin.nayroz.com` | Admin console, editor, sign-in, and the `/api` routes it calls     | `src/app/(dashboard)/`                 |
| api       | `api.nayroz.com`   | Public API, versioned (`/v1/...`): the mobile app, store webhooks, health | `src/app/api/`                  |

Shared code lives in `src/lib/` (data, storage, auth, domain logic), in
`src/components/`, and in `src/store/`.

## Layout

```
public/
  website/            the static marketing site (landing.html, privacy.html, site.css, images…)
  brand/              brand kit; served on every host
  .well-known/        assetlinks.json (website)
src/
  app/
    (website)/        nayroz.com
      t/[ref]/          template share page (Universal Links / App Links target)
      .well-known/      apple-app-site-association
    (dashboard)/      admin.nayroz.com
      (shell)/          every page with the sidebar shell (templates, users, settings…)
      (editor)/         full-screen editor (editor-pro)
      login/ register/ mobile-api/ dashboard/
    api/              api.nayroz.com, plus the dashboard's same-origin calls
    layout.js, icon.svg, manifest.js …   root, shared by all three
  components/         shared UI (brand, dashboard nav, editor, ui kit)
  lib/                shared core; surfaces.js decides which host serves what
  proxy.js            applies surfaces.js to every request
```

Route groups in parentheses don't change URLs. They only make the boundaries
visible.

## How a request is routed

`src/proxy.js` calls `routeRequest()` from `src/lib/surfaces.js`, which is the
single source of truth. The rules are unit-tested in
`src/lib/surfaces.test.js` (`npm run test:surfaces`).

- **nayroz.com**
  - Every path is served from `public/website`. `/` serves `landing.html`.
  - These pass through untouched: `/t/*`, `/.well-known/*`, `/api/contact`
    (the contact form), and `/brand/*`.
  - Any other path 404s. It never falls through to the dashboard.
- **www.nayroz.com** redirects (308) to `nayroz.com`. The exception is
  `/.well-known/*`: Apple fetches `apple-app-site-association` from every
  associated domain and does not follow redirects.
- **admin.nayroz.com**
  - Serves the dashboard and every `/api` route. The dashboard keeps calling
    its own origin, so it needs no CORS and no cross-domain cookies.
  - Website paths (`/t/*`, `/landing.html`, …) redirect to `nayroz.com`.
  - `robots.txt` disallows everything.
- **api.nayroz.com**
  - The public API is versioned: `/v1/<rest>` is served by `/api/<rest>`, for
    example `/v1/mobile/templates` and `/v1/health`. The versions are listed in
    `API_VERSIONS` in surfaces.js.
  - Only public routes are reachable: `mobile/*`, `webhooks/*`, `health`,
    `storage/public/*`. Everything else returns a JSON 404, including
    `/v1/auth` and the admin APIs.
  - The unversioned `/api/...` forms of those same routes keep working. They
    are file addresses that the server puts into payloads (font files, template
    assets, shapes, `/api/storage/public`), and some are stored. They are not
    the API contract.
  - `/` returns `{ version: "v1", base: "/v1", … }`. `robots.txt` disallows
    everything.
- **Any other host** (127.0.0.1, a LAN IP the phone uses, the Android
  emulator's 10.0.2.2, the server's own IP) gets the all-in-one behaviour:
  - The dashboard is at `/`, and the API at both `/api` and `/v1`.
  - Website files are served at their root URLs (`/landing.html`).

## Trying it locally

Local hosts mirror production. Browsers and curl resolve `*.localhost` to your
machine, so no setup is needed:

- http://localhost:3000 (or http://nayroz.localhost:3000) is the **website**.
- http://admin.localhost:3000 is the **dashboard**.
- http://api.localhost:3000/v1/health is the **API**.
- http://www.localhost:3000 redirects to nayroz.localhost.

Redirect targets are built from the client's `Host` header, never from the request URL. Behind
Caddy, Next sees its own internal `http://localhost:3000/...`, and if the target came from that URL,
every production redirect would point at `localhost`. Redirects between surfaces go to
`nayroz.localhost`, never to bare
`localhost`, because Next.js rewrites a redirect to localhost onto the
request's own host, which makes a loop. `next.config.mjs` sets
`allowedDevOrigins: ["*.localhost"]` so the dev server serves its chunks and
HMR to these hosts.

The Canva importer defaults to `http://admin.localhost:3000`, and a saved
`localhost` URL is moved to `admin.localhost` automatically (extension 1.27.6).
Mobile dev builds call the API by IP (127.0.0.1 on the iOS simulator, 10.0.2.2
on the emulator, or the Mac's LAN IP), which is all-in-one.

## Scaling

Every instance runs the same build. Each surface can scale on its own:

- `NAYROZ_SURFACES=api` makes an instance serve only the api surface, and it
  answers 404 to the rest. Run several of these behind `api.nayroz.com`, and one
  instance with `website,dashboard` (or unset, meaning all) behind the other two
  hostnames.
- `WEBSITE_HOSTS` / `DASHBOARD_HOSTS` / `API_HOSTS` and the `*_ORIGIN`
  variables re-point everything for a staging environment. See `.env.example`.

## Boundaries (enforced by `npm run lint`)

`eslint.config.mjs` uses `no-restricted-imports` to stop the sections from
reaching into each other:

- `(website)` may not import from `(dashboard)`, `api`, the editor, or `@/store`.
- `(dashboard)` may not import from `(website)` or `api`.
- `api` may not import pages, components, or stores. Route handlers stay
  server-only.
- `src/lib`, `src/components` and `src/store` may not import from `src/app`.

Code that two sections need goes in `src/lib` (logic) or `src/components` (UI).
With the boundaries held, any surface can later move into its own app (for
example a monorepo with `apps/website`, `apps/dashboard`, `apps/api` and
`packages/core`) without untangling imports.

## API versioning

- **Public contract:** `https://api.nayroz.com/v1/...`. The paths are the
  route folders under `src/app/api` without the `/api` prefix, for example
  `src/app/api/mobile/templates` serves `/v1/mobile/templates`.
- **Spec:** `GET /v1/mobile/openapi` returns the spec in that form, with
  servers `<host>/v1`. `/api/mobile/openapi` stays unversioned, for the
  dashboard's Swagger page.
- **Handlers:** the proxy sets `x-nayroz-api-version: v1` on versioned requests
  and strips any client-sent copy. A handler that needs the version reads it
  from there.
- **Request signing:** checked against the path the client called, so the app
  signs `/v1/mobile/...`.
- **Adding v2:** put the changed routes under `src/app/api/v2/...` and add
  `v2: "/api/v2"` to `API_VERSIONS`. v1 keeps working.

## Mobile app

| Build                                     | API base URL                                          |
| ----------------------------------------- | ----------------------------------------------------- |
| Debug (Android + iOS)                     | local dev server (`templateBackendBaseUrl` / Debug.xcconfig) |
| Android release (`assembleRelease`/`bundleRelease`) | `templateBackendReleaseBaseUrl`, default `https://api.nayroz.com` |
| iOS Release / archive                     | `RELEASE_BACKEND_HOST`, default `api.nayroz.com`      |

The app calls the versioned API. Every Backend*Api path in the KMP app is built on
`MobileApiRoutes.BASE` (`/v1/mobile`, in `shared/.../core/network/MobileApiRoutes.kt`), so the
version is set in one place. FILE URLs keep the server's unversioned `/api/...` form: font files
(`getFontFileUrl`), template layer assets, shapes, and `/api/storage/public`. The reason is that
some are stored in designs, and `DesignPortableJson` recognises `/api/...` as a portable backend
ref.

Share links stay on `https://nayroz.com/t/<ref>`. The Android manifest and iOS
entitlements already claim `nayroz.com` and `www.nayroz.com`.

## Go-live checklist (when the server exists)

The stack is `docker-compose.yml` with `docker-compose.prod.yml` layered on top. What the
override does:

- **Caddy** (`Caddyfile`) terminates TLS for the four names and forwards everything to Next with
  the original `Host`. It gets and renews Let's Encrypt certificates on its own. Certificates
  live on the `caddy_data` volume, so they survive rebuilds.
- **Nothing else is published.** Next's `:3000` and Postgres stay internal. A request by the
  server's bare IP would otherwise reach the all-in-one mode.
- **Secrets** come from `.env.production` (template: `.env.production.example`). The local
  dummy environment is reset. `.env*` files are gitignored and dockerignored, so they never
  land in an image layer.
- **Settings the override sets for you:** `NEXT_PUBLIC_APP_URL=https://admin.nayroz.com` and
  `AUTH_TRUST_HOST=true`. Without `AUTH_TRUST_HOST`, NextAuth's sign-in links point at
  `localhost:3000` (the website).

1. DNS: point the A/AAAA records for `nayroz.com`, `www`, `admin` and `api` at the server. Do
   this before the first `up`, because Caddy can only get certificates for names that already
   resolve to it.
2. Open ports 80 and 443 (TCP, plus 443/UDP for HTTP/3) to the server.
3. On the server:
   ```bash
   cp .env.production.example .env.production   # fill in every value
   IOS_TEAM_ID=<Apple Team ID> docker compose -f docker-compose.yml -f docker-compose.prod.yml build
   docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm web npx prisma migrate deploy
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```
   `IOS_TEAM_ID` is a build argument. The `apple-app-site-association` route is force-static,
   so the value is baked in when the image is built.
   Tested locally on 2026-11-16 with the same image behind Caddy on `:8080`: all three surfaces,
   the redirects, and NextAuth on `admin.localhost:8080` work. Run it yourself with
   `docker compose up -d` (stop `next dev` first, or reset the web service's `3000:3000` port).
4. If you use another reverse proxy instead of Caddy, it must pass the original `Host` header
   through (nginx: `proxy_set_header Host $host;`), and it must answer only the four names.
5. Google OAuth client: add `https://admin.nayroz.com` to the authorised
   origins, and add the NextAuth callback under `admin.nayroz.com` to the
   redirect URIs, if the dashboard uses Google sign-in.
6. Firebase: add the authorised domains `nayroz.com` and `admin.nayroz.com`.
7. App Store Server Notifications and Google Play RTDN: point them at
   `https://api.nayroz.com/v1/webhooks/appstore` and `…/playstore`.
8. Canva importer extension: set the dashboard URL in its popup to
   `https://admin.nayroz.com`.
9. Check:
   - `curl https://nayroz.com/.well-known/apple-app-site-association` and
     `…/assetlinks.json` both return 200 JSON with no redirect.
   - `curl https://api.nayroz.com/v1/health` returns 200.
   - `https://admin.nayroz.com/t/x` redirects to `nayroz.com`.
