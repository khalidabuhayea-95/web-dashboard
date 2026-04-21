import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

const DEFAULT_PUBLIC_BUCKET = "nayroz-media-dev";
const DEFAULT_PRIVATE_BUCKET = "nayroz-processing-dev";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;

let storageClient = null;

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeCacheControl(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^\d+$/.test(source)) {
    return `public, max-age=${source}`;
  }
  return source;
}

function requireEnv(name, fallback = "") {
  const value = env(name, fallback);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEndpoint() {
  const accountId = env("R2_ACCOUNT_ID");
  const fallbackEndpoint = accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : "";
  return requireEnv("R2_ENDPOINT", fallbackEndpoint);
}

function getClientConfig() {
  return {
    endpoint: getEndpoint(),
    region: env("R2_REGION", "auto"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  };
}

function createStorageClient() {
  if (storageClient) return storageClient;
  storageClient = new S3Client(getClientConfig());
  return storageClient;
}

function getEndpointUrl() {
  return new URL(getEndpoint());
}

function encodeObjectKey(key) {
  return String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function formatQuery(query = {}) {
  const pairs = [];
  for (const [name, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === undefined || entry === null) continue;
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(entry))}`);
    }
  }
  return pairs.join("&");
}

function formatHttpRequestUrl(request) {
  const protocol = String(request.protocol || "https:").endsWith(":")
    ? String(request.protocol)
    : `${String(request.protocol)}:`;
  const host = request.port ? `${request.hostname}:${request.port}` : request.hostname;
  const query = formatQuery(request.query || {});
  return `${protocol}//${host}${request.path}${query ? `?${query}` : ""}`;
}

export function getPublicStorageBucketName() {
  return env("EDITOR_MEDIA_BUCKET", env("R2_PUBLIC_BUCKET", DEFAULT_PUBLIC_BUCKET));
}

export function getTemplateThumbnailBucketName() {
  return env("TEMPLATE_THUMBNAIL_BUCKET", getPublicStorageBucketName());
}

export function getPrivateStorageBucketName() {
  return env(
    "OBJECT_REMOVE_INPUT_BUCKET",
    env("R2_PRIVATE_BUCKET", DEFAULT_PRIVATE_BUCKET)
  );
}

export function getObjectRemovalOutputBucketName() {
  return env("OBJECT_REMOVE_OUTPUT_BUCKET", getPublicStorageBucketName());
}

export function getStoragePublicBaseUrl() {
  return normalizeBaseUrl(requireEnv("R2_PUBLIC_BASE_URL"));
}

export function getStoragePublicHostnames() {
  const hosts = new Set();
  const appUrl = env("NEXT_PUBLIC_APP_URL");
  const publicBaseUrl = normalizeBaseUrl(env("R2_PUBLIC_BASE_URL"));

  for (const value of [appUrl, publicBaseUrl]) {
    if (!value) continue;
    try {
      hosts.add(new URL(value).host);
    } catch {
      // Ignore malformed optional env values.
    }
  }

  return hosts;
}

export function isPublicBucket(bucket) {
  const publicBuckets = new Set(
    [
      env("R2_PUBLIC_BUCKET", DEFAULT_PUBLIC_BUCKET),
      getPublicStorageBucketName(),
      getTemplateThumbnailBucketName(),
      getObjectRemovalOutputBucketName(),
    ].filter(Boolean)
  );
  return publicBuckets.has(String(bucket || "").trim());
}

export function getPublicObjectUrl(bucket, key) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) return "";
  if (!isPublicBucket(safeBucket)) {
    throw new Error(`Bucket ${safeBucket} is not configured for public URL access.`);
  }
  return `${getStoragePublicBaseUrl()}/${encodeObjectKey(safeKey)}`;
}

export function getPublicObjectProxyUrl(key) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return "";
  return `/api/storage/public/${encodeObjectKey(safeKey)}`;
}

export function appendVersionParam(value, version) {
  const source = String(value || "").trim();
  const token = String(version || "").trim();
  if (!source || !token) return source;

  try {
    const parsed = new URL(source, env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"));
    parsed.searchParams.set("v", token);
    return /^https?:\/\//i.test(source) ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  } catch {
    return source;
  }
}

export function parsePublicObjectKeyFromProxyUrl(value) {
  const source = String(value || "").trim();
  if (!source) return "";

  try {
    const parsed = new URL(source, env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"));
    const prefix = "/api/storage/public/";
    if (!parsed.pathname.startsWith(prefix)) return "";
    return parsed.pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
      .trim();
  } catch {
    return "";
  }
}

export function parsePublicObjectKeyFromUrl(value) {
  const source = String(value || "").trim();
  if (!source) return "";

  const publicBaseUrl = getStoragePublicBaseUrl();
  try {
    const parsed = new URL(source);
    const parsedBase = new URL(publicBaseUrl);
    if (parsed.origin !== parsedBase.origin) return "";

    const basePath = parsedBase.pathname.replace(/\/+$/, "");
    const sourcePath = parsed.pathname;
    const objectPath = basePath && sourcePath.startsWith(`${basePath}/`)
      ? sourcePath.slice(basePath.length + 1)
      : sourcePath.replace(/^\/+/, "");

    return objectPath
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
      .trim();
  } catch {
    return "";
  }
}

export function parsePublicObjectKey(value) {
  return parsePublicObjectKeyFromProxyUrl(value) || parsePublicObjectKeyFromUrl(value);
}

export function rewritePublicObjectUrlForClient(value) {
  const source = String(value || "").trim();
  const key = parsePublicObjectKeyFromUrl(source);
  if (!key) return source;

  let search = "";
  try {
    search = new URL(source).search;
  } catch {
    search = "";
  }

  return `${getPublicObjectProxyUrl(key)}${search}`;
}

export function restorePublicObjectUrlFromClient(value) {
  const source = String(value || "").trim();
  const key = parsePublicObjectKeyFromProxyUrl(source);
  return key ? getPublicObjectUrl(getPublicStorageBucketName(), key) : source;
}

export function rewritePublicObjectUrlsForClient(value) {
  if (typeof value === "string") {
    return rewritePublicObjectUrlForClient(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePublicObjectUrlsForClient(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewritePublicObjectUrlsForClient(entry),
      ])
    );
  }
  return value;
}

export function restorePublicObjectUrlsFromClient(value) {
  if (typeof value === "string") {
    return restorePublicObjectUrlFromClient(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => restorePublicObjectUrlsFromClient(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        restorePublicObjectUrlsFromClient(entry),
      ])
    );
  }
  return value;
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const statusCode = Number(error?.$metadata?.httpStatusCode || 0);
    if (statusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      return false;
    }
    throw error;
  }
}

export async function uploadObject({
  bucket,
  key,
  body,
  contentType = "application/octet-stream",
  cacheControl = "",
  upsert = false,
  skipExistenceCheck = false,
}) {
  const client = createStorageClient();
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for upload.");
  }

  if (!upsert && !skipExistenceCheck) {
    const exists = await objectExists(client, safeBucket, safeKey);
    if (exists) {
      throw new Error(`Object already exists at ${safeBucket}/${safeKey}.`);
    }
  }

  const normalizedCacheControl = normalizeCacheControl(cacheControl);

  await client.send(
    new PutObjectCommand({
      Bucket: safeBucket,
      Key: safeKey,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      ...(normalizedCacheControl ? { CacheControl: normalizedCacheControl } : {}),
    })
  );

  return {
    bucket: safeBucket,
    key: safeKey,
    url: isPublicBucket(safeBucket) ? getPublicObjectUrl(safeBucket, safeKey) : "",
  };
}

export async function getObject(bucket, key) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for object download.");
  }

  const client = createStorageClient();
  return client.send(
    new GetObjectCommand({
      Bucket: safeBucket,
      Key: safeKey,
    })
  );
}

export async function headObject(bucket, key) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for object metadata.");
  }

  const client = createStorageClient();
  return client.send(
    new HeadObjectCommand({
      Bucket: safeBucket,
      Key: safeKey,
    })
  );
}

export async function deleteObjects(bucket, keys = []) {
  const safeBucket = String(bucket || "").trim();
  const safeKeys = Array.from(
    new Set(
      (Array.isArray(keys) ? keys : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  if (!safeBucket || safeKeys.length === 0) return;

  const client = createStorageClient();
  await client.send(
    new DeleteObjectsCommand({
      Bucket: safeBucket,
      Delete: {
        Objects: safeKeys.map((key) => ({ Key: key })),
        Quiet: true,
      },
    })
  );
}

export async function createSignedDownloadUrl(
  bucket,
  key,
  expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS
) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for signed URL generation.");
  }

  if (isPublicBucket(safeBucket)) {
    return getPublicObjectUrl(safeBucket, safeKey);
  }

  const endpoint = getEndpointUrl();
  const config = getClientConfig();
  const signer = new SignatureV4({
    credentials: config.credentials,
    region: config.region,
    service: "s3",
    sha256: Hash,
    uriEscapePath: false,
  });

  const request = new HttpRequest({
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : undefined,
    method: "GET",
    path: `/${safeBucket}/${encodeObjectKey(safeKey)}`,
    headers: {
      host: endpoint.host,
    },
  });

  const presigned = await signer.presign(request, {
    expiresIn: Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS)),
  });

  return formatHttpRequestUrl(presigned);
}

export function resolveStoredObjectUrl(bucket, key) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) return "";
  return isPublicBucket(safeBucket)
    ? getPublicObjectUrl(safeBucket, safeKey)
    : "";
}
