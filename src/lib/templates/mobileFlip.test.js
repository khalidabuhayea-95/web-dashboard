/**
 * A mirrored layer reaches the app mirrored, whichever of the two encodings the template uses.
 *
 * The editor writes a mirror as a negative scale AND flipX:true (flipSelected keeps them together).
 * A Canva import is stored as a fabric payload until it is re-saved from the editor, and fabric
 * mirrors IN PLACE: flipX:true on a positive scale. The mapper used to read only the scale's sign,
 * so every imported mirror was dropped on mobile — the flipped paper texture and five of six
 * watercolour stickers on the Father's Day story (DAHOhOaWZTw).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toMobileTemplateDetailSlim } from "@/lib/templates/mobileProject";

const layersOf = (data) =>
  toMobileTemplateDetailSlim({ id: "tpl", name: "flip", canvasWidth: 1080, canvasHeight: 1920, data }, {}).project
    .layers;

const fabricImage = (overrides = {}) => ({
  type: "image",
  src: "https://cdn.example.com/sticker.png",
  left: 100,
  top: 200,
  width: 400,
  height: 300,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  originX: "left",
  originY: "top",
  layerType: "image",
  ...overrides,
});

test("a fabric import's flipX mirrors the layer and keeps it in place", () => {
  const [plain, flipped] = layersOf({
    version: "7.0.0",
    objects: [fabricImage(), fabricImage({ flipX: true })],
  });
  assert.equal(plain.transform.flipX, false);
  assert.equal(flipped.transform.flipX, true);
  assert.ok(flipped.transform.scaleX < 0, "scaleX carries the same mirror");
  // Fabric mirrors about the box, so the centre does not move.
  assert.equal(flipped.transform.x, plain.transform.x);
  assert.equal(flipped.transform.y, plain.transform.y);
});

test("a fabric import's flipY mirrors vertically", () => {
  const [flipped] = layersOf({ version: "7.0.0", objects: [fabricImage({ flipY: true })] });
  assert.equal(flipped.transform.flipY, true);
  assert.equal(flipped.transform.flipX, false);
});

test("an editor element's flip (negative scale + flag) stays ONE mirror", () => {
  const editorElement = {
    id: "e1",
    type: "image",
    src: "https://cdn.example.com/sticker.png",
    x: 500,
    y: 200,
    width: 400,
    height: 300,
    rotation: 0,
    scaleX: -1,
    scaleY: 1,
    flipX: true,
    flipY: false,
    opacity: 1,
  };
  const [layer] = layersOf({
    pages: [{ id: "p1", width: 1080, height: 1920, background: { type: "color", color: "#ffffff" }, elements: [editorElement] }],
  });
  assert.equal(layer.transform.flipX, true);
  assert.ok(layer.transform.scaleX < 0);
});
