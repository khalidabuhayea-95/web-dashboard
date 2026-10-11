/**
 * Outage classification + the shared 503 (production audit H-24).
 * Run: node --import tsx --test src/lib/api/infrastructureErrors.test.js
 *
 * The Prisma errors here are REAL: a client pointed at a closed port produces exactly what a
 * database outage produces, without taking any database down.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { PrismaClient, Prisma } from "@prisma/client";

import { handleApiError } from "@/lib/api/errors";
import {
  SERVICE_UNAVAILABLE_CODE,
  isInfrastructureError,
  serviceUnavailableError,
  serviceUnavailableResponseFor,
} from "@/lib/api/infrastructureErrors";

const CLOSED_PORT_URL = "postgresql://nobody:nothing@127.0.0.1:1/unreachable?connect_timeout=2";

async function captureOutageError() {
  const client = new PrismaClient({ datasourceUrl: CLOSED_PORT_URL });
  try {
    await client.appSetting.findUnique({ where: { key: "template_taxonomy" } });
    assert.fail("a query against a closed port must fail");
  } catch (error) {
    return error;
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

test("a real 'database unreachable' Prisma error is an infrastructure error", async () => {
  const error = await captureOutageError();
  assert.match(String(error?.name), /^PrismaClient/);
  assert.equal(isInfrastructureError(error), true);
});

test("handleApiError answers an outage with 503, no-store, Retry-After and a generic body", async () => {
  const error = await captureOutageError();
  // The auth routes pass 401 here; an outage must still be a 503, never a sign-out.
  const response = handleApiError(error, "Failed to refresh session.", 401);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Number(response.headers.get("retry-after")) >= 1);
  const body = await response.json();
  assert.equal(body.code, SERVICE_UNAVAILABLE_CODE);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /prisma|127\.0\.0\.1|database server|P1001/i, "no driver text leaks");
});

test("query-level Prisma errors are NOT outages", () => {
  const unique = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
  });
  const missing = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "5.22.0",
  });
  const validation = new Prisma.PrismaClientValidationError("Argument `id` is missing.", {
    clientVersion: "5.22.0",
  });
  assert.equal(isInfrastructureError(unique), false);
  assert.equal(isInfrastructureError(missing), false);
  assert.equal(isInfrastructureError(validation), false);
});

test("pool exhaustion, closed connections and raw-query connection SQLSTATEs are outages", () => {
  const known = (code, meta) =>
    new Prisma.PrismaClientKnownRequestError(`error ${code}`, { code, clientVersion: "5.22.0", meta });
  assert.equal(isInfrastructureError(known("P2024")), true, "pool timeout");
  assert.equal(isInfrastructureError(known("P1017")), true, "server closed the connection");
  assert.equal(isInfrastructureError(known("P2010", { code: "57P01" })), true, "admin shutdown");
  assert.equal(isInfrastructureError(known("P2010", { code: "08006" })), true, "connection failure");
  assert.equal(isInfrastructureError(known("P2010", { code: "42P01" })), false, "missing table is a bug");
  const unknown = new Prisma.PrismaClientUnknownRequestError(
    "Error in PostgreSQL connection: Error { kind: Closed, cause: None }",
    { clientVersion: "5.22.0" }
  );
  assert.equal(isInfrastructureError(unknown), true);
  assert.equal(
    isInfrastructureError(new Prisma.PrismaClientUnknownRequestError("syntax", { clientVersion: "5.22.0" })),
    false
  );
});

test("socket errors (also wrapped as a fetch cause) and our own typed error are outages", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8484"), { code: "ECONNREFUSED" });
  const fetchFailure = new TypeError("fetch failed", { cause: refused });
  assert.equal(isInfrastructureError(refused), true);
  assert.equal(isInfrastructureError(fetchFailure), true);
  assert.equal(isInfrastructureError(serviceUnavailableError()), true);
  assert.equal(isInfrastructureError(new Error("Invalid categoryId.")), false);
  assert.equal(isInfrastructureError(null), false);
  assert.equal(serviceUnavailableResponseFor(new Error("plain bug")), null);
});

test("non-outage errors keep their status, are never cacheable, and never echo Prisma text", async () => {
  const notFound = Object.assign(new Error("Mobile user not found."), { statusCode: 404 });
  const response = handleApiError(notFound, "Failed to load", 500);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const prismaBug = new Prisma.PrismaClientValidationError("Invalid `prisma.template.findMany()` invocation", {
    clientVersion: "5.22.0",
  });
  const leaked = handleApiError(prismaBug, "Failed to fetch templates");
  assert.equal(leaked.status, 500);
  assert.deepEqual(await leaked.json(), { error: "Failed to fetch templates" });
});
