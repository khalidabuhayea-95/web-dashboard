import {
  createProcessingFailedError,
  createProviderUnavailableError,
} from "../errors";
import {
  decodeSelfhostImage,
  isSelfhostConfigured,
  selfhostRunSync,
} from "../../selfhost/client.server";

// Real-ESRGAN x4plus on our own worker — the same weights the Replicate
// entries in this feature wrap (nightmareai/cjwbw/alexgenovese all ship
// x4plus), so switching to it is not a quality trade, only a cost one.
const SELFHOST_IMAGE_UPSCALE_MODEL = "selfhost/real-esrgan";

export function getSelfhostImageUpscaleMetadata() {
  return {
    provider: "selfhost",
    model: SELFHOST_IMAGE_UPSCALE_MODEL,
    version: "real-esrgan-x4plus",
  };
}

export function assertSelfhostImageUpscaleConfigured() {
  if (!isSelfhostConfigured()) {
    throw createProviderUnavailableError(
      "Self-hosted upscaling is not configured (set SELFHOST_AI_URL)."
    );
  }
}

export async function upscaleImageViaSelfhost({
  imageBytes,
  scale,
}: {
  imageBytes: Buffer;
  scale: number;
}) {
  assertSelfhostImageUpscaleConfigured();

  const output = await selfhostRunSync({
    op: "upscale",
    image_b64: imageBytes.toString("base64"),
    scale,
  }).catch((error) => {
    throw createProcessingFailedError(
      error instanceof Error ? error.message : "Self-hosted upscaling failed.",
      { transient: true }
    );
  });

  const decoded = decodeSelfhostImage(output);
  return {
    bytes: decoded.bytes,
    mimeType: decoded.mimeType,
    durationMs: Number(output.duration_ms) || 0,
    device: String(output.device || ""),
  };
}
