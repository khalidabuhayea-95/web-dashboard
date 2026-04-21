import { createHash, randomBytes } from "node:crypto";

export function createOpaqueToken(size = 32) {
  return randomBytes(size).toString("base64url");
}

export function hashOpaqueToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}
