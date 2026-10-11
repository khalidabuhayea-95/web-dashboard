import { NextResponse } from "next/server";

/**
 * Infrastructure failures — the database (or another backing service) is unreachable, timing out
 * or refusing connections — as opposed to a bad request or a bug.
 *
 * ★They map to 503 + `Cache-Control: no-store` + a generic body. Never to a fabricated 200, never
 * to a 401, never to the driver's own text (production audit H-24, 2026-10-01): during one short
 * Postgres outage the taxonomy route served a hard-coded legacy taxonomy with a 10-minute public
 * cache (the app cached it, then every category tap 400'd into an endless skeleton), the auth
 * routes answered 401 — which tells the app its session is dead — and some routes echoed Prisma's
 * error text to the client.
 *
 * Classification reads the `name`/`code` fields Prisma ASSIGNS as string literals (not class
 * identity), so it survives bundling and a second copy of the client under dev HMR, and needs no
 * Prisma import — the tests feed it real errors from a client pointed at a closed port.
 */

export const SERVICE_UNAVAILABLE_CODE = "service_unavailable";
export const SERVICE_UNAVAILABLE_MESSAGE =
  "The service is temporarily unavailable. Please try again shortly.";
export const SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

// Prisma codes that mean "the database could not be used", not "the query was wrong".
// https://www.prisma.io/docs/orm/reference/error-reference
const PRISMA_INFRASTRUCTURE_CODES = new Set([
  "P1000", // authentication failed against the database server
  "P1001", // can't reach database server
  "P1002", // database server reached but timed out
  "P1003", // database does not exist
  "P1008", // operations timed out
  "P1010", // access denied on the database
  "P1011", // error opening a TLS connection
  "P1017", // server has closed the connection
  "P2024", // timed out fetching a new connection from the pool
  "P2028", // transaction API error (an interactive transaction expired or could not start)
  "P2037", // too many database connections opened
]);

// SQLSTATEs a raw query (P2010) can surface: connection exception (08xxx), insufficient resources
// (53xxx), operator intervention (57P0x: admin/crash shutdown, cannot connect now), system error
// (58xxx) and query_canceled (57014, a statement timeout).
const POSTGRES_INFRASTRUCTURE_SQLSTATE = /^(?:08|53|57P|58)|^57014$/;
const RAW_QUERY_SQLSTATE_IN_MESSAGE = /Code: `((?:08|53|57P|58)[0-9A-Z]{0,3}|57014)`/;

// Node/undici socket errors (a fetch failure carries them on `cause`).
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const INFRASTRUCTURE_MESSAGE_PATTERNS = [
  /can't reach database server/i,
  /timed out fetching a new connection/i,
  /server has closed the connection/i,
  /connection (?:terminated|refused|reset|closed)/i,
  /error in postgresql connection/i,
  /the database system is (?:starting up|shutting down|in recovery mode)/i,
  /too many (?:clients|connections)/i,
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)\b/,
];

function messageLooksInfrastructural(error) {
  const message = String(error?.message || "");
  return Boolean(message) && INFRASTRUCTURE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/** True for any error object Prisma raised (they all carry an explicit `PrismaClient…` name). */
export function isPrismaError(error) {
  return /^PrismaClient/.test(String(error?.name || ""));
}

/**
 * Whether `error` means "a backing service is down" (→ 503) rather than "this request is bad" or
 * "this code is wrong". Walks `cause` a few levels so wrapped errors classify like their root.
 */
export function isInfrastructureError(error, depth = 0) {
  if (!error || typeof error !== "object" || depth > 4) return false;
  if (error.infrastructure === true || error.code === SERVICE_UNAVAILABLE_CODE) return true;

  const name = String(error.name || "");
  if (name === "PrismaClientInitializationError" || name === "PrismaClientRustPanicError") {
    return true;
  }
  if (name === "PrismaClientKnownRequestError") {
    const code = String(error.code || "");
    if (PRISMA_INFRASTRUCTURE_CODES.has(code)) return true;
    if (code === "P2010") {
      const sqlState = String(error.meta?.code || "");
      if (sqlState && POSTGRES_INFRASTRUCTURE_SQLSTATE.test(sqlState)) return true;
      return RAW_QUERY_SQLSTATE_IN_MESSAGE.test(String(error.message || ""));
    }
    // Any other known code is a query-level problem (unique violation, missing row, …).
    return false;
  }
  if (name === "PrismaClientUnknownRequestError") return messageLooksInfrastructural(error);
  if (NETWORK_ERROR_CODES.has(String(error.code || ""))) return true;

  return error.cause ? isInfrastructureError(error.cause, depth + 1) : false;
}

/** A typed error for code that detects an outage itself and wants the 503 path. */
export function serviceUnavailableError(message = SERVICE_UNAVAILABLE_MESSAGE, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "ServiceUnavailableError";
  error.code = SERVICE_UNAVAILABLE_CODE;
  error.statusCode = 503;
  error.infrastructure = true;
  return error;
}

/** The one body every mobile route sends for an outage: generic, uncacheable, retryable. */
export function serviceUnavailableResponse({
  retryAfterSeconds = SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} = {}) {
  return NextResponse.json(
    { error: SERVICE_UNAVAILABLE_MESSAGE, code: SERVICE_UNAVAILABLE_CODE },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, Math.floor(Number(retryAfterSeconds) || 1))),
      },
    }
  );
}

/**
 * For hand-written catch blocks: the 503 response when `error` is an outage, otherwise null so the
 * route keeps its own mapping.
 *
 *   } catch (error) {
 *     const unavailable = serviceUnavailableResponseFor(error);
 *     if (unavailable) return attachRequestIdHeader(unavailable, requestId);
 *     …
 */
export function serviceUnavailableResponseFor(error) {
  return isInfrastructureError(error) ? serviceUnavailableResponse() : null;
}
