import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectPortableDocument } from "./portableRefs";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

/**
 * A portable design the way the app writes one (the same shape is pinned on the app side by
 * DesignPortableJsonTest): every kind of media field, on a later page too, plus fields that only
 * LOOK like media.
 */
const portableDesign = {
  id: "project-0001",
  name: "file:///not-a-media-field.png",
  templateThumbnailUrl: "https://cdn.example.com/template.png",
  background: { kind: "image", imageUri: `nayroz-cloud-media:///${H1}.jpg` },
  layers: [
    {
      kind: "image",
      imageUri: `nayroz-cloud-media:///${H2}.png`,
      rasterOriginalUri: "",
      cropSource: { imageUri: `nayroz-cloud-media:///${H2}.png` },
      animatedImage: { uri: "https://media.example.com/a.gif", posterUri: "/api/storage/public/posters/a.webp" },
    },
    { kind: "text", text: "content://a user may type this", fill: { kind: "image", imageUri: "data:image/svg+xml;base64,AAAA" } },
    { kind: "sticker", assetUri: "https://media.example.com/sticker.svg" },
  ],
  pages: [
    {
      id: "page-2",
      background: { kind: "solid", colorHex: "#FFFFFF" },
      layers: [{ kind: "video", videoUri: `nayroz-cloud-media:///${H3}.mp4`, thumbnailUri: `nayroz-cloud-media:///${H1}.jpg` }],
    },
  ],
};

test("finds every device file the document references, once each, on every page", () => {
  const inspection = inspectPortableDocument(portableDesign);
  assert.deepEqual(inspection.mediaHashes, [H1, H2, H3]);
  assert.deepEqual(inspection.nonPortableUris, []);
});

test("only media fields are inspected: a user's own text is never mistaken for a path", () => {
  const inspection = inspectPortableDocument({
    name: "/data/user/0/app/files/x.png",
    layers: [{ kind: "text", text: "file:///tmp/whatever" }],
  });
  assert.deepEqual(inspection, { mediaHashes: [], nonPortableUris: [] });
});

test("a path only one device has makes the document non-portable", () => {
  for (const value of [
    "file:///data/user/0/com.nayroz.android/files/template_assets/asset-1-2-a.png",
    "nayroz-template-asset:///asset-1-a.png",
    "content://media/external/images/1",
    "/var/mobile/Containers/Data/Application/X/Documents/template_assets/a.png",
    "asset://asset-3",
    "nayroz-cloud-media:///not-a-hash.png",
  ]) {
    const inspection = inspectPortableDocument({ layers: [{ kind: "image", imageUri: value }] });
    assert.equal(inspection.nonPortableUris.length, 1, value);
    assert.deepEqual(inspection.mediaHashes, []);
  }
});

test("catalog media stays as it is in every accepted form", () => {
  const inspection = inspectPortableDocument({
    layers: [
      { imageUri: "https://pub.example.r2.dev/templates/a.png" },
      { imageUri: "http://localhost:3000/api/storage/public/templates/a.png" },
      { imageUri: "/api/storage/public/templates/a.png" },
      { imageUri: "" },
      { imageUri: null },
    ],
  });
  assert.deepEqual(inspection, { mediaHashes: [], nonPortableUris: [] });
});

test("the refusal lists a few offenders, not the whole document", () => {
  const inspection = inspectPortableDocument({
    layers: Array.from({ length: 40 }, (_, index) => ({ imageUri: `file:///tmp/${index}.png` })),
  });
  assert.equal(inspection.nonPortableUris.length, 5);
});
