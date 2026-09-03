import {
  createProcessingFailedError,
  createProviderUnavailableError,
} from "../errors";
import {
  decodeSelfhostImage,
  isSelfhostConfigured,
  selfhostRunSync,
} from "../../selfhost/client.server";

const SELFHOST_OBJECT_REMOVAL_MODEL = "selfhost/lama";
const SELFHOST_OBJECT_REMOVAL_OP = "remove-object";

export function getSelfhostObjectRemovalMetadata() {
  return {
    provider: "selfhost",
    model: SELFHOST_OBJECT_REMOVAL_MODEL,
    version: "big-lama",
  };
}

export function assertSelfhostObjectRemovalConfigured() {
  if (!isSelfhostConfigured()) {
    throw createProviderUnavailableError(
      "Self-hosted object removal is not configured (set SELFHOST_AI_URL)."
    );
  }
}

export async function removeObjectViaSelfhost({
  imageBytes,
  maskBytes,
}: {
  imageBytes: Buffer;
  maskBytes: Buffer;
}) {
  assertSelfhostObjectRemovalConfigured();

  const output = await selfhostRunSync({
    op: SELFHOST_OBJECT_REMOVAL_OP,
    image_b64: imageBytes.toString("base64"),
    mask_b64: maskBytes.toString("base64"),
  }).catch((error) => {
    throw createProcessingFailedError(
      error instanceof Error ? error.message : "Self-hosted object removal failed.",
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
