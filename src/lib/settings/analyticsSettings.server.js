import prisma from "@/lib/prisma";

// Google Analytics / Looker Studio configuration, stored in AppSetting like the
// other integration settings (see pushSettings.server.js).
//
// The report URL is rendered as an <iframe src> on /analytics, so it is
// validated against a host allowlist here rather than at the render site — a
// pasted `javascript:` or attacker-controlled URL must never reach the frame.
const ANALYTICS_SETTINGS_KEY = "analytics_ga_settings_v1";

// Looker Studio kept the legacy datastudio.google.com host alive for older
// reports; both serve the same /embed/reporting paths.
const LOOKER_HOSTS = new Set(["lookerstudio.google.com", "datastudio.google.com"]);

// GA4 measurement IDs are G- followed by an alphanumeric property suffix.
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

// The GA4 property the native tiles query through the Data API. Stored rather
// than hardcoded, but defaulted so a fresh install works without setup.
const DEFAULT_PROPERTY_ID = "531571754";

function sanitizeString(value) {
  return String(value || "").trim();
}

function maskSecret(value) {
  const source = sanitizeString(value);
  if (!source) return "";
  if (source.length <= 16) return "*".repeat(8);
  return `${source.slice(0, 6)}${"*".repeat(10)}${source.slice(-6)}`;
}

/**
 * Validate a GA4 numeric property ID. Returns "" for empty input.
 */
export function normalizePropertyId(raw) {
  const source = sanitizeString(raw).replace(/^properties\//, "");
  if (!source) return "";
  if (!/^\d{6,20}$/.test(source)) {
    throw new Error("Property ID must be the numeric GA4 property ID, e.g. 531571754.");
  }
  return source;
}

/**
 * Validate a pasted Looker Studio URL and normalize it to its embeddable form.
 *
 * Accepts what the Looker Studio UI actually hands you — the "share" URL
 * (/reporting/<id>/page/<p>), the "embed" URL (/embed/reporting/...), and
 * multi-account URLs (/u/0/reporting/...) — and returns the /embed/ variant.
 * Returns "" for empty input; throws a user-facing Error for anything else.
 */
export function normalizeLookerEmbedUrl(raw) {
  const source = sanitizeString(raw);
  if (!source) return "";

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Report URL must be a full URL, e.g. https://lookerstudio.google.com/reporting/…");
  }

  if (url.protocol !== "https:") {
    throw new Error("Report URL must use https.");
  }
  if (url.username || url.password) {
    throw new Error("Report URL must not contain credentials.");
  }
  if (!LOOKER_HOSTS.has(url.hostname)) {
    throw new Error("Report URL must be a Looker Studio link (lookerstudio.google.com).");
  }

  // Drop a leading /u/<n> account selector, then require a reporting path.
  const path = url.pathname.replace(/^\/u\/\d+/, "");
  const reportPath = path.startsWith("/embed/reporting/")
    ? path
    : path.startsWith("/reporting/")
      ? `/embed${path}`
      : null;

  if (!reportPath || reportPath === "/embed/reporting/") {
    throw new Error("Report URL must point to a Looker Studio report (/reporting/<report-id>).");
  }

  // Rebuild from validated parts so nothing else (hash, auth, port) survives.
  // The query string is preserved because Looker passes report parameters there.
  return `https://${url.hostname}${reportPath}${url.search}`;
}

/**
 * Validate a GA4 measurement ID. Returns "" for empty input; throws otherwise.
 */
export function normalizeMeasurementId(raw) {
  const source = sanitizeString(raw).toUpperCase();
  if (!source) return "";
  if (!MEASUREMENT_ID_PATTERN.test(source)) {
    throw new Error("Measurement ID must look like G-XXXXXXXXXX.");
  }
  return source;
}

function normalizeStoredSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const sa = source.serviceAccount && typeof source.serviceAccount === "object"
    ? source.serviceAccount
    : {};
  return {
    // Stored values were validated on write; re-running the parsers here would
    // throw on legacy rows, so only trim.
    reportUrl: sanitizeString(source.reportUrl),
    measurementId: sanitizeString(source.measurementId),
    propertyId: sanitizeString(source.propertyId) || DEFAULT_PROPERTY_ID,
    serviceAccount: {
      projectId: sanitizeString(sa.projectId),
      clientEmail: sanitizeString(sa.clientEmail),
      privateKey: sanitizeString(sa.privateKey),
    },
    updatedAt: sanitizeString(source.updatedAt),
  };
}

export async function getAnalyticsSettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: ANALYTICS_SETTINGS_KEY },
      select: { value: true },
    });
    if (!record?.value) {
      return normalizeStoredSettings();
    }
    return normalizeStoredSettings(record.value);
  } catch {
    return normalizeStoredSettings();
  }
}

export function isAnalyticsConfigured(settings) {
  return Boolean(normalizeStoredSettings(settings).reportUrl);
}

export function toPublicAnalyticsSettings(settings) {
  const normalized = normalizeStoredSettings(settings);
  return {
    configured: isAnalyticsConfigured(normalized),
    reportUrl: normalized.reportUrl,
    measurementId: normalized.measurementId,
    propertyId: normalized.propertyId,
    // The private key never leaves the server.
    serviceAccountEmail: normalized.serviceAccount.clientEmail,
    serviceAccountConfigured: Boolean(normalized.serviceAccount.privateKey),
    serviceAccountMasked: maskSecret(normalized.serviceAccount.privateKey),
    updatedAt: normalized.updatedAt,
  };
}

/**
 * Resolve the credentials the GA4 Data API should authenticate with.
 *
 * Falls back to the Firebase/FCM service account when analytics has none of its
 * own: both live in the same Google Cloud project (`nayroz`), which is also the
 * project the GA4 property is linked to, so one key can serve both. Keeping the
 * fallback means the tiles work without asking anyone to mint a second key.
 *
 * Returns null when nothing is configured.
 */
export async function getAnalyticsCredentials() {
  const settings = await getAnalyticsSettings();
  const own = settings.serviceAccount;
  if (own.clientEmail && own.privateKey) {
    return {
      clientEmail: own.clientEmail,
      privateKey: own.privateKey,
      source: "analytics",
    };
  }

  const { getPushSettings } = await import("@/lib/settings/pushSettings.server");
  const push = await getPushSettings();
  if (push.serviceAccount.clientEmail && push.serviceAccount.privateKey) {
    return {
      clientEmail: push.serviceAccount.clientEmail,
      privateKey: push.serviceAccount.privateKey,
      source: "firebase",
    };
  }

  return null;
}

/**
 * Persist analytics settings. Fields absent from `input` keep their current
 * value; pass an empty string to clear one.
 */
export async function saveAnalyticsSettings(input = {}) {
  const current = await getAnalyticsSettings();

  const reportUrl =
    input.reportUrl === undefined
      ? current.reportUrl
      : normalizeLookerEmbedUrl(input.reportUrl);
  const measurementId =
    input.measurementId === undefined
      ? current.measurementId
      : normalizeMeasurementId(input.measurementId);
  const propertyId =
    input.propertyId === undefined
      ? current.propertyId
      : normalizePropertyId(input.propertyId) || DEFAULT_PROPERTY_ID;

  let serviceAccount = current.serviceAccount;
  if (input.serviceAccountJson) {
    const { parseServiceAccountJson } = await import("@/lib/settings/pushSettings.server");
    serviceAccount = parseServiceAccountJson(input.serviceAccountJson);
  }

  const next = {
    reportUrl,
    measurementId,
    propertyId,
    serviceAccount,
    updatedAt: new Date().toISOString(),
  };

  await prisma.appSetting.upsert({
    where: { key: ANALYTICS_SETTINGS_KEY },
    create: { key: ANALYTICS_SETTINGS_KEY, value: next },
    update: { value: next },
  });

  return next;
}
