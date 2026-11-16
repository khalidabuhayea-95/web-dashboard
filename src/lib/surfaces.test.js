import assert from "node:assert/strict";
import test from "node:test";

import { readSurfaceConfig, resolveVersionedApiPath, routeRequest, surfaceForHost } from "./surfaces.js";

const websiteFiles = new Set(["landing.html", "privacy.html", "site.css", "nayroz-logo-color.svg", "robots.txt"]);
const config = readSurfaceConfig({});

const route = (url, host = new URL(url).host, cfg = config) => routeRequest({ url, host, websiteFiles, config: cfg });

test("hosts map to surfaces; unknown hosts are all-in-one", () => {
  assert.equal(surfaceForHost("nayroz.com", config), "website");
  assert.equal(surfaceForHost("WWW.nayroz.com:443", config), "website");
  assert.equal(surfaceForHost("admin.nayroz.com", config), "dashboard");
  assert.equal(surfaceForHost("api.nayroz.com", config), "api");
  assert.equal(surfaceForHost("admin.localhost:3000", config), "dashboard");
  assert.equal(surfaceForHost("localhost:3000", config), "website");
  assert.equal(surfaceForHost("127.0.0.1:3000", config), null);
  assert.equal(surfaceForHost("192.168.1.13:3000", config), null);
});

test("website host serves the static site at root URLs", () => {
  assert.deepEqual(route("https://nayroz.com/"), { type: "rewrite", pathname: "/website/landing.html", surface: "website" });
  assert.equal(route("https://nayroz.com/privacy.html").pathname, "/website/privacy.html");
  assert.equal(route("https://nayroz.com/robots.txt").pathname, "/website/robots.txt");
  assert.equal(route("https://nayroz.com/templates").pathname, "/website/templates"); // 404 there, not the dashboard
  assert.equal(route("https://nayroz.com/t/summer-sale").type, "next");
  assert.equal(route("https://nayroz.com/.well-known/assetlinks.json").type, "next");
  assert.equal(route("https://nayroz.com/api/contact", "nayroz.com").type, "next");
  assert.equal(route("https://nayroz.com/brand/logo/nayroz-logo-color.svg").type, "next");
});

test("www redirects to the apex, except .well-known (Apple does not follow redirects)", () => {
  const redirect = route("https://www.nayroz.com/privacy.html?x=1");
  assert.equal(redirect.type, "redirect");
  assert.equal(redirect.location, "https://nayroz.com/privacy.html?x=1");
  assert.equal(route("https://www.nayroz.com/.well-known/apple-app-site-association").type, "next");
});

test("dashboard host serves the console and its /api, sends website paths to nayroz.com", () => {
  assert.equal(route("https://admin.nayroz.com/").type, "next");
  assert.equal(route("https://admin.nayroz.com/templates").type, "next");
  assert.equal(route("https://admin.nayroz.com/api/admin/users").type, "next");
  assert.equal(route("https://admin.nayroz.com/api/auth/session").type, "next");
  const share = route("https://admin.nayroz.com/t/abc");
  assert.equal(share.type, "redirect");
  assert.equal(share.location, "https://nayroz.com/t/abc");
  assert.equal(route("https://admin.nayroz.com/landing.html").location, "https://nayroz.com/landing.html");
  assert.match(route("https://admin.nayroz.com/robots.txt").body, /Disallow: \//);
});

test("api host exposes only the public API", () => {
  assert.equal(route("https://api.nayroz.com/api/mobile/templates").type, "next");
  assert.equal(route("https://api.nayroz.com/api/webhooks/appstore").type, "next");
  assert.equal(route("https://api.nayroz.com/api/health").type, "next");
  assert.equal(route("https://api.nayroz.com/api/storage/public?key=a").type, "next");
  assert.deepEqual(route("https://api.nayroz.com/api/admin/users"), { type: "not-found", json: true, surface: "api" });
  assert.equal(route("https://api.nayroz.com/api/auth/session").type, "not-found");
  assert.equal(route("https://api.nayroz.com/templates").type, "not-found");
  assert.equal(route("https://api.nayroz.com/").contentType, "application/json");
});

test("localhost is the website, like nayroz.com", () => {
  assert.deepEqual(route("http://localhost:3000/"), { type: "rewrite", pathname: "/website/landing.html", surface: "website" });
  assert.equal(route("http://localhost:3000/templates").pathname, "/website/templates");
  assert.equal(route("http://localhost:3000/api/mobile/templates").type, "rewrite"); // not the API
  assert.equal(route("http://localhost:3000/t/abc").type, "next");
});

test("IP hosts keep the all-in-one behaviour (phone on LAN, emulator, server IP)", () => {
  assert.equal(route("http://127.0.0.1:3000/").type, "next"); // dashboard home
  assert.equal(route("http://127.0.0.1:3000/api/mobile/templates").type, "next");
  assert.equal(route("http://192.168.1.13:3000/api/mobile/templates").type, "next");
  assert.deepEqual(route("http://192.168.1.13:3000/v1/mobile/templates"), {
    type: "rewrite",
    pathname: "/api/mobile/templates",
    apiVersion: "v1",
    surface: "api",
  });
  assert.deepEqual(route("http://127.0.0.1:3000/landing.html"), { type: "rewrite", pathname: "/website/landing.html", surface: "website" });
  assert.equal(route("http://127.0.0.1:3000/t/abc").type, "next");
});

test("public API is versioned: /v1/<rest> → /api/<rest>", () => {
  assert.deepEqual(resolveVersionedApiPath("/v1/mobile/templates"), { version: "v1", pathname: "/api/mobile/templates" });
  assert.deepEqual(resolveVersionedApiPath("/v1/health"), { version: "v1", pathname: "/api/health" });
  assert.equal(resolveVersionedApiPath("/v2/mobile/templates"), null); // unknown version
  assert.equal(resolveVersionedApiPath("/v1/admin/users"), null); // not public
  assert.equal(resolveVersionedApiPath("/v1/auth/session"), null);
  assert.equal(resolveVersionedApiPath("/mobile/templates"), null);

  assert.deepEqual(route("https://api.nayroz.com/v1/mobile/templates?page=2"), {
    type: "rewrite",
    pathname: "/api/mobile/templates",
    apiVersion: "v1",
    surface: "api",
  });
  assert.equal(route("https://api.nayroz.com/v1/webhooks/appstore").pathname, "/api/webhooks/appstore");
  assert.equal(route("https://api.nayroz.com/v1/admin/users").type, "not-found");
  assert.equal(route("https://api.nayroz.com/v2/mobile/templates").type, "not-found");
  const index = JSON.parse(route("https://api.nayroz.com/").body);
  assert.equal(index.version, "v1");
  assert.equal(index.base, "/v1");
  // /v1 is the API host's contract, not the dashboard's or the website's.
  assert.equal(route("https://admin.nayroz.com/v1/mobile/templates").type, "next"); // → dashboard 404
  assert.equal(route("https://nayroz.com/v1/mobile/templates").pathname, "/website/v1/mobile/templates");
});

test("redirect origin comes from the Host header, not Next's internal URL (behind Caddy)", () => {
  // Behind a reverse proxy Next sees http://localhost:3000/…; the client asked for admin.nayroz.com.
  const behindProxy = routeRequest({ url: "http://localhost:3000/t/abc", host: "admin.nayroz.com", websiteFiles, config });
  assert.equal(behindProxy.location, "https://nayroz.com/t/abc");
  const www = routeRequest({ url: "http://localhost:3000/faq.html", host: "www.nayroz.com", websiteFiles, config });
  assert.equal(www.location, "https://nayroz.com/faq.html");
  // Local stack through Caddy on :8080 keeps the client's port.
  const local = routeRequest({ url: "http://localhost:3000/t/abc", host: "admin.localhost:8080", websiteFiles, config });
  assert.equal(local.location, "http://nayroz.localhost:8080/t/abc");
});

test("dev *.localhost redirects stay local", () => {
  const redirect = route("http://admin.localhost:3000/t/abc");
  assert.equal(redirect.location, "http://nayroz.localhost:3000/t/abc"); // not bare localhost: Next loops it
});

test("NAYROZ_SURFACES restricts an instance to some surfaces", () => {
  const apiOnly = readSurfaceConfig({ NAYROZ_SURFACES: "api" });
  assert.equal(route("https://api.nayroz.com/api/mobile/templates", undefined, apiOnly).type, "next");
  assert.equal(route("https://admin.nayroz.com/templates", undefined, apiOnly).type, "not-found");
  assert.equal(route("https://nayroz.com/", undefined, apiOnly).type, "not-found");
  // all-in-one host: only the api paths
  assert.equal(route("http://10.0.0.5:3000/api/mobile/templates", undefined, apiOnly).type, "next");
  assert.equal(route("http://10.0.0.5:3000/templates", undefined, apiOnly).type, "not-found");
});

test("env overrides hosts and origins", () => {
  const staging = readSurfaceConfig({
    WEBSITE_HOSTS: "staging.nayroz.com",
    DASHBOARD_HOSTS: "admin-staging.nayroz.com",
    WEBSITE_ORIGIN: "https://staging.nayroz.com/",
  });
  assert.equal(surfaceForHost("staging.nayroz.com", staging), "website");
  assert.equal(surfaceForHost("nayroz.com", staging), null);
  const redirect = routeRequest({
    url: "https://admin-staging.nayroz.com/t/x",
    host: "admin-staging.nayroz.com",
    websiteFiles,
    config: staging,
  });
  assert.equal(redirect.location, "https://staging.nayroz.com/t/x");
});
