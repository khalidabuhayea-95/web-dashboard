import { getPushMessaging } from "./firebaseAdmin.server";

// Builds and sends FCM messages. Supports all message types:
//  - "notification": visible notification (title/body/image)
//  - "data": data-only / silent (background) payload
//  - "both": notification + data
// with optional Android and APNs (iOS) platform overrides.

const MULTICAST_BATCH = 500;

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function str(value) {
  return String(value ?? "").trim();
}

function clean(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

export function normalizeMessageType(value) {
  return value === "data" ? "data" : value === "both" ? "both" : "notification";
}

/**
 * Build the token/topic-agnostic FCM message body from composer input.
 * input: { messageType, notification:{title,body,image}, data:{}, android:{}, apns:{} }
 */
export function buildFcmMessage(input = {}) {
  const messageType = normalizeMessageType(input.messageType);
  const includeNotification = messageType === "notification" || messageType === "both";
  const includeData = messageType === "data" || messageType === "both";
  const isSilent = messageType === "data";

  const message = {};

  // --- notification ---
  if (includeNotification) {
    const notification = clean({
      title: str(input.notification?.title),
      body: str(input.notification?.body),
      image: str(input.notification?.image) || undefined,
    });
    if (Object.keys(notification).length) message.notification = notification;
  }

  // --- data (string values only, per FCM) ---
  const data = {};
  if (input.data && typeof input.data === "object") {
    for (const [rawKey, rawValue] of Object.entries(input.data)) {
      const key = str(rawKey);
      if (!key) continue;
      data[key] = rawValue == null ? "" : String(rawValue);
    }
  }
  if ((includeData || isSilent) && Object.keys(data).length) {
    message.data = data;
  }

  // --- Android overrides ---
  const a = input.android || {};
  const android = {};
  if (a.priority === "high" || a.priority === "normal") android.priority = a.priority;
  const ttlSeconds = Number(a.ttlSeconds);
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    android.ttl = Math.floor(ttlSeconds) * 1000; // admin SDK expects milliseconds
  }
  if (str(a.collapseKey)) android.collapseKey = str(a.collapseKey);
  if (includeNotification) {
    const androidNotification = clean({
      channelId: str(a.channelId) || undefined,
      sound: str(a.sound) || undefined,
      clickAction: str(a.clickAction) || undefined,
      color: str(a.color) || undefined,
      tag: str(a.tag) || undefined,
      icon: str(a.icon) || undefined,
    });
    if (Object.keys(androidNotification).length) android.notification = androidNotification;
  }
  if (Object.keys(android).length) message.android = android;

  // --- APNs (iOS) overrides ---
  const ap = input.apns || {};
  const aps = {};
  if (str(ap.sound)) aps.sound = str(ap.sound);
  const badge = Number(ap.badge);
  if (Number.isFinite(badge) && badge >= 0) aps.badge = Math.floor(badge);
  if (str(ap.category)) aps.category = str(ap.category);
  if (isSilent || ap.contentAvailable) aps["content-available"] = 1;
  if (Object.keys(aps).length) {
    message.apns = { payload: { aps } };
    if (isSilent) {
      // Proper silent/background push on iOS.
      message.apns.headers = { "apns-push-type": "background", "apns-priority": "5" };
    }
  }

  return message;
}

/**
 * Multicast to device entries ({ token, platform }), batching at 500. Reports
 * invalid tokens, distinct failure reasons, and a per-platform breakdown so the
 * UI can show e.g. "Android 1/1 · iOS 0/1".
 */
export async function sendToTokens(entries, message) {
  const messaging = await getPushMessaging();

  // Dedupe by token, keeping each token's platform.
  const seen = new Set();
  const unique = [];
  for (const entry of entries || []) {
    const token = str(entry?.token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    unique.push({ token, platform: entry?.platform === "ios" ? "ios" : "android" });
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];
  const failuresByCode = new Map();
  const byPlatform = {
    android: { sent: 0, failed: 0, total: 0 },
    ios: { sent: 0, failed: 0, total: 0 },
  };

  for (let i = 0; i < unique.length; i += MULTICAST_BATCH) {
    const batch = unique.slice(i, i + MULTICAST_BATCH);
    const result = await messaging.sendEachForMulticast({
      ...message,
      tokens: batch.map((entry) => entry.token),
    });
    successCount += result.successCount;
    failureCount += result.failureCount;
    // sendEachForMulticast preserves input order, so responses[i] maps to batch[i].
    result.responses.forEach((response, index) => {
      const { token, platform } = batch[index];
      byPlatform[platform].total += 1;
      if (response.success) {
        byPlatform[platform].sent += 1;
        return;
      }
      byPlatform[platform].failed += 1;
      const code = response.error?.code || "messaging/unknown-error";
      if (INVALID_TOKEN_CODES.has(code)) {
        invalidTokens.push(token);
      }
      const existing = failuresByCode.get(code);
      if (existing) {
        existing.count += 1;
      } else {
        failuresByCode.set(code, {
          code,
          message: response.error?.message || "Unknown error.",
          count: 1,
        });
      }
    });
  }

  return {
    successCount,
    failureCount,
    invalidTokens,
    targetCount: unique.length,
    failures: Array.from(failuresByCode.values()),
    byPlatform,
  };
}

/** Send a single message to an FCM topic. */
export async function sendToTopic(topic, message) {
  const messaging = await getPushMessaging();
  const messageId = await messaging.send({ ...message, topic: str(topic) });
  // Topic delivery is platform-agnostic — no per-platform breakdown.
  return {
    successCount: 1,
    failureCount: 0,
    invalidTokens: [],
    targetCount: 1,
    messageId,
    failures: [],
    byPlatform: null,
  };
}

// FCM topic name rules: matches "[a-zA-Z0-9-_.~%]+".
export function isValidTopic(topic) {
  return /^[a-zA-Z0-9-_.~%]+$/.test(str(topic));
}
