import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import {
  getObject,
  headObject,
  getPublicStorageBucketName,
} from "@/lib/storage/objectStorage.server";

export const runtime = "nodejs";

function getObjectKey(params: { key?: string[] } | null | undefined) {
  return Array.isArray(params?.key)
    ? params.key.map((segment) => String(segment || "").trim()).filter(Boolean).join("/")
    : "";
}

function toWebStream(body: unknown) {
  if (!body) return null;
  if (typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
    return (body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream;
  }
  return body as BodyInit;
}

function normalizeCacheControl(value: unknown) {
  const source = String(value || "").trim();
  if (!source) return "public, max-age=31536000, immutable";
  if (/^\d+$/.test(source)) return `public, max-age=${source}`;
  return source;
}

function buildHeaders(object: {
  CacheControl?: unknown;
  ContentType?: unknown;
  ContentLength?: unknown;
  ETag?: unknown;
}, options: { versioned?: boolean } = {}) {
  const headers = new Headers();
  headers.set(
    "Cache-Control",
    options.versioned
      ? "public, max-age=31536000, immutable"
      : normalizeCacheControl(object.CacheControl)
  );
  if (object.ContentType) headers.set("Content-Type", String(object.ContentType));
  if (object.ContentLength != null) headers.set("Content-Length", String(object.ContentLength));
  if (object.ETag) headers.set("ETag", object.ETag);
  return headers;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ key?: string[] }> }) {
  try {
    const objectKey = getObjectKey(await params);
    if (!objectKey) {
      return NextResponse.json({ error: "Missing object key." }, { status: 400 });
    }

    const object = await getObject(getPublicStorageBucketName(), objectKey);
    const body = toWebStream(object.Body);
    if (!body) {
      return NextResponse.json({ error: "Object body is unavailable." }, { status: 404 });
    }

    return new Response(body, {
      status: 200,
      headers: buildHeaders(object, {
        versioned: request.nextUrl.searchParams.has("v"),
      }),
    });
  } catch (error) {
    const statusCode = Number((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode || 0);
    if (statusCode === 404 || (error as { name?: string })?.name === "NoSuchKey") {
      return NextResponse.json({ error: "Object not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to load media object." }, { status: 502 });
  }
}

export async function HEAD(request: NextRequest, { params }: { params: Promise<{ key?: string[] }> }) {
  try {
    const objectKey = getObjectKey(await params);
    if (!objectKey) {
      return new Response(null, { status: 400 });
    }

    const object = await headObject(getPublicStorageBucketName(), objectKey);
    return new Response(null, {
      status: 200,
      headers: buildHeaders(object, {
        versioned: request.nextUrl.searchParams.has("v"),
      }),
    });
  } catch (error) {
    const statusCode = Number((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode || 0);
    return new Response(null, {
      status: statusCode === 404 || (error as { name?: string })?.name === "NoSuchKey" ? 404 : 502,
    });
  }
}
