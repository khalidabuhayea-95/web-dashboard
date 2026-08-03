import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

import { logger } from "@/lib/logging/logger";

// Thin wrapper over nodemailer. Everything provider-specific lives in the
// settings row (see supportEmailSettings.server.js), so switching mail provider
// never touches this file.

// A hung SMTP dialogue must not hold an API request open indefinitely.
const TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
};

function domainOf(email) {
  const at = String(email || "").lastIndexOf("@");
  return at === -1 ? "localhost" : String(email).slice(at + 1) || "localhost";
}

/**
 * Build an RFC 5322 Message-ID we control.
 *
 * We mint our own rather than letting the SMTP server assign one because the
 * value has to be recorded in the database *and* referenced by the next reply
 * in the thread — a server-assigned id would come back too late to chain.
 */
export function buildMessageId(fromEmail) {
  return `<${randomUUID()}@${domainOf(fromEmail)}>`;
}

function createTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // true = implicit TLS (465). false = plaintext + STARTTLS upgrade (587),
    // which nodemailer negotiates automatically when the server advertises it.
    secure: Boolean(smtp.secure),
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    ...TIMEOUTS,
  });
}

/**
 * Verify the SMTP settings can connect and authenticate, without sending.
 * Returns { ok: true } or { ok: false, error } — never throws.
 */
export async function verifySmtp(smtp) {
  try {
    const transport = createTransport(smtp);
    await transport.verify();
    transport.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeMailError(error) };
  }
}

/**
 * Send one message.
 *
 * `inReplyTo` / `references` are what make the customer's mail client stack the
 * exchange into a single conversation instead of a pile of unrelated mails.
 *
 * Returns { ok, messageId, error }; never throws, so a delivery failure can be
 * recorded against the thread rather than losing the admin's draft.
 */
export async function sendMail({
  smtp,
  from,
  fromName,
  to,
  replyTo,
  subject,
  text,
  html,
  messageId,
  inReplyTo,
  references,
}) {
  let transport;
  try {
    transport = createTransport(smtp);
    const info = await transport.sendMail({
      from: fromName ? { name: fromName, address: from } : from,
      to,
      replyTo: replyTo || from,
      subject,
      text,
      html,
      messageId,
      inReplyTo: inReplyTo || undefined,
      references: references?.length ? references : undefined,
    });

    return { ok: true, messageId: info.messageId || messageId };
  } catch (error) {
    logger.error("Support reply email failed to send", error);
    return { ok: false, error: describeMailError(error) };
  } finally {
    try {
      transport?.close();
    } catch {
      // Closing a transport that never opened is not worth reporting.
    }
  }
}

/**
 * Turn an SMTP error into something an admin can act on, without leaking
 * credentials or internal hostnames into the dashboard.
 */
export function describeMailError(error) {
  const code = String(error?.code || "");
  const responseCode = Number(error?.responseCode);

  if (code === "EAUTH" || responseCode === 535) {
    return "The mail server rejected the username or password.";
  }
  if (code === "ECONNECTION" || code === "ECONNREFUSED") {
    return "Could not connect to the mail server. Check the host and port.";
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET") {
    return "The mail server did not respond. Check the host, port and TLS setting.";
  }
  if (code === "EENVELOPE" || responseCode === 550) {
    return "The mail server rejected the sender or recipient address.";
  }
  return "The mail server refused the message. Check the SMTP settings and try again.";
}
