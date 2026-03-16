import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { buildMobileOpenApiSpec } from "../src/lib/mobile/openapi.js";

const ROOT = process.cwd();
const MOBILE_API_DIR = path.join(ROOT, "src", "app", "api", "mobile");
const OPENAPI_ROUTE_PATH = "/api/mobile/openapi";
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function normalizePathKey(value) {
  return String(value || "")
    .trim()
    .replace(/\/+/g, "/")
    .replace(/\{[^/]+\}/g, ":param")
    .replace(/\/:param(?=\/|$)/g, "/:param")
    .replace(/\/$/, "");
}

function toOpenApiPathFromRouteFile(filePath) {
  const relative = path.relative(MOBILE_API_DIR, filePath).replace(/\\/g, "/");
  const withoutRouteFile = relative.replace(/\/route\.js$/, "");
  const segments = withoutRouteFile
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith("[[...") && segment.endsWith("]]")) {
        const key = segment.slice(5, -2).trim() || "param";
        return `{${key}}`;
      }
      if (segment.startsWith("[...") && segment.endsWith("]")) {
        const key = segment.slice(4, -1).trim() || "param";
        return `{${key}}`;
      }
      if (segment.startsWith("[") && segment.endsWith("]")) {
        const key = segment.slice(1, -1).trim() || "param";
        return `{${key}}`;
      }
      return segment;
    });

  return `/api/mobile${segments.length > 0 ? `/${segments.join("/")}` : ""}`;
}

async function walk(dirPath, files = []) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name === "route.js") {
      files.push(fullPath);
    }
  }
  return files;
}

async function extractRouteMethods(filePath) {
  const source = await readFile(filePath, "utf8");
  const regex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  const methods = new Set();
  let match = regex.exec(source);
  while (match) {
    methods.add(String(match[1] || "").toLowerCase());
    match = regex.exec(source);
  }
  return methods;
}

async function buildExpectedRoutes() {
  const routeFiles = await walk(MOBILE_API_DIR);
  const expected = new Map();

  for (const routeFile of routeFiles) {
    const apiPath = toOpenApiPathFromRouteFile(routeFile);
    if (normalizePathKey(apiPath) === normalizePathKey(OPENAPI_ROUTE_PATH)) {
      continue;
    }
    const methods = await extractRouteMethods(routeFile);
    if (methods.size === 0) {
      continue;
    }
    const normalized = normalizePathKey(apiPath);
    const current = expected.get(normalized) || { path: apiPath, methods: new Set() };
    methods.forEach((method) => current.methods.add(method));
    expected.set(normalized, current);
  }

  return expected;
}

function buildDocumentedRoutes(spec) {
  const documented = new Map();
  const paths = spec?.paths && typeof spec.paths === "object" ? spec.paths : {};
  for (const [rawPath, definition] of Object.entries(paths)) {
    const normalized = normalizePathKey(rawPath);
    const methodKeys = Object.keys(definition || {}).filter((key) =>
      HTTP_METHODS.has(String(key || "").toLowerCase())
    );
    documented.set(normalized, {
      path: rawPath,
      methods: new Set(methodKeys.map((value) => value.toLowerCase())),
    });
  }
  return documented;
}

async function main() {
  const expectedRoutes = await buildExpectedRoutes();
  const spec = buildMobileOpenApiSpec("http://127.0.0.1:3000");
  const documentedRoutes = buildDocumentedRoutes(spec);

  const missingPaths = [];
  const missingMethods = [];

  for (const [normalized, expected] of expectedRoutes.entries()) {
    const documented = documentedRoutes.get(normalized);
    if (!documented) {
      missingPaths.push(expected.path);
      continue;
    }
    for (const method of expected.methods) {
      if (!documented.methods.has(method)) {
        missingMethods.push(`${method.toUpperCase()} ${expected.path}`);
      }
    }
  }

  if (missingPaths.length === 0 && missingMethods.length === 0) {
    console.log("Mobile OpenAPI coverage check passed.");
    process.exit(0);
  }

  if (missingPaths.length > 0) {
    console.error("Missing OpenAPI paths for mobile routes:");
    missingPaths.sort().forEach((item) => console.error(`  - ${item}`));
  }
  if (missingMethods.length > 0) {
    console.error("Missing OpenAPI methods for mobile routes:");
    missingMethods.sort().forEach((item) => console.error(`  - ${item}`));
  }

  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OpenAPI coverage check failed: ${message}`);
  process.exit(1);
});
