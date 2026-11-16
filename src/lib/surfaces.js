/**
 * The three surfaces of the Nayroz web project, and which hostname serves which.
 *
 *   website    nayroz.com        marketing site (public/website), share pages (/t), .well-known
 *   dashboard  admin.nayroz.com  the admin console + editor, and its same-origin /api calls
 *   api        api.nayroz.com    the public API: the mobile app, store webhooks, health
 *
 * They are one Next.js build. `src/proxy.js` asks `routeRequest()` what to do with each request
 * and this file is the single source of truth for that decision, so the split can be read (and
 * tested) in one place. Folder layout mirrors it: `src/app/(website)`, `src/app/(dashboard)`,
 * `src/app/api`, with shared code in `src/lib` and `src/components`.
 *
 * Scaling: every instance can serve every surface, or only some — set `NAYROZ_SURFACES=api` on
 * the instances behind api.nayroz.com and they answer 404 for anything else. Same build, scaled
 * per surface.
 *
 * Locally it mirrors production: localhost:3000 (or nayroz.localhost:3000) is the website,
 * admin.localhost:3000 the dashboard, api.localhost:3000 the API. A hostname that matches no
 * surface (127.0.0.1, a LAN IP the phone uses, the server's own IP) gets the all-in-one
 * behaviour: dashboard at `/`, API at `/api` and `/v1`, website files at their root URLs.
 *
 * Pure: no Next.js imports, so it is unit-tested directly (surfaces.test.js).
 */

export const SURFACES = Object.freeze(["website", "dashboard", "api"]);

/** Folder under `public/` that holds the static marketing site. */
export const WEBSITE_PUBLIC_DIR = "website";

/** Page served for `/` on the website host. */
export const WEBSITE_INDEX = "landing.html";

// `localhost` is the website, exactly like nayroz.com — the dashboard is admin.localhost and the
// API api.localhost. IP hosts (127.0.0.1, a LAN IP the phone uses) stay all-in-one.
const DEFAULT_HOSTS = Object.freeze({
  website: ["nayroz.com", "www.nayroz.com", "localhost", "nayroz.localhost", "www.localhost"],
  dashboard: ["admin.nayroz.com", "admin.localhost"],
  api: ["api.nayroz.com", "api.localhost"],
});

const DEFAULT_ORIGINS = Object.freeze({
  website: "https://nayroz.com",
  dashboard: "https://admin.nayroz.com",
  api: "https://api.nayroz.com",
});

const ENV_KEYS = Object.freeze({
  website: { hosts: "WEBSITE_HOSTS", origin: "WEBSITE_ORIGIN" },
  dashboard: { hosts: "DASHBOARD_HOSTS", origin: "DASHBOARD_ORIGIN" },
  api: { hosts: "API_HOSTS", origin: "API_ORIGIN" },
});

/** Paths every host serves: framework assets, the brand kit, root metadata icons. */
const SHARED_PREFIXES = ["/_next/", "/brand/"];
const SHARED_PATHS = new Set(["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest"]);

/** API routes the public API host exposes. Everything else under /api is the dashboard's. */
const PUBLIC_API_PREFIXES = ["/api/mobile/", "/api/webhooks/", "/api/health", "/api/storage/public"];

/**
 * Public API versions: `/<version>/<rest>` on the API host is served by `<base>/<rest>`.
 * The documented contract is `https://api.nayroz.com/v1/...` (e.g. /v1/mobile/templates).
 * A future v2 maps to its own route folder (e.g. `v2: "/api/v2"`) while v1 keeps working.
 *
 * The unversioned `/api/...` paths in PUBLIC_API_PREFIXES stay reachable on the API host too:
 * they are the file URLs the server itself puts in payloads (font files, template assets,
 * shapes, /api/storage/public), some of them stored — addresses, not the versioned contract.
 */
export const API_VERSIONS = Object.freeze({ v1: "/api" });
export const CURRENT_API_VERSION = "v1";

/** Request header the proxy sets on a versioned rewrite, so a handler knows which version was asked. */
export const API_VERSION_HEADER = "x-nayroz-api-version";

/** API routes the website calls from the browser (same-origin). */
const WEBSITE_API_PREFIXES = ["/api/contact"];

const DISALLOW_ALL_ROBOTS = "User-agent: *\nDisallow: /\n";

function list(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function trimOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function startsWithAny(pathname, prefixes) {
  return prefixes.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix));
}

/**
 * Resolved configuration from the environment (defaults = the production domains).
 * @returns {{ hosts: Record<string, string[]>, origins: Record<string, string>, enabled: Set<string> }}
 */
export function readSurfaceConfig(env = process.env) {
  /** @type {Record<string, string[]>} */
  const hosts = {};
  /** @type {Record<string, string>} */
  const origins = {};
  for (const surface of SURFACES) {
    const keys = ENV_KEYS[surface];
    const fromEnv = list(env[keys.hosts]);
    hosts[surface] = fromEnv.length ? fromEnv : [...DEFAULT_HOSTS[surface]];
    origins[surface] = trimOrigin(env[keys.origin]) || DEFAULT_ORIGINS[surface];
  }
  const enabledList = list(env.NAYROZ_SURFACES).filter((surface) => SURFACES.includes(surface));
  return {
    hosts,
    origins,
    enabled: new Set(enabledList.length ? enabledList : SURFACES),
  };
}

/** Hostname (no port, lower-case) from a Host header value. */
export function normalizeHost(hostHeader) {
  const raw = String(hostHeader || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) return raw.slice(0, raw.indexOf("]") + 1); // IPv6 literal
  return raw.split(":")[0];
}

/** Which surface a hostname belongs to, or null for an unknown host (all-in-one mode). */
export function surfaceForHost(hostname, config = readSurfaceConfig()) {
  const host = normalizeHost(hostname);
  for (const surface of SURFACES) {
    if (config.hosts[surface].includes(host)) return surface;
  }
  return null;
}

/**
 * Public origin of a surface, for redirects and absolute links. On a localhost dev host it
 * stays local (admin.localhost:8080 → nayroz.localhost:8080) instead of jumping to production.
 *
 * Decided from the Host header the client sent — never from the request URL: behind a reverse
 * proxy (Caddy) Next sees its own internal URL (http://localhost:3000/…), which would make every
 * production request look like a dev one. Never bare `localhost` either: Next.js rewrites a
 * redirect to localhost onto the request's own host, which would loop.
 *
 * @param {string} surface
 * @param {string} [hostHeader] Host the client used, e.g. "admin.localhost:8080".
 * @param {string} [protocol] "http:" / "https:" — only used for the local dev origin.
 */
export function originForSurface(surface, hostHeader, config = readSurfaceConfig(), protocol = "http:") {
  const raw = String(hostHeader || "").trim().toLowerCase();
  if (raw) {
    const hostname = normalizeHost(raw);
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      const port = raw.startsWith("[") ? "" : raw.split(":")[1] || "";
      const devHost = config.hosts[surface].find((host) => host.endsWith(".localhost"));
      if (devHost) return `${protocol}//${devHost}${port ? `:${port}` : ""}`;
    }
  }
  return config.origins[surface];
}

/** True when the first path segment names a file or folder of the static website. */
export function isWebsiteFilePath(pathname, websiteFiles) {
  const first = decodeURIComponent(pathname.split("/")[1] || "");
  return Boolean(first) && websiteFiles.has(first);
}

/** True for paths that belong to the website surface wherever they are requested. */
export function isWebsitePath(pathname, websiteFiles) {
  return (
    pathname === "/t" ||
    pathname.startsWith("/t/") ||
    pathname.startsWith("/.well-known/") ||
    isWebsiteFilePath(pathname, websiteFiles)
  );
}

function isSharedPath(pathname) {
  return SHARED_PATHS.has(pathname) || startsWithAny(pathname, SHARED_PREFIXES);
}

/**
 * Resolves a versioned public API path: `/v1/mobile/templates` → `/api/mobile/templates`.
 * Null when the path is not versioned, names an unknown version, or is not a public API route.
 */
export function resolveVersionedApiPath(pathname) {
  const match = /^\/(v\d+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const [, version, rest = "/"] = match;
  const base = API_VERSIONS[version];
  if (!base) return null;
  const target = `${base}${rest}`;
  if (!startsWithAny(target, PUBLIC_API_PREFIXES)) return null;
  return { version, pathname: target };
}

/** The surface a path belongs to when the host does not say (all-in-one mode). */
export function surfaceForPath(pathname, websiteFiles) {
  if (isWebsitePath(pathname, websiteFiles) || startsWithAny(pathname, WEBSITE_API_PREFIXES)) return "website";
  if (startsWithAny(pathname, PUBLIC_API_PREFIXES) || resolveVersionedApiPath(pathname)) return "api";
  return "dashboard";
}

function versionedRewrite(versioned) {
  return { type: "rewrite", pathname: versioned.pathname, apiVersion: versioned.version };
}

const websiteRewrite = (pathname) => ({
  type: "rewrite",
  pathname: `/${WEBSITE_PUBLIC_DIR}${pathname === "/" ? `/${WEBSITE_INDEX}` : pathname}`,
});

const notFound = (json) => ({ type: "not-found", json });

/**
 * Decides what to do with one request.
 *
 * @param {{ url: string, host: string, websiteFiles: Set<string>, config?: object }} input
 *   `url` is the full request URL, `host` the Host header, `websiteFiles` the top-level entries
 *   of public/website.
 * @returns one of
 *   { type: "next" }                        serve as routed
 *   { type: "rewrite", pathname }           serve another path, URL bar unchanged
 *   { type: "redirect", location, status }  send the browser to another surface
 *   { type: "text", body, contentType }     answer directly (robots.txt, API index)
 *   { type: "not-found", json }             404 (json=true on the API host)
 *   plus `surface` — the surface that answered, or null for shared assets.
 */
export function routeRequest({ url, host, websiteFiles, config = readSurfaceConfig() }) {
  const requestUrl = new URL(url);
  const { pathname } = requestUrl;
  const hostSurface = surfaceForHost(host, config);

  if (isSharedPath(pathname)) return { type: "next", surface: null };

  // ---- all-in-one mode (unknown host): everything, website files at their root URLs ----
  if (!hostSurface) {
    const surface = surfaceForPath(pathname, websiteFiles);
    if (!config.enabled.has(surface)) return { ...notFound(surface === "api"), surface };
    if (isWebsiteFilePath(pathname, websiteFiles)) return { ...websiteRewrite(pathname), surface };
    const versioned = resolveVersionedApiPath(pathname);
    if (versioned) return { ...versionedRewrite(versioned), surface };
    return { type: "next", surface };
  }

  if (!config.enabled.has(hostSurface)) return { ...notFound(hostSurface === "api"), surface: hostSurface };

  // ---- website: nayroz.com ----
  if (hostSurface === "website") {
    const hostname = normalizeHost(host);
    // www → apex, except .well-known: Apple fetches apple-app-site-association from every
    // associated domain (the app lists www too) and does not follow redirects.
    if (hostname.startsWith("www.") && !pathname.startsWith("/.well-known/")) {
      const target = new URL(requestUrl.pathname + requestUrl.search, originForSurface("website", host, config, requestUrl.protocol));
      return { type: "redirect", location: target.toString(), status: 308, surface: "website" };
    }
    if (
      pathname === "/t" ||
      pathname.startsWith("/t/") ||
      pathname.startsWith("/.well-known/") ||
      startsWithAny(pathname, WEBSITE_API_PREFIXES)
    ) {
      return { type: "next", surface: "website" };
    }
    // Everything else is the static site; a path it does not have 404s there.
    return { ...websiteRewrite(pathname), surface: "website" };
  }

  // ---- dashboard: admin.nayroz.com ----
  if (hostSurface === "dashboard") {
    if (pathname === "/robots.txt") {
      return { type: "text", body: DISALLOW_ALL_ROBOTS, contentType: "text/plain", surface: "dashboard" };
    }
    if (isWebsitePath(pathname, websiteFiles)) {
      const target = new URL(requestUrl.pathname + requestUrl.search, originForSurface("website", host, config, requestUrl.protocol));
      return { type: "redirect", location: target.toString(), status: 308, surface: "dashboard" };
    }
    // The dashboard's own pages and every /api route it calls same-origin.
    return { type: "next", surface: "dashboard" };
  }

  // ---- api: api.nayroz.com ----
  if (pathname === "/robots.txt") {
    return { type: "text", body: DISALLOW_ALL_ROBOTS, contentType: "text/plain", surface: "api" };
  }
  if (pathname === "/") {
    const base = `/${CURRENT_API_VERSION}`;
    return {
      type: "text",
      body: JSON.stringify({
        service: "nayroz-api",
        version: CURRENT_API_VERSION,
        base,
        health: `${base}/health`,
        openapi: `${base}/mobile/openapi`,
      }),
      contentType: "application/json",
      surface: "api",
    };
  }
  const versioned = resolveVersionedApiPath(pathname);
  if (versioned) return { ...versionedRewrite(versioned), surface: "api" };
  if (startsWithAny(pathname, PUBLIC_API_PREFIXES)) return { type: "next", surface: "api" };
  return { ...notFound(true), surface: "api" };
}

/** Every host this deployment answers on, e.g. for "is this URL ours?" checks. */
export function allSurfaceHosts(config = readSurfaceConfig()) {
  return SURFACES.flatMap((surface) => config.hosts[surface]);
}
