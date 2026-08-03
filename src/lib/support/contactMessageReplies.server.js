import prisma from "@/lib/prisma";

import { logger } from "@/lib/logging/logger";
import { buildMessageId, sendMail } from "@/lib/email/mailer.server";
import {
  ContactMessageStatuses,
  contactMessageTopicLabel,
} from "./contactMessageFields";
import {
  getSupportEmailSettings,
  isSupportEmailConfigured,
} from "./supportEmailSettings.server";

const REPLY_LIMITS = {
  body: 10_000,
};

export const ReplyStatuses = {
  SENT: "sent",
  FAILED: "failed",
};

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphsToHtml(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px">${block.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/**
 * One stable subject for the whole thread.
 *
 * The customer wrote in through a web form, so there is no inbound subject to
 * quote. Deriving it from the message id keeps every reply in the exchange
 * under an identical subject line, which is the second signal (after
 * References) mail clients use to group a conversation. The short id also gives
 * support something to search for.
 */
export function threadSubject(message) {
  const label = contactMessageTopicLabel(message.topic, "ar");
  return `نيروز — ${label} [#${String(message.id).slice(0, 8)}]`;
}

export function mapReplyForApi(record) {
  if (!record) return null;
  return {
    id: record.id,
    body: record.body,
    subject: record.subject,
    fromEmail: record.fromEmail,
    toEmail: record.toEmail,
    authorName: record.authorName,
    authorUserId: record.authorUserId,
    status: record.status,
    error: record.error,
    createdAt: toIso(record.createdAt),
  };
}

export async function listContactMessageReplies({ contactMessageId }) {
  const replies = await prisma.contactMessageReply.findMany({
    where: { contactMessageId },
    orderBy: { createdAt: "asc" },
  });
  return replies.map(mapReplyForApi);
}

function buildBodies({ body, signature, message, previousReplies }) {
  const signed = signature ? `${body}\n\n${signature}` : body;

  // Quote the customer's original underneath, the way a mail client would, so
  // the reply stands on its own even if they no longer have the form in view.
  const quotedLines = String(message.message)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  const text = [
    signed,
    "",
    "―――――――――――――――",
    `${message.name} <${message.email}> كتب:`,
    quotedLines,
  ].join("\n");

  const priorHtml = previousReplies.length
    ? `<p style="margin:16px 0 0;color:#8aabb8;font-size:12px">هذه الرسالة جزء من محادثة سابقة (${previousReplies.length + 1} رسائل).</p>`
    : "";

  const html = `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#1a2e36">
${paragraphsToHtml(signed)}
<hr style="border:none;border-top:1px solid #d9e6ea;margin:20px 0" />
<div style="color:#4a6a78;font-size:13px">
<p style="margin:0 0 8px"><strong>${escapeHtml(message.name)}</strong> &lt;${escapeHtml(message.email)}&gt; كتب:</p>
<blockquote style="margin:0;padding:0 12px 0 0;border-right:3px solid #7ec8cd;color:#4a6a78">${paragraphsToHtml(message.message)}</blockquote>
</div>
${priorHtml}
</div>`;

  return { text, html };
}

/**
 * Send one reply in a contact-message thread and record it.
 *
 * A delivery failure is persisted as a `failed` row rather than thrown away:
 * the admin can see what was attempted, read the SMTP reason, and retry without
 * retyping. Only a successful send advances the message to "replied".
 */
export async function sendContactMessageReply({ id, body, authorUserId, authorName }) {
  const trimmedBody = String(body ?? "").trim().slice(0, REPLY_LIMITS.body);
  if (!trimmedBody) {
    throw httpError("Reply body is required.", 400);
  }

  const message = await prisma.contactMessage.findUnique({ where: { id } });
  if (!message) {
    throw httpError("Contact message not found", 404);
  }

  const settings = await getSupportEmailSettings();
  if (!isSupportEmailConfigured(settings)) {
    throw httpError(
      "Reply email is not configured yet. Set the sender address and SMTP details in Email settings.",
      409
    );
  }

  const previous = await prisma.contactMessageReply.findMany({
    where: { contactMessageId: id, status: ReplyStatuses.SENT },
    orderBy: { createdAt: "asc" },
    select: { messageId: true },
  });

  // Chain onto the most recent delivered reply so the thread stays linear.
  const references = previous.map((reply) => reply.messageId).filter(Boolean);
  const inReplyTo = references.length ? references[references.length - 1] : null;

  const subject = threadSubject(message);
  const messageId = buildMessageId(settings.fromEmail);
  const { text, html } = buildBodies({
    body: trimmedBody,
    signature: settings.signature,
    message,
    previousReplies: previous,
  });

  const result = await sendMail({
    smtp: settings.smtp,
    from: settings.fromEmail,
    fromName: settings.fromName,
    to: message.email,
    replyTo: settings.replyToEmail || settings.fromEmail,
    subject,
    text,
    html,
    messageId,
    inReplyTo,
    references,
  });

  const reply = await prisma.contactMessageReply.create({
    data: {
      contactMessageId: id,
      body: trimmedBody,
      subject,
      fromEmail: settings.fromEmail,
      toEmail: message.email,
      authorUserId: authorUserId || null,
      authorName: String(authorName || "Support").slice(0, 120),
      messageId: result.ok ? messageId : null,
      inReplyTo,
      status: result.ok ? ReplyStatuses.SENT : ReplyStatuses.FAILED,
      error: result.ok ? null : String(result.error || "Unknown error").slice(0, 500),
    },
  });

  if (!result.ok) {
    logger.error("Contact message reply not delivered", {
      contactMessageId: id,
      replyId: reply.id,
    });
    return { ok: false, reply: mapReplyForApi(reply), error: result.error };
  }

  const now = new Date();
  await prisma.contactMessage.update({
    where: { id },
    data: {
      lastRepliedAt: now,
      status: ContactMessageStatuses.REPLIED,
      handledByUserId: authorUserId || message.handledByUserId,
      handledAt: message.handledAt || now,
    },
  });

  logger.info("Contact message replied", {
    contactMessageId: id,
    replyId: reply.id,
    to: message.email,
  });

  return { ok: true, reply: mapReplyForApi(reply) };
}
