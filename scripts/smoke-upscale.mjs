#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [, , imageArg, scaleArg = "2", outputArg = "/tmp/upscale-result.png", originArg = "http://127.0.0.1:3000"] =
  process.argv;

function usage() {
  console.error(
    "Usage: node scripts/smoke-upscale.mjs <image-path> [scale=2|4] [output-path] [origin]"
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

function buildBearerAuthHeader(env) {
  const token = process.env.MOBILE_SMOKE_BEARER_TOKEN || env.MOBILE_SMOKE_BEARER_TOKEN;
  if (!token) {
    console.warn(
      "Warning: no MOBILE_SMOKE_BEARER_TOKEN set. This route now requires a logged-in user and will return 401."
    );
    return {};
  }
  return { authorization: `Bearer ${token}` };
}

async function main() {
  if (!imageArg) {
    usage();
    process.exit(1);
  }

  const imagePath = path.resolve(process.cwd(), imageArg);
  const outputPath = path.resolve(process.cwd(), outputArg);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const origin = new URL(originArg).origin;
  const env = loadLocalEnv();

  const requestPath = "/api/mobile/media/upscale";
  const requestHeaders = buildBearerAuthHeader(env);
  const formData = new FormData();
  formData.set("image", new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));
  formData.set("scale", String(scaleArg));

  console.log(`Calling upscale route against ${origin}${requestPath} (scale=${scaleArg})`);
  const createResponse = await fetch(`${origin}${requestPath}`, {
    method: "POST",
    headers: requestHeaders,
    body: formData,
  });
  if (!createResponse.ok) {
    const errorPayload = await createResponse.json().catch(() => ({}));
    console.log(JSON.stringify(errorPayload, null, 2));
    throw new Error(errorPayload?.error || `Image upscale request failed (${createResponse.status}).`);
  }

  const bytes = Buffer.from(await createResponse.arrayBuffer());
  fs.writeFileSync(outputPath, bytes);
  console.log(`Saved upscaled image to ${outputPath}`);
  console.log(`Content-Type: ${createResponse.headers.get("content-type") || ""}`);
  console.log(`X-Output-Width: ${createResponse.headers.get("x-output-width") || ""}`);
  console.log(`X-Output-Height: ${createResponse.headers.get("x-output-height") || ""}`);
  console.log(`X-Upscale-Scale: ${createResponse.headers.get("x-upscale-scale") || ""}`);
  console.log(`X-Upscale-Model: ${createResponse.headers.get("x-upscale-model") || ""}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
