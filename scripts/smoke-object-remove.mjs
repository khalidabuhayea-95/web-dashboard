#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [, , imageArg, maskArg, outputArg = "/tmp/object-remove-result.png", originArg = "http://127.0.0.1:3000"] =
  process.argv;

function usage() {
  console.error(
    "Usage: node scripts/smoke-object-remove.mjs <image-path> <mask-path> [output-path] [origin]"
  );
}

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  return content.split("\n").reduce((acc, line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) return acc;
    acc[match[1]] = match[2];
    return acc;
  }, {});
}

function signMobileRequest({ method, routePath, search = "", timestamp, secret }) {
  const payload = [method.toUpperCase(), routePath, search, String(timestamp)].join("\n");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildMobileSigningHeaders(method, routePath, env) {
  const keyId = process.env.MOBILE_API_KEY_ID || env.MOBILE_API_KEY_ID;
  const secret =
    process.env.MOBILE_API_SIGNING_SECRET || env.MOBILE_API_SIGNING_SECRET;
  if (!keyId || !secret) {
    return {};
  }

  const timestamp = Date.now().toString();
  const signature = signMobileRequest({
    method,
    routePath,
    timestamp,
    secret,
  });

  return {
    "x-mobile-key": keyId,
    "x-mobile-ts": timestamp,
    "x-mobile-sign": signature,
  };
}

async function main() {
  if (!imageArg || !maskArg) {
    usage();
    process.exit(1);
  }

  const imagePath = path.resolve(process.cwd(), imageArg);
  const maskPath = path.resolve(process.cwd(), maskArg);
  const outputPath = path.resolve(process.cwd(), outputArg);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }
  if (!fs.existsSync(maskPath)) {
    throw new Error(`Mask file not found: ${maskPath}`);
  }

  const origin = new URL(originArg).origin;
  const env = loadLocalEnv();

  const requestPath = "/api/mobile/media/object-remove";
  const requestHeaders = buildMobileSigningHeaders("POST", requestPath, env);
  const formData = new FormData();
  formData.set(
    "image",
    new Blob([fs.readFileSync(imagePath)]),
    path.basename(imagePath)
  );
  formData.set(
    "mask",
    new Blob([fs.readFileSync(maskPath)]),
    path.basename(maskPath)
  );

  console.log(`Calling object removal route against ${origin}${requestPath}`);
  const createResponse = await fetch(`${origin}${requestPath}`, {
    method: "POST",
    headers: requestHeaders,
    body: formData,
  });
  if (!createResponse.ok) {
    const errorPayload = await createResponse.json().catch(() => ({}));
    console.log(JSON.stringify(errorPayload, null, 2));
    throw new Error(errorPayload?.error || `Object removal request failed (${createResponse.status}).`);
  }

  const bytes = Buffer.from(await createResponse.arrayBuffer());
  fs.writeFileSync(outputPath, bytes);
  console.log(`Saved object-removed image to ${outputPath}`);
  console.log(`Content-Type: ${createResponse.headers.get("content-type") || ""}`);
  console.log(`X-Output-Width: ${createResponse.headers.get("x-output-width") || ""}`);
  console.log(`X-Output-Height: ${createResponse.headers.get("x-output-height") || ""}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
