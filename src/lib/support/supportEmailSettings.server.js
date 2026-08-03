import prisma from "@/lib/prisma";

// SMTP identity used to answer contact messages, stored in AppSetting alongside
// the other integration settings (see analyticsSettings.server.js,
// pushSettings.server.js).
//
// SMTP rather than a vendor HTTP API on purpose: every provider the team might
// pick (Google Workspace, SES, Resend, Mailgun, Zoho) speaks it, so changing
// provider is a settings edit rather than a code change.
//
// The password is write-only over the API — reads return a mask, and saving
// with an empty password keeps whatever is already stored.
const SUPPORT_EMAIL_SETTINGS_KEY = "support_email_settings_v1";

const DEFAULT_PORT = 587;

// Deliberately permissive, matching contactMessageFields.js: enough to reject
// obvious junk without bouncing valid-but-unusual addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const LIMITS = {
  fromName: 120,
  email: 200,
  host: 255,
  username: 255,
  password: 512,
  signature: 2000,
};

function sanitizeString(value) {
  return String(value ?? "").trim();
}

function maskSecret(value) {
  const source = sanitizeString(value);
  if (!source) return "";
  if (source.length <= 8) return "*".repeat(8);
  return `${source.slice(0, 2)}${"*".repeat(8)}${source.slice(-2)}`;
}

/**
 * Validate an address. Returns "" for empty input; throws for anything that is
 * present but malformed, so a typo surfaces at save time rather than as a
 * silent delivery failure days later.
 */
export function normalizeEmail(raw, field = "Email") {
  const source = sanitizeString(raw).toLowerCase().slice(0, LIMITS.email);
  if (!source) return "";
  if (!EMAIL_PATTERN.test(source)) {
    throw new Error(`${field} is not a valid email address.`);
  }
  return source;
}

function normalizePort(raw) {
  if (raw === "" || raw === null || raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP port must be a whole number between 1 and 65535.");
  }
  return port;
}

export function normalizeStoredSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const smtp = source.smtp && typeof source.smtp === "object" ? source.smtp : {};
  const port = Number(smtp.port);

  return {
    enabled: Boolean(source.enabled),
    fromName: sanitizeString(source.fromName).slice(0, LIMITS.fromName),
    fromEmail: sanitizeString(source.fromEmail).toLowerCase().slice(0, LIMITS.email),
    replyToEmail: sanitizeString(source.replyToEmail).toLowerCase().slice(0, LIMITS.email),
    signature: sanitizeString(source.signature).slice(0, LIMITS.signature),
    smtp: {
      host: sanitizeString(smtp.host).slice(0, LIMITS.host),
      port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
      // Implicit TLS (port 465). Anything else starts plaintext and upgrades
      // via STARTTLS, which is what 587 expects.
      secure: Boolean(smtp.secure),
      username: sanitizeString(smtp.username).slice(0, LIMITS.username),
      password: sanitizeString(smtp.password).slice(0, LIMITS.password),
    },
    updatedAt: sanitizeString(source.updatedAt),
  };
}

export async function getSupportEmailSettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: SUPPORT_EMAIL_SETTINGS_KEY },
      select: { value: true },
    });
    return normalizeStoredSettings(record?.value);
  } catch {
    return normalizeStoredSettings();
  }
}

/**
 * True when the settings carry everything needed to actually send.
 * The reply composer is gated on this.
 */
export function isSupportEmailConfigured(settings) {
  const normalized = normalizeStoredSettings(settings);
  return Boolean(
    normalized.enabled &&
      normalized.fromEmail &&
      normalized.smtp.host &&
      normalized.smtp.port
  );
}

/**
 * Shape handed to the dashboard. The SMTP password never leaves the server.
 */
export function toPublicSupportEmailSettings(settings) {
  const normalized = normalizeStoredSettings(settings);
  return {
    configured: isSupportEmailConfigured(normalized),
    enabled: normalized.enabled,
    fromName: normalized.fromName,
    fromEmail: normalized.fromEmail,
    replyToEmail: normalized.replyToEmail,
    signature: normalized.signature,
    smtp: {
      host: normalized.smtp.host,
      port: normalized.smtp.port,
      secure: normalized.smtp.secure,
      username: normalized.smtp.username,
      passwordSet: Boolean(normalized.smtp.password),
      passwordMasked: maskSecret(normalized.smtp.password),
    },
    updatedAt: normalized.updatedAt,
  };
}

/**
 * Persist settings. `smtp.password` is optional on every save after the first:
 * an empty value means "keep the stored one" so the admin can edit the host or
 * the from-address without re-typing the credential.
 *
 * Throws user-facing Errors for invalid input.
 */
export async function saveSupportEmailSettings(input = {}) {
  const existing = await getSupportEmailSettings();
  const smtpInput = input.smtp && typeof input.smtp === "object" ? input.smtp : {};

  const enabled = Boolean(input.enabled);
  const fromEmail = normalizeEmail(input.fromEmail, "Sender address");
  const replyToEmail = normalizeEmail(input.replyToEmail, "Reply-to address");
  const host = sanitizeString(smtpInput.host).slice(0, LIMITS.host);
  const port = normalizePort(smtpInput.port);

  const passwordInput = sanitizeString(smtpInput.password).slice(0, LIMITS.password);
  const password = passwordInput || existing.smtp.password;

  // Only demand a complete config when the admin is switching sending on;
  // a half-filled draft can be saved with the toggle off.
  if (enabled) {
    if (!fromEmail) {
      throw new Error("A sender address is required before replies can be sent.");
    }
    if (!host) {
      throw new Error("An SMTP host is required before replies can be sent.");
    }
  }

  const next = {
    enabled,
    fromName: sanitizeString(input.fromName).slice(0, LIMITS.fromName),
    fromEmail,
    replyToEmail,
    signature: sanitizeString(input.signature).slice(0, LIMITS.signature),
    smtp: {
      host,
      port,
      secure: Boolean(smtpInput.secure),
      username: sanitizeString(smtpInput.username).slice(0, LIMITS.username),
      password,
    },
    updatedAt: new Date().toISOString(),
  };

  await prisma.appSetting.upsert({
    where: { key: SUPPORT_EMAIL_SETTINGS_KEY },
    update: { value: next },
    create: { key: SUPPORT_EMAIL_SETTINGS_KEY, value: next },
  });

  return normalizeStoredSettings(next);
}
