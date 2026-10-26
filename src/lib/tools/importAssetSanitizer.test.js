// A captured video's poster (`thumbnailUri`) is only a preview: when it cannot be fetched the import
// keeps the layer and drops the preview, instead of failing — which used to flatten the whole Canva
// import into one snapshot image (DAHNlFf3ad4: one arch video's poster answered HTTP 403).
//
//   node --import tsx --test src/lib/tools/importAssetSanitizer.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeImportPayloadAssets } from "@/lib/tools/importAssetSanitizer";

const FORBIDDEN_POSTER = "https://video-public.canva.com/VAELyLvdn6o/p/24e00d92d4.jpg?sig=secret";

async function withForbiddenFetch(run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const sanitize = (objects) =>
  sanitizeImportPayloadAssets({
    ownerId: "00000000-0000-4000-8000-000000000000",
    imageDataUrl: "",
    thumbnailDataUrl: "",
    fabricData: { version: "7.0.0", objects },
    sourceLabel: "test",
    rewriteExternalUrls: true,
  });

test("an unreachable video poster is dropped with a warning, the layer is kept", async () => {
  const result = await withForbiddenFetch(() =>
    sanitize([{ type: "video", src: "http://localhost:3000/clip.mp4", thumbnailUri: FORBIDDEN_POSTER }])
  );
  const [video] = result.fabricData.objects;
  assert.equal(video.type, "video");
  assert.equal(video.src, "http://localhost:3000/clip.mp4");
  assert.equal("thumbnailUri" in video, false);
  const warning = result.warnings.find((line) => line.includes("video preview dropped"));
  assert.ok(warning, "expected a dropped-preview warning");
  assert.match(warning, /HTTP 403/);
  assert.match(warning, /video-public\.canva\.com\/VAELyLvdn6o\/p\/24e00d92d4\.jpg/);
  // The signed query never lands in the stored warnings.
  assert.doesNotMatch(warning, /secret/);
});

test("an unreachable layer image still fails the sanitize, as before", async () => {
  await assert.rejects(
    withForbiddenFetch(() => sanitize([{ type: "image", src: FORBIDDEN_POSTER }])),
    /Failed to sanitize import asset at fabricData\.objects\[0\]\.src: HTTP 403/
  );
  // A thumbnail on anything but a video is not a known preview either.
  await assert.rejects(
    withForbiddenFetch(() =>
      sanitize([{ type: "image", src: "http://localhost:3000/a.png", thumbnailUri: FORBIDDEN_POSTER }])
    ),
    /objects\[0\]\.thumbnailUri: HTTP 403/
  );
});
