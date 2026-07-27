import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for server-side fetches of user/designer-supplied URLs.
 *
 * - Allows only http(s).
 * - Resolves the hostname and rejects any address in a private / loopback /
 *   link-local / carrier-grade-NAT / cloud-metadata range.
 * - Optionally restricts to an allow-list of hostnames.
 * - Re-validates every redirect hop (prevents redirect-to-internal SSRF).
 * - Caps the response body size (prevents memory-exhaustion DoS).
 *
 * Residual risk: DNS rebinding (TOCTOU between validation and the socket
 * connect) is not fully closed without pinning the resolved IP into a custom
 * agent; the redirect re-validation and literal-IP checks cover the common
 * vectors. Prefer passing `allowedHosts` wherever the legitimate hosts are known.
 */

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function ipv4ToLong(ip) {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inRange(long, cidrBase, prefix) {
  const base = ipv4ToLong(cidrBase);
  if (base == null || long == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (long & mask) === (base & mask);
}

// Private / special-use IPv4 ranges that must never be reachable.
const BLOCKED_IPV4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 cloud metadata)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function isBlockedIpv4(ip) {
  const long = ipv4ToLong(ip);
  if (long == null) return true; // unparseable → treat as unsafe
  if (long === 0xffffffff) return true; // broadcast
  return BLOCKED_IPV4.some(([base, prefix]) => inRange(long, base, prefix));
}

function isBlockedIpv6(ip) {
  const lower = String(ip || "").toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — extract and check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true; // not a valid IP → unsafe
}

function hostAllowed(hostname, allowedHosts) {
  if (!allowedHosts || allowedHosts.length === 0) return true;
  const host = String(hostname || "").toLowerCase();
  return allowedHosts.some((allowed) => {
    const a = String(allowed || "").toLowerCase();
    return host === a || host.endsWith(`.${a}`);
  });
}

export async function assertPublicUrl(rawUrl, { allowedHosts } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed.");
  }
  const hostname = url.hostname;
  if (!hostAllowed(hostname, allowedHosts)) {
    throw new Error(`Host is not allowed: ${hostname}`);
  }

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      throw new Error(`Unable to resolve host: ${hostname}`);
    }
  }
  if (!addresses.length) {
    throw new Error(`Unable to resolve host: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`Blocked internal address for host ${hostname}: ${address}`);
    }
  }
  return url.toString();
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw new Error("Remote response exceeds the size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("Remote response exceeds the size limit.");
    return buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error("Remote response exceeds the size limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch a remote resource with SSRF protection, redirect re-validation and a
 * hard body-size cap. Returns { bytes, mimeType, finalUrl }.
 */
export async function fetchPublicResource(
  rawUrl,
  {
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowedHosts,
    headers = {},
    accept,
  } = {}
) {
  let currentUrl = await assertPublicUrl(rawUrl, { allowedHosts });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: accept || "image/*,application/octet-stream,*/*",
          ...headers,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect without a location.");
        // Re-validate the redirect target against the same guard.
        currentUrl = await assertPublicUrl(new URL(location, currentUrl).toString(), {
          allowedHosts,
        });
        continue;
      }

      if (!response.ok) {
        throw new Error(`Download failed (${response.status}).`);
      }

      const bytes = await readCapped(response, maxBytes);
      return {
        bytes,
        mimeType: response.headers.get("content-type") || "",
        finalUrl: currentUrl,
      };
    }
    throw new Error("Too many redirects.");
  } finally {
    clearTimeout(timeout);
  }
}
