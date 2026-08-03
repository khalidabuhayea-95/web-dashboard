import prisma from "@/lib/prisma";

import {
  CONTACT_MESSAGE_LIMITS,
  CONTACT_MESSAGE_SOURCE_VALUES,
  CONTACT_MESSAGE_TOPIC_VALUES,
  ContactMessageStatuses,
  normalizeContactMessageSource,
  normalizeContactMessageStatus,
} from "./contactMessageFields";

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function clamp(value, max) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function mapContactMessageForApi(record) {
  if (!record) return null;
  return {
    id: record.id,
    source: record.source,
    name: record.name,
    email: record.email,
    topic: record.topic,
    device: record.device,
    message: record.message,
    status: record.status,
    mobileUserId: record.mobileUserId,
    appVersion: record.appVersion,
    handledByUserId: record.handledByUserId,
    handledAt: toIso(record.handledAt),
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
    mobileUser: record.mobileUser
      ? {
          id: record.mobileUser.id,
          name: record.mobileUser.name,
          email: record.mobileUser.email,
        }
      : null,
  };
}

// The full row, for the detail drawer only. userAgent/ipAddress are diagnostic
// fields we keep out of the list payload.
export function mapContactMessageDetailForApi(record) {
  const base = mapContactMessageForApi(record);
  if (!base) return null;
  return {
    ...base,
    userAgent: record.userAgent,
    ipAddress: record.ipAddress,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildSearchWhere(search) {
  const term = String(search || "").trim();
  if (!term) return null;

  const or = [
    { name: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
    { message: { contains: term, mode: "insensitive" } },
    { device: { contains: term, mode: "insensitive" } },
  ];

  // Let an admin paste a message id straight into the search box.
  if (UUID_PATTERN.test(term)) or.push({ id: term });

  return { OR: or };
}

function buildStatusWhere(status) {
  if (!status || status === "all") return null;
  if (status === "unhandled") {
    // The default inbox view: everything nobody has resolved yet.
    return { status: { in: [ContactMessageStatuses.NEW, ContactMessageStatuses.READ] } };
  }
  return { status: normalizeContactMessageStatus(status) };
}

function buildSourceWhere(source) {
  if (!source || source === "all") return null;
  return { source: normalizeContactMessageSource(source) };
}

function buildTopicWhere(topic) {
  if (!topic || topic === "all") return null;
  if (!CONTACT_MESSAGE_TOPIC_VALUES.includes(topic)) return null;
  return { topic };
}

/**
 * @param {{
 *   source: string,
 *   name: string,
 *   email: string,
 *   topic: string,
 *   device: string | null,
 *   message: string,
 *   appVersion: string | null,
 *   mobileUserId?: string | null,
 *   userAgent?: string | null,
 *   ipAddress?: string | null,
 * }} input
 */
export async function createContactMessage({
  source,
  name,
  email,
  topic,
  device,
  message,
  appVersion,
  mobileUserId = null,
  userAgent = null,
  ipAddress = null,
}) {
  const record = await prisma.contactMessage.create({
    data: {
      source: normalizeContactMessageSource(source),
      name,
      email,
      topic,
      device,
      message,
      appVersion,
      mobileUserId,
      userAgent: clamp(userAgent, CONTACT_MESSAGE_LIMITS.userAgent),
      ipAddress: clamp(ipAddress, CONTACT_MESSAGE_LIMITS.ipAddress),
    },
    select: { id: true, createdAt: true },
  });

  return { id: record.id, createdAt: toIso(record.createdAt) };
}

export async function listContactMessages({
  page = 1,
  perPage = 20,
  search = "",
  status = "all",
  source = "all",
  topic = "all",
} = {}) {
  // Each filter may contribute its own OR, so they are combined under AND
  // rather than merged into one object where the later OR would clobber the
  // earlier one.
  const clauses = [
    buildSearchWhere(search),
    buildStatusWhere(status),
    buildSourceWhere(source),
    buildTopicWhere(topic),
  ].filter(Boolean);

  const where = clauses.length ? { AND: clauses } : {};
  const skip = Math.max(page - 1, 0) * perPage;

  const [total, messages] = await Promise.all([
    prisma.contactMessage.count({ where }),
    prisma.contactMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
      include: {
        mobileUser: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return { total, messages: messages.map(mapContactMessageForApi) };
}

// Small badge counts for the inbox header.
export async function countContactMessagesByStatus() {
  const grouped = await prisma.contactMessage.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const counts = { new: 0, read: 0, replied: 0, archived: 0, total: 0 };
  for (const row of grouped) {
    const key = normalizeContactMessageStatus(row.status);
    counts[key] = row._count._all;
    counts.total += row._count._all;
  }
  return counts;
}

export async function getContactMessage({ id }) {
  const record = await prisma.contactMessage.findUnique({
    where: { id },
    include: {
      mobileUser: { select: { id: true, name: true, email: true } },
    },
  });

  if (!record) {
    throw httpError("Contact message not found", 404);
  }

  return mapContactMessageDetailForApi(record);
}

export async function updateContactMessageStatus({ id, status, handledByUserId }) {
  const existing = await prisma.contactMessage.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    throw httpError("Contact message not found", 404);
  }

  const nextStatus = normalizeContactMessageStatus(status);
  // "Who dealt with this, and when" only means something once the message has
  // left the new/read part of the flow.
  const resolved =
    nextStatus === ContactMessageStatuses.REPLIED ||
    nextStatus === ContactMessageStatuses.ARCHIVED;

  const record = await prisma.contactMessage.update({
    where: { id },
    data: {
      status: nextStatus,
      handledAt: resolved ? new Date() : null,
      handledByUserId: resolved ? handledByUserId || null : null,
    },
    include: {
      mobileUser: { select: { id: true, name: true, email: true } },
    },
  });

  return mapContactMessageDetailForApi(record);
}

export async function deleteContactMessage({ id }) {
  const existing = await prisma.contactMessage.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    throw httpError("Contact message not found", 404);
  }

  await prisma.contactMessage.delete({ where: { id } });
  return { id };
}

export { CONTACT_MESSAGE_SOURCE_VALUES };
