// Replicate prediction plumbing, shared by the server runner and the batch
// card renderer so both talk to the API in exactly the same way.
//
// Deliberately alias-free (plain relative imports only) so scripts/ can import
// it directly without the Next.js module resolver.
//
// Two prediction endpoints exist and the difference is invisible until it 404s:
// Replicate's OFFICIAL models (google/…, flux-kontext-apps/…) accept a bare
// slug at /models/{owner}/{name}/predictions, while community models
// (tencentarc/gfpgan, arielreplicate/deoldify_image) must be run through
// /predictions with a pinned version id. We try the slug and fall back, rather
// than hard-coding version ids that go stale the moment a model is republished.

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 240000;

// Version lookups are stable for the life of a process; one fetch per model.
const versionCache = new Map();

export async function replicateRequest(pathname, token, init = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${REPLICATE_API_BASE}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
    // Accounts under Replicate's low-balance threshold are throttled hard.
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        payload?.detail || payload?.title || `Replicate request failed (${response.status}).`
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }
}

async function latestVersionId(modelId, token) {
  if (versionCache.has(modelId)) return versionCache.get(modelId);
  const model = await replicateRequest(`/models/${modelId}`, token);
  const version = model?.latest_version?.id || "";
  if (!version) throw new Error(`No published version for "${modelId}".`);
  versionCache.set(modelId, version);
  return version;
}

export async function createPrediction(modelId, input, token) {
  try {
    return await replicateRequest(`/models/${modelId}/predictions`, token, {
      method: "POST",
      headers: { prefer: "wait" },
      body: JSON.stringify({ input }),
    });
  } catch (error) {
    if (error.status !== 404) throw error;
    const version = await latestVersionId(modelId, token);
    return replicateRequest("/predictions", token, {
      method: "POST",
      headers: { prefer: "wait" },
      body: JSON.stringify({ version, input }),
    });
  }
}

export async function waitForPrediction(prediction, token) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = prediction;
  while (current.status !== "succeeded") {
    if (current.status === "failed" || current.status === "canceled") {
      throw new Error(current.error || `Prediction ${current.status}.`);
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for the model.");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await replicateRequest(`/predictions/${current.id}`, token);
  }
  return current;
}

export async function downloadPredictionOutput(prediction) {
  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (typeof outputUrl !== "string" || !outputUrl) {
    throw new Error("The model succeeded but returned no image.");
  }
  const response = await fetch(outputUrl);
  if (!response.ok) throw new Error(`Could not download the result (${response.status}).`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") || "image/png",
  };
}
