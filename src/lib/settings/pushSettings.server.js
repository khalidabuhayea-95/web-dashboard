import prisma from "@/lib/prisma";

// Firebase Cloud Messaging configuration. The service-account credentials are
// stored in the DB (AppSetting) per the chosen setup. The private key is never
// returned to the client — see toPublicPushSettings().
const PUSH_SETTINGS_KEY = "push_fcm_settings_v1";

function sanitizeString(value) {
  return String(value || "").trim();
}

function maskSecret(value) {
  const source = sanitizeString(value);
  if (!source) return "";
  if (source.length <= 16) return "*".repeat(8);
  return `${source.slice(0, 6)}${"*".repeat(10)}${source.slice(-6)}`;
}

function normalizeStoredSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const sa =
    source.serviceAccount && typeof source.serviceAccount === "object" ? source.serviceAccount : {};
  return {
    serviceAccount: {
      projectId: sanitizeString(sa.projectId || sa.project_id),
      clientEmail: sanitizeString(sa.clientEmail || sa.client_email),
      privateKey: sanitizeString(sa.privateKey || sa.private_key),
    },
    defaultTopic: sanitizeString(source.defaultTopic),
    updatedAt: sanitizeString(source.updatedAt) || new Date().toISOString(),
  };
}

export async function getPushSettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: PUSH_SETTINGS_KEY },
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

export function isPushConfigured(settings) {
  const normalized = normalizeStoredSettings(settings);
  return Boolean(
    normalized.serviceAccount.projectId &&
      normalized.serviceAccount.clientEmail &&
      normalized.serviceAccount.privateKey,
  );
}

export function toPublicPushSettings(settings) {
  const normalized = normalizeStoredSettings(settings);
  return {
    configured: isPushConfigured(normalized),
    projectId: normalized.serviceAccount.projectId,
    clientEmail: normalized.serviceAccount.clientEmail,
    privateKeyConfigured: Boolean(normalized.serviceAccount.privateKey),
    privateKeyMasked: maskSecret(normalized.serviceAccount.privateKey),
    defaultTopic: normalized.defaultTopic,
    updatedAt: normalized.updatedAt,
  };
}

// Parse a pasted Firebase service-account JSON file into our stored shape.
// Throws a user-facing Error if required fields are missing.
export function parseServiceAccountJson(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("Service account must be valid JSON (paste the whole file).");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Service account must be a JSON object.");
  }
  const projectId = sanitizeString(parsed.project_id || parsed.projectId);
  const clientEmail = sanitizeString(parsed.client_email || parsed.clientEmail);
  // Pasted keys frequently arrive with literal "\n" sequences — normalize to real newlines.
  const privateKey = sanitizeString(parsed.private_key || parsed.privateKey).replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Service account JSON must include project_id, client_email, and private_key.",
    );
  }
  return { projectId, clientEmail, privateKey };
}

export async function savePushSettings(input = {}) {
  const current = await getPushSettings();

  let serviceAccount = current.serviceAccount;
  if (input.serviceAccountJson) {
    serviceAccount = parseServiceAccountJson(input.serviceAccountJson);
  } else if (input.serviceAccount && typeof input.serviceAccount === "object") {
    serviceAccount = {
      projectId: sanitizeString(input.serviceAccount.projectId) || current.serviceAccount.projectId,
      clientEmail:
        sanitizeString(input.serviceAccount.clientEmail) || current.serviceAccount.clientEmail,
      privateKey:
        sanitizeString(input.serviceAccount.privateKey).replace(/\\n/g, "\n") ||
        current.serviceAccount.privateKey,
    };
  }

  const next = normalizeStoredSettings({
    serviceAccount,
    defaultTopic: input.defaultTopic ?? current.defaultTopic,
    updatedAt: new Date().toISOString(),
  });

  await prisma.appSetting.upsert({
    where: { key: PUSH_SETTINGS_KEY },
    create: { key: PUSH_SETTINGS_KEY, value: next },
    update: { value: next },
  });

  return next;
}

export async function clearPushSettings() {
  try {
    await prisma.appSetting.deleteMany({ where: { key: PUSH_SETTINGS_KEY } });
  } catch {
    /* ignore */
  }
}
