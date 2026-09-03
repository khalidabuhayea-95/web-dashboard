// Generic client for our self-hosted AI worker (ai-worker/). One contract,
// three deployments — the local dev server, a rented dev pod, and RunPod
// serverless — selected purely by env:
//
//   SELFHOST_AI_URL   e.g. http://127.0.0.1:8484  or  https://api.runpod.ai/v2/<endpoint>
//   SELFHOST_AI_TOKEN optional bearer (the RunPod API key in production)
//
// RunPod's /runsync can return IN_QUEUE/IN_PROGRESS under load; we then poll
// /status/{id} until terminal, staying under the caller's route budget.

// Just under the media routes' own maxDuration (300s): a diffusion op on a
// laptop dev worker can take minutes, and cutting it off client-side burns
// the work the worker already did.
const DEFAULT_TIMEOUT_MS = 290_000;
const POLL_INTERVAL_MS = 1_500;

type SelfhostOutput = {
  image_b64?: string;
  mime_type?: string;
  model?: string;
  device?: string;
  duration_ms?: number;
  [key: string]: unknown;
};

type SelfhostEnvelope = {
  id?: string;
  status?: string;
  output?: SelfhostOutput;
  error?: unknown;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export function getSelfhostBaseUrl(): string {
  return normalizeText(process.env.SELFHOST_AI_URL).replace(/\/+$/, "");
}

export function isSelfhostConfigured(): boolean {
  return Boolean(getSelfhostBaseUrl());
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "web-dashboard/selfhost-ai",
  };
  const token = normalizeText(process.env.SELFHOST_AI_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<SelfhostEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as SelfhostEnvelope | null;
    if (!response.ok) {
      const detail = normalizeText(payload?.error) || `HTTP ${response.status}`;
      throw new Error(`selfhost worker request failed: ${detail}`);
    }
    return payload || {};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("selfhost worker request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminal(status: string) {
  return ["completed", "failed", "cancelled", "timed_out"].includes(status);
}

/**
 * Runs one op on the worker and returns its output map. `input` must contain
 * `op` plus the op's own fields (image_b64, prompt, ...).
 */
export async function selfhostRunSync(
  input: Record<string, unknown>,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<SelfhostOutput> {
  const base = getSelfhostBaseUrl();
  if (!base) {
    throw new Error("SELFHOST_AI_URL is not configured");
  }

  const startedAt = Date.now();
  let envelope = await requestJson(
    `${base}/runsync`,
    { method: "POST", headers: buildHeaders(), body: JSON.stringify({ input }) },
    timeoutMs
  );

  let status = normalizeText(envelope.status).toLowerCase();
  while (!isTerminal(status)) {
    const jobId = normalizeText(envelope.id);
    if (!jobId) break;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("selfhost worker job timed out");
    }
    await delay(POLL_INTERVAL_MS);
    envelope = await requestJson(`${base}/status/${jobId}`, { method: "GET", headers: buildHeaders() }, 30_000);
    status = normalizeText(envelope.status).toLowerCase();
  }

  if (status !== "completed") {
    throw new Error(normalizeText(envelope.error) || `selfhost worker job ${status || "failed"}`);
  }
  if (!envelope.output || typeof envelope.output !== "object") {
    throw new Error("selfhost worker returned no output");
  }
  return envelope.output;
}

/** Decodes the worker's image_b64 output into bytes + mime type. */
export function decodeSelfhostImage(output: SelfhostOutput): { bytes: Buffer; mimeType: string } {
  const b64 = normalizeText(output.image_b64);
  if (!b64) {
    throw new Error("selfhost worker output has no image");
  }
  return {
    bytes: Buffer.from(b64, "base64"),
    mimeType: normalizeText(output.mime_type) || "image/png",
  };
}
