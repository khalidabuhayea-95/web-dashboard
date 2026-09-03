// Store-integration credentials and knobs. These are deploy-time server-to-server
// secrets (like R2/Replicate), set once by whoever owns the store accounts — not
// admin-editable settings, so they live in env rather than AppSetting.
//
// Apple (App Store Server API + notification verification):
//   APPLE_IAP_ISSUER_ID    App Store Connect → Users & Access → Integrations
//   APPLE_IAP_KEY_ID       id of the In-App Purchase key
//   APPLE_IAP_PRIVATE_KEY  the .p8 content (literal newlines or \n escapes)
//   APPLE_BUNDLE_ID        defaults to com.nayroz.ios
//   APPLE_APP_APPLE_ID     numeric Apple id of the app — required in production
//   APPLE_IAP_ENVIRONMENT  production | sandbox | xcode   (default sandbox;
//                          "xcode" accepts StoreKit-test-signed transactions and
//                          exists for the simulator dev lane — NEVER production)
//
// Google (Play Developer API + RTDN):
//   PLAY_PACKAGE_NAME          defaults to com.nayroz.android
//   PLAY_SERVICE_ACCOUNT_JSON  service-account key JSON (raw or base64)
//   PLAY_RTDN_AUTH             shared token the Pub/Sub push endpoint requires
//
// Entitlement policy:
//   ALLOW_SANDBOX_ENTITLEMENTS "1" lets sandbox/xcode purchases flip real user
//                              tiers (dev/staging only).

export type AppleIapEnvironment = "production" | "sandbox" | "xcode";

function readTrimmed(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function appleBundleId(): string {
  return readTrimmed("APPLE_BUNDLE_ID") || "com.nayroz.ios";
}

export function appleEnvironment(): AppleIapEnvironment {
  const value = readTrimmed("APPLE_IAP_ENVIRONMENT").toLowerCase();
  if (value === "production" || value === "xcode") return value;
  return "sandbox";
}

export function appleAppAppleId(): number | undefined {
  const value = Number(readTrimmed("APPLE_APP_APPLE_ID"));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export type AppleApiCredentials = { issuerId: string; keyId: string; privateKeyPem: string };

/** Null when the App Store Server API key is not configured (dev without ASC). */
export function appleApiCredentials(): AppleApiCredentials | null {
  const issuerId = readTrimmed("APPLE_IAP_ISSUER_ID");
  const keyId = readTrimmed("APPLE_IAP_KEY_ID");
  // .p8 files pasted into env usually arrive with \n escapes — restore them.
  const privateKeyPem = readTrimmed("APPLE_IAP_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!issuerId || !keyId || !privateKeyPem) return null;
  return { issuerId, keyId, privateKeyPem };
}

export function playPackageName(): string {
  return readTrimmed("PLAY_PACKAGE_NAME") || "com.nayroz.android";
}

export type PlayServiceAccount = { client_email: string; private_key: string };

/** Null when the Play service account is not configured. Accepts raw or base64 JSON. */
export function playServiceAccount(): PlayServiceAccount | null {
  const value = readTrimmed("PLAY_SERVICE_ACCOUNT_JSON");
  if (!value) return null;
  const candidates = [value];
  if (!value.startsWith("{")) {
    try {
      candidates.unshift(Buffer.from(value, "base64").toString("utf8"));
    } catch {
      // fall through to raw parse
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
        return { client_email: parsed.client_email, private_key: parsed.private_key };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function playRtdnAuthToken(): string {
  return readTrimmed("PLAY_RTDN_AUTH");
}

export function allowSandboxEntitlements(): boolean {
  return readTrimmed("ALLOW_SANDBOX_ENTITLEMENTS") === "1";
}
