// Runs one AI-template render on Replicate for the admin "generate" flow.
// Mirrors scripts/render-ai-templates.mjs: bare-slug model predictions,
// prefer:wait plus polling, and 429 retries for low-balance throttling.

import {
  buildAiTemplateModelInput,
  getAiTemplateModelDefinition,
} from "./models";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 240000;

async function replicateRequest(pathname, token, init = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${REPLICATE_API_BASE}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload?.detail || payload?.title || `Replicate request failed (${response.status}).`
      );
    }
    return payload;
  }
}

async function waitForPrediction(prediction, token) {
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

// imageBuffer null => text-to-image. Returns the rendered image bytes.
export async function runAiTemplateRender({ modelId, prompt, imageBuffer, imageMime }) {
  const definition = getAiTemplateModelDefinition(modelId);
  if (!definition) throw new Error(`Unsupported model "${modelId}".`);

  const token = String(process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN is not configured.");

  const imageDataUri = imageBuffer
    ? `data:${imageMime || "image/jpeg"};base64,${imageBuffer.toString("base64")}`
    : null;
  const input = buildAiTemplateModelInput(definition, prompt, imageDataUri);

  const created = await replicateRequest(`/models/${definition.id}/predictions`, token, {
    method: "POST",
    headers: { prefer: "wait" },
    body: JSON.stringify({ input }),
  });
  const finished = await waitForPrediction(created, token);

  const outputUrl = Array.isArray(finished.output) ? finished.output[0] : finished.output;
  if (typeof outputUrl !== "string" || !outputUrl) {
    throw new Error("The model succeeded but returned no image.");
  }
  const imageResponse = await fetch(outputUrl);
  if (!imageResponse.ok) {
    throw new Error(`Could not download the rendered image (${imageResponse.status}).`);
  }
  return {
    buffer: Buffer.from(await imageResponse.arrayBuffer()),
    predictionId: finished.id,
    model: definition.id,
  };
}
