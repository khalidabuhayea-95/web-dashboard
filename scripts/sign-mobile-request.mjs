#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [, , method = "GET", routePath = "/api/mobile/templates", search = ""] = process.argv;

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

const localEnv = loadLocalEnv();
const keyId = process.env.MOBILE_API_KEY_ID || localEnv.MOBILE_API_KEY_ID;
const secret =
  process.env.MOBILE_API_SIGNING_SECRET || localEnv.MOBILE_API_SIGNING_SECRET;

if (!keyId || !secret) {
  console.error("Missing MOBILE_API_KEY_ID or MOBILE_API_SIGNING_SECRET");
  process.exit(1);
}

const timestamp = Date.now().toString();
const payload = [method.toUpperCase(), routePath, search, timestamp].join("\n");
const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

console.log(`x-mobile-key: ${keyId}`);
console.log(`x-mobile-ts: ${timestamp}`);
console.log(`x-mobile-sign: ${signature}`);
