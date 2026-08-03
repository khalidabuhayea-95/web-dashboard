// Shape of a contact-us submission, shared by the three places that touch it:
// the public web endpoint (/api/contact), the mobile endpoint
// (/api/mobile/support/contact) and the dashboard inbox. Kept dependency-free
// so the marketing site, the API routes and the admin UI can all import it.
//
// Both submit endpoints accept the exact same field set, so the mobile app can
// mirror public/contact.html one-for-one.

export const ContactMessageSources = {
  WEB: "web",
  MOBILE: "mobile",
};

export const CONTACT_MESSAGE_SOURCE_VALUES = [
  ContactMessageSources.WEB,
  ContactMessageSources.MOBILE,
];

export const ContactMessageStatuses = {
  // Nobody on the team has opened it yet.
  NEW: "new",
  // Opened in the dashboard, no reply sent.
  READ: "read",
  // Answered — kept for history.
  REPLIED: "replied",
  // Spam or otherwise not actionable.
  ARCHIVED: "archived",
};

export const CONTACT_MESSAGE_STATUS_VALUES = [
  ContactMessageStatuses.NEW,
  ContactMessageStatuses.READ,
  ContactMessageStatuses.REPLIED,
  ContactMessageStatuses.ARCHIVED,
];

// Canonical topic keys. The Arabic labels are what the website form and the
// mobile app show; the key is what we store, so the dashboard can filter on it
// without depending on the display language.
export const CONTACT_MESSAGE_TOPICS = [
  { value: "general", label: "استفسار عام", labelEn: "General enquiry" },
  { value: "support", label: "الدعم الفني", labelEn: "Technical support" },
  { value: "feature", label: "اقتراح ميزة", labelEn: "Feature request" },
  { value: "account", label: "الحساب والاشتراك", labelEn: "Account & billing" },
  { value: "business", label: "الشراكات والأعمال", labelEn: "Partnerships" },
  { value: "press", label: "الإعلام والصحافة", labelEn: "Press" },
  { value: "privacy", label: "الخصوصية وحقوق البيانات", labelEn: "Privacy & data rights" },
];

export const CONTACT_MESSAGE_TOPIC_VALUES = CONTACT_MESSAGE_TOPICS.map((topic) => topic.value);

// Column limits. Enforced on write so a hostile client cannot push a
// multi-megabyte row into the inbox.
export const CONTACT_MESSAGE_LIMITS = {
  name: 120,
  email: 200,
  device: 200,
  message: 5000,
  appVersion: 40,
  userAgent: 500,
  ipAddress: 120,
};

// Deliberately permissive: enough to reject obvious junk without bouncing the
// valid-but-unusual addresses a stricter pattern would.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function toTrimmedString(value) {
  return String(value ?? "").trim();
}

export function normalizeContactMessageSource(value) {
  const normalized = toTrimmedString(value).toLowerCase();
  return normalized === ContactMessageSources.MOBILE
    ? ContactMessageSources.MOBILE
    : ContactMessageSources.WEB;
}

export function normalizeContactMessageStatus(value) {
  const normalized = toTrimmedString(value).toLowerCase();
  return CONTACT_MESSAGE_STATUS_VALUES.includes(normalized)
    ? normalized
    : ContactMessageStatuses.NEW;
}

export function normalizeContactMessageTopic(value) {
  const normalized = toTrimmedString(value).toLowerCase();
  if (CONTACT_MESSAGE_TOPIC_VALUES.includes(normalized)) return normalized;

  // The website shipped with Arabic-labelled <option>s and no value attribute,
  // so older cached pages still post the label. Map those back to the key.
  const byLabel = CONTACT_MESSAGE_TOPICS.find(
    (topic) => topic.label === toTrimmedString(value)
  );
  return byLabel ? byLabel.value : "general";
}

export function contactMessageTopicLabel(value, locale = "ar") {
  const topic = CONTACT_MESSAGE_TOPICS.find((entry) => entry.value === value);
  if (!topic) return value || "general";
  return locale === "en" ? topic.labelEn : topic.label;
}

/**
 * @typedef {object} ContactMessageSubmission
 * @property {string} name
 * @property {string} email
 * @property {string} message
 * @property {string} topic
 * @property {string | null} device
 * @property {string | null} appVersion
 */

/**
 * Validate and clamp a raw submission body from either endpoint.
 *
 * @param {any} body
 * @returns {{ ok: true, value: ContactMessageSubmission }
 *   | { ok: false, field: string, message: string }}
 */
export function parseContactMessageSubmission(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, field: "body", message: "Invalid JSON body" };
  }

  const name = toTrimmedString(body.name).slice(0, CONTACT_MESSAGE_LIMITS.name);
  if (!name) {
    return { ok: false, field: "name", message: "name is required." };
  }

  const email = toTrimmedString(body.email).toLowerCase().slice(0, CONTACT_MESSAGE_LIMITS.email);
  if (!email) {
    return { ok: false, field: "email", message: "email is required." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, field: "email", message: "email is not a valid address." };
  }

  const message = toTrimmedString(body.message).slice(0, CONTACT_MESSAGE_LIMITS.message);
  if (!message) {
    return { ok: false, field: "message", message: "message is required." };
  }

  return {
    ok: true,
    value: {
      name,
      email,
      message,
      topic: normalizeContactMessageTopic(body.topic),
      device: toTrimmedString(body.device).slice(0, CONTACT_MESSAGE_LIMITS.device) || null,
      appVersion:
        toTrimmedString(body.appVersion).slice(0, CONTACT_MESSAGE_LIMITS.appVersion) || null,
    },
  };
}

// Bots fill every field they can see. The form ships a visually hidden input
// that a human never types into, so anything in it means "drop silently" —
// we still answer 201 so the bot has no signal to retry differently.
export function isHoneypotTripped(body) {
  return Boolean(toTrimmedString(body?.website));
}
