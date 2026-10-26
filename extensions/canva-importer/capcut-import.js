/* global chrome */
// CapCut web editor import. Loaded into the service worker by background.js (importScripts).
//
// The editor loads a template with ONE signed POST, `/lv/v1/draft/get_package_info`, whose answer
// holds the whole draft as plain JSON plus a signed download link per media file. We repeat that
// request inside the CapCut tab (its cookies carry the login) and forward the answer untouched to
// the dashboard's /api/tools/capcut-import, which maps it to a template. The "sign" header is the
// md5 of a fixed-salt string, copied from CapCut's own draftPreload sidecode.

const CAPCUT_EDITOR_URL_PATTERN = /^https:\/\/www\.capcut\.com\/editor(?:-template)?\/[^/?#]+/i;
const CAPCUT_APP_VERSION = "5.8.0";
const CAPCUT_PLATFORM = "7";

// ── capcut-sign:start
// Compact RFC 1321 md5 over a UTF-8 string, lowercase hex.
function capcutMd5(input) {
  const bytes = Array.from(new TextEncoder().encode(String(input)));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 0; shift < 64; shift += 8) bytes.push(shift < 32 ? (bitLength >>> shift) & 0xff : 0);
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const r = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const m = Array.from({ length: 16 }, (_, i) =>
      bytes[offset + i * 4] | (bytes[offset + i * 4 + 1] << 8) | (bytes[offset + i * 4 + 2] << 16) | (bytes[offset + i * 4 + 3] << 24)
    );
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      const round = i >> 4;
      let f;
      let g;
      if (round === 0) [f, g] = [(b & c) | (~b & d), i];
      else if (round === 1) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (round === 2) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const s = r[round * 4 + (i % 4)];
      const sum = (a + f + k[i] + m[g]) >>> 0;
      [a, d, c] = [d, c, b];
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    [a0, b0, c0, d0] = [(a0 + a) >>> 0, (b0 + b) >>> 0, (c0 + c) >>> 0, (d0 + d) >>> 0];
  }
  return [a0, b0, c0, d0]
    .map((word) => Array.from({ length: 4 }, (_, i) => ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join(""))
    .join("");
}

// Headers CapCut's edit-api expects on get_package_info (draftPreload: pf "7", appvr "5.8.0").
function capcutSignedHeaders(pathname, unixSeconds, appVersion = "5.8.0", platform = "7") {
  const sign = capcutMd5(`9e2c|${String(pathname).slice(-7)}|${platform}|${appVersion}|${unixSeconds}||11ac`);
  return {
    sign,
    "device-time": String(unixSeconds),
    "sign-ver": "1",
    pf: platform,
    appvr: appVersion,
  };
}
// ── capcut-sign:end

function isCapcutEditorUrl(url) {
  return CAPCUT_EDITOR_URL_PATTERN.test(String(url || ""));
}

// Runs in the CapCut tab (MAIN world, so the request rides the editor's own cookies and origin).
async function fetchCapcutPackageInTab(headers) {
  const url = new URL(location.href);
  const packageKey = url.pathname.split("/").filter(Boolean).pop();
  const spaceId = url.searchParams.get("spaceId");
  const workspaceId = url.searchParams.get("workspaceId");
  if (!packageKey || !spaceId || !workspaceId) {
    return { ok: false, error: "Open the template in the CapCut editor (the URL needs spaceId and workspaceId)." };
  }
  let locationInfo = null;
  try {
    locationInfo = JSON.parse(document.getElementById("__GTW_LOCATION_INFO__")?.textContent || "{}").__locationInfo;
  } catch (_error) {
    locationInfo = null;
  }
  const apiDomain = locationInfo?.domain?.web_domain;
  if (!apiDomain) return { ok: false, error: "Could not find CapCut's API domain on this page." };
  const lang = (document.cookie.match(/(?:^| )capcut_locale=([^;]+)/) || [])[1] || "en";
  try {
    const response = await fetch(`${apiDomain}/lv/v1/draft/get_package_info`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        lang,
        package_key: packageKey,
        space_id: spaceId,
        workspace_id: workspaceId,
        region: locationInfo.code,
        app_version: "15.4.0",
        sdk_version: "15.4.0",
        cc_web_version: 0,
        from_email: false,
      }),
    });
    const json = await response.json();
    if (String(json?.ret) !== "0" || !json?.data?.draft) {
      return { ok: false, error: `CapCut refused the template request (${json?.ret}: ${json?.errmsg || response.status}).` };
    }
    return { ok: true, packageInfo: json };
  } catch (error) {
    return { ok: false, error: `CapCut request failed: ${error?.message || error}` };
  }
}

async function importActiveCapcutTab(message, options = {}) {
  const reportProgress = typeof options.reportProgress === "function" ? options.reportProgress : () => {};
  const dashboardUrl = normalizeDashboardUrl(message.dashboardUrl);
  const token = String(message.token || "").trim();
  if (!token) throw new Error("Import token is required.");

  const tab = await chrome.tabs.get(message.tabId);
  if (!isCapcutEditorUrl(tab?.url)) throw new Error("Open a CapCut editor tab first.");

  reportProgress("Reading CapCut template...");
  const headers = capcutSignedHeaders(
    "/lv/v1/draft/get_package_info",
    Math.floor(Date.now() / 1000),
    CAPCUT_APP_VERSION,
    CAPCUT_PLATFORM
  );
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: fetchCapcutPackageInTab,
    args: [headers],
  });
  const result = Array.isArray(injected) ? injected[0]?.result : null;
  if (!result?.ok) throw new Error(result?.error || "Could not read the CapCut template.");
  logger.info("CapCut package read", {
    draftKb: Math.round(String(result.packageInfo?.data?.draft || "").length / 1024),
  });

  reportProgress("Uploading CapCut template to dashboard (media is downloaded by the server)...");
  return postToDashboard({
    endpoint: `${dashboardUrl}/api/tools/capcut-import`,
    token,
    body: {
      packageInfo: result.packageInfo,
      sourceUrl: tab.url,
      name: String(message.name || "").trim() || undefined,
      slug: String(message.slug || "").trim() || undefined,
    },
    reportProgress,
  });
}
