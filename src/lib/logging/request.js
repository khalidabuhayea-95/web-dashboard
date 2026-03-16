export const REQUEST_ID_HEADER = "x-request-id";

function createRequestId() {
  if (globalThis?.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readHeader(source, key) {
  if (!source) return "";
  if (typeof source.get === "function") {
    return String(source.get(key) || "").trim();
  }
  return String(source[key] || "").trim();
}

export function resolveRequestId(requestOrHeaders) {
  const headers =
    requestOrHeaders && typeof requestOrHeaders === "object" && "headers" in requestOrHeaders
      ? requestOrHeaders.headers
      : requestOrHeaders;
  const fromRequestId = readHeader(headers, REQUEST_ID_HEADER);
  const fromCorrelationId = readHeader(headers, "x-correlation-id");
  return fromRequestId || fromCorrelationId || createRequestId();
}

export function ensureRequestIdHeaders(inputHeaders) {
  const requestId = resolveRequestId(inputHeaders);
  const requestHeaders = new Headers(inputHeaders || undefined);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  return { requestId, requestHeaders };
}

export function attachRequestIdHeader(response, requestId) {
  if (!response || !requestId) return response;
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function getRequestLogContext(request, requestId) {
  const fallbackRequestId = resolveRequestId(request);
  const resolvedRequestId = String(requestId || fallbackRequestId).trim() || fallbackRequestId;
  const method = String(request?.method || "").trim().toUpperCase() || "GET";
  let path = "";
  try {
    path = new URL(request?.url || "").pathname || "";
  } catch (_error) {
    path = "";
  }
  return {
    requestId: resolvedRequestId,
    method,
    path,
  };
}

