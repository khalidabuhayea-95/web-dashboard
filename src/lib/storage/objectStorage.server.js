import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
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
    // ★Without these a stalled R2 connection is waited on forever, holding one of the pool's 50
    // sockets; once all 50 are held every media, font and thumbnail request hangs while JSON routes
    // keep working. connectionTimeout fails a hung connect; socketTimeout fails an upstream that goes
    // quiet BEFORE its response headers — the SDK clears it once headers arrive, so mid-stream it is
    // getObject's abortSignal (wired by the storage proxy route) that frees an abandoned socket.
    requestHandler: {
      connectionTimeout: 5_000,
      socketTimeout: 30_000,
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

/**
 * Where users' own design media lives (cloud sync, src/lib/designSync). Its own bucket in
 * production (`R2_USER_DESIGNS_BUCKET`) — user files must never sit beside public catalog media,
 * nor in the AI processing bucket whose objects are temporary by nature. Until that bucket is
 * provisioned, development falls back to the private bucket (which has no expiry rule: only the
 * default "abort incomplete multipart" lifecycle, checked 2026-11-12); every key is under `users/`.
 */
export function getUserDesignsBucketName() {
  return env("R2_USER_DESIGNS_BUCKET", env("R2_PRIVATE_BUCKET", DEFAULT_PRIVATE_BUCKET));
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

// Only plain objects get rebuilt key-by-key. Class instances (Date, Decimal, Buffer, …) carry
// their value internally rather than as enumerable own properties, so `Object.entries` returns
// [] for them and rebuilding would silently collapse them to {} — a Prisma `updatedAt` Date
// reached the client as "[object Object]", which froze the editor's template-reload signature.
// They hold no URLs to rewrite, so pass them through untouched.
function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function rewritePublicObjectUrlsForClient(value) {
  if (typeof value === "string") {
    return rewritePublicObjectUrlForClient(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePublicObjectUrlsForClient(item));
  }
  if (isPlainObject(value)) {
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
  if (isPlainObject(value)) {
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

/**
 * Download an object, optionally a byte range of it.
 *
 * `options.range` is passed through verbatim as the S3 `Range` parameter, so it must already be a
 * well-formed HTTP range spec ("bytes=0-1023"). R2 answers a ranged GET with `ContentRange` set and
 * `ContentLength` narrowed to the slice, which is what the public proxy turns into a 206.
 *
 * ★Ranged reads are not an optimisation here, they are a requirement: AVFoundation refuses to open
 * an HTTP video asset from a server that cannot serve ranges, failing the whole load with
 * -11850 "The server is not correctly configured". Every template video the iOS app renders comes
 * through this function.
 */
export async function getObject(bucket, key, options = {}) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for object download.");
  }

  const range = String(options?.range || "").trim();
  const client = createStorageClient();
  return client.send(
    new GetObjectCommand({
      Bucket: safeBucket,
      Key: safeKey,
      ...(range ? { Range: range } : {}),
    }),
    // Pass the caller's request signal so a client disconnect destroys the upstream socket (before
    // or during the body) instead of leaving it checked out of the pool.
    options?.abortSignal ? { abortSignal: options.abortSignal } : undefined
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

export async function listObjectKeys(bucket, options = {}) {
  const safeBucket = String(bucket || "").trim();
  const prefix = String(options?.prefix || "").trim();
  const maxKeys = Math.max(1, Math.min(1000, Number(options?.maxKeys || 1000)));
  if (!safeBucket) {
    throw new Error("Bucket is required for object listing.");
  }

  const client = createStorageClient();
  const keys = [];
  let continuationToken = undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: safeBucket,
        Prefix: prefix || undefined,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      })
    );

    for (const entry of Array.isArray(response?.Contents) ? response.Contents : []) {
      const key = String(entry?.Key || "").trim();
      if (key) keys.push(key);
    }

    continuationToken = response?.IsTruncated ? response?.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
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
    sha256: Hash.bind(null, "sha256"),
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
      // R2 expects S3-style presigned GET requests to use UNSIGNED-PAYLOAD.
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
  });

  const presigned = await signer.presign(request, {
    expiresIn: Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS)),
    unsignableHeaders: new Set(["x-amz-content-sha256"]),
  });

  return formatHttpRequestUrl(presigned);
}

/**
 * A URL the mobile app can PUT one object to, directly — the bytes never pass through this server
 * (every upload route here buffers the whole body in memory, which a 250 MB video cannot afford).
 *
 * ★`content-length` and `content-type` are SIGNED: R2 answers 403 SignatureDoesNotMatch to a body
 * of any other size or type (verified against R2, 2026-11-12), so a client cannot declare a small
 * file for its quota and then upload a huge one. The caller must send exactly these two headers.
 * A checksum header cannot be enforced the same way — the signer hoists `x-amz-*` headers into
 * the query — so content integrity is checked by size at `complete`, not by hash.
 *
 * @param {string} bucket
 * @param {string} key
 * @param {{ contentLength: number, contentType: string, expiresInSeconds?: number }} options
 * @returns {Promise<string>}
 */
export async function createSignedUploadUrl(
  bucket,
  key,
  { contentLength, contentType, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS }
) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  const length = Number(contentLength);
  const type = String(contentType || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for signed upload URL generation.");
  }
  if (!Number.isSafeInteger(length) || length <= 0 || !type) {
    throw new Error("A positive content length and a content type are required for a signed upload.");
  }

  const endpoint = getEndpointUrl();
  const config = getClientConfig();
  const signer = new SignatureV4({
    credentials: config.credentials,
    region: config.region,
    service: "s3",
    sha256: Hash.bind(null, "sha256"),
    uriEscapePath: false,
  });

  const request = new HttpRequest({
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : undefined,
    method: "PUT",
    path: `/${safeBucket}/${encodeObjectKey(safeKey)}`,
    headers: {
      host: endpoint.host,
      "content-length": String(length),
      "content-type": type,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
  });

  const presigned = await signer.presign(request, {
    expiresIn: Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS)),
    unsignableHeaders: new Set(["x-amz-content-sha256"]),
  });

  return formatHttpRequestUrl(presigned);
}

// ---- Multipart uploads (design media over 32 MB) ------------------------------------------------
// The device uploads each part straight to storage through a signed URL, like a whole file. The
// server never needs the parts' ETags from the device: it asks storage (ListParts) what has arrived,
// which is also what makes an upload resumable after the app or the phone restarts.

/**
 * Starts a multipart upload and returns its id.
 * @param {string} bucket
 * @param {string} key
 * @param {string} contentType
 * @returns {Promise<string>}
 */
export async function createMultipartUpload(bucket, key, contentType) {
  const result = await createStorageClient().send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType })
  );
  if (!result.UploadId) throw new Error("Storage did not return an upload id.");
  return result.UploadId;
}

/**
 * Every part storage holds for [uploadId] (all pages). Throws NoSuchUpload once the upload has been
 * completed, aborted or expired by the bucket's lifecycle rule.
 * @param {string} bucket
 * @param {string} key
 * @param {string} uploadId
 * @returns {Promise<{ partNumber: number, sizeBytes: number, etag: string }[]>}
 */
export async function listUploadedParts(bucket, key, uploadId) {
  const client = createStorageClient();
  const parts = [];
  let marker;
  for (;;) {
    const page = await client.send(
      new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker })
    );
    for (const part of page.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        parts.push({ partNumber: part.PartNumber, sizeBytes: Number(part.Size ?? 0), etag: part.ETag });
      }
    }
    if (!page.IsTruncated || !page.NextPartNumberMarker) break;
    marker = page.NextPartNumberMarker;
  }
  return parts;
}

/**
 * @param {string} bucket
 * @param {string} key
 * @param {string} uploadId
 * @param {{ partNumber: number, etag: string }[]} parts
 */
export async function completeMultipartUpload(bucket, key, uploadId, parts) {
  await createStorageClient().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((left, right) => left.partNumber - right.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    })
  );
}

/** Best-effort: an upload that is already gone is the outcome wanted. */
export async function abortMultipartUpload(bucket, key, uploadId) {
  try {
    await createStorageClient().send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  } catch (error) {
    if (!isNoSuchUpload(error)) throw error;
  }
}

/** Storage no longer knows this upload id (completed, aborted, or expired). */
export function isNoSuchUpload(error) {
  const candidate = /** @type {{ name?: string, Code?: string, $metadata?: { httpStatusCode?: number } } | null} */ (error);
  return candidate?.name === "NoSuchUpload" || candidate?.Code === "NoSuchUpload" || candidate?.$metadata?.httpStatusCode === 404;
}

/**
 * A URL the device can PUT ONE part to. Like createSignedUploadUrl, `content-length` is signed, so
 * a part of any other size is refused by storage (403).
 * @param {string} bucket
 * @param {string} key
 * @param {{ uploadId: string, partNumber: number, contentLength: number, expiresInSeconds?: number }} options
 * @returns {Promise<string>}
 */
export async function createSignedUploadPartUrl(
  bucket,
  key,
  { uploadId, partNumber, contentLength, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS }
) {
  const length = Number(contentLength);
  if (!uploadId || !Number.isSafeInteger(partNumber) || partNumber < 1 || !Number.isSafeInteger(length) || length <= 0) {
    throw new Error("An upload id, a part number and a positive content length are required.");
  }
  const endpoint = getEndpointUrl();
  const config = getClientConfig();
  const signer = new SignatureV4({
    credentials: config.credentials,
    region: config.region,
    service: "s3",
    sha256: Hash.bind(null, "sha256"),
    uriEscapePath: false,
  });
  const request = new HttpRequest({
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : undefined,
    method: "PUT",
    path: `/${String(bucket).trim()}/${encodeObjectKey(String(key).trim())}`,
    query: { partNumber: String(partNumber), uploadId: String(uploadId) },
    headers: {
      host: endpoint.host,
      "content-length": String(length),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
  });
  const presigned = await signer.presign(request, {
    expiresIn: Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS)),
    unsignableHeaders: new Set(["x-amz-content-sha256"]),
  });
  return formatHttpRequestUrl(presigned);
}

/**
 * Like createSignedDownloadUrl, but ALWAYS signed — for a bucket whose objects are private to one
 * user even if the deployment happens to point it at a public bucket by mistake.
 */
export async function createPrivateSignedDownloadUrl(
  bucket,
  key,
  expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS
) {
  const safeBucket = String(bucket || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeBucket || !safeKey) {
    throw new Error("Bucket and key are required for signed URL generation.");
  }

  const endpoint = getEndpointUrl();
  const config = getClientConfig();
  const signer = new SignatureV4({
    credentials: config.credentials,
    region: config.region,
    service: "s3",
    sha256: Hash.bind(null, "sha256"),
    uriEscapePath: false,
  });
  const request = new HttpRequest({
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : undefined,
    method: "GET",
    path: `/${safeBucket}/${encodeObjectKey(safeKey)}`,
    headers: { host: endpoint.host, "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
  });
  const presigned = await signer.presign(request, {
    expiresIn: Math.max(60, Math.round(Number(expiresInSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS)),
    unsignableHeaders: new Set(["x-amz-content-sha256"]),
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
