/**
 * Canva's clipboard payload → pasted image layers.
 *
 *   node --import tsx --test src/lib/editor/canvaClipboard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  canvaPublicMediaUrl,
  decodeCanvaClipboardBase64,
  parseCanvaClipboardHtml,
  parseEmbeddedCanvaMedia,
  placeCanvaPastedImage,
  NAYROZ_CANVA_MEDIA_ATTRIBUTE,
} from "@/lib/editor/canvaClipboard";

// Canva base64-encodes the UTF-16LE bytes of its JSON.
const encodeUtf16 = (text: string) => Buffer.from(text, "utf16le").toString("base64");
const canvaHtml = (json: string) => `<meta charset="utf-8"><div><span data-canva-clipboard="${encodeUtf16(json)}"></span></div>`;

// A plain photo copied from a 1080x1920 story (DAHR4NoHFpw): the box bleeds off the page.
const PHOTO = `{"a":5,"h":"www.canva.com","c":"DAHR4NoHFpw","i":"44Z2i_yNuXhIGdSTSGiAyQ","b":1791384325660,"j":[{}],"n":{"A":{}},"p":false,"A?":"B","A":[{"A":-297.1876117848059,"B":-136.94420468297994,"D":1353.88840936596,"C":902.0281527400707,"A?":"I","_":"LBVgrTjpmTK9NSVM","a":{"B":{"A":{"A?":"d","A":"MAGJtwcbBY4","B":1},"B":{"A":-5.684341886080802e-14,"B":-1.1368683772161603e-13,"D":1353.8884093659601,"C":902.0281527400708}}}}],"B":1080,"C":1920}`;
// A tilted polaroid (DAHR4MPh4ls, 1587x2245 design): the photo is drawn inside the paths' 430.4x500 box.
const POLAROID = `{"a":5,"h":"www.canva.com","c":"DAHR4MPh4ls","i":"LKWWBPtP6JuS4XJw6xJKWQ","b":1791384128283,"j":[{}],"n":{"A":{}},"p":false,"A?":"B","A":[{"A":700.7379237389284,"B":646.808643846661,"D":682.0197604510412,"C":792.3092012674734,"E":16.77677951777954,"A?":"J","_":"LBWzgCqGrHL4TCMB","a":{"D":430.4,"C":500},"b":[{"A":"M426.7 0H1.5z","B":{"C":"#f2f1eb"}},{"A":"M403 23.2H21z","B":{"A":true,"B":{"A":{"A?":"d","A":"MAG91kzRofg","B":1},"B":{"A":23.199999999999932,"B":1.2275056073025894,"D":607.1005883586766,"C":455.8773508947881}}}},{"A":"M404.6 24.3z","B":{"C":"#3c3333"}}]}],"B":1587.4015748031495,"C":2245.03937007874}`;

test("the UTF-16 base64 round-trips", () => {
  assert.equal(decodeCanvaClipboardBase64(encodeUtf16('{"a":1,"x":"نص"}')), '{"a":1,"x":"نص"}');
  assert.equal(decodeCanvaClipboardBase64(""), "");
  assert.equal(decodeCanvaClipboardBase64("***"), "");
});

test("a copied photo: its box, its media id and the rect it is drawn in", () => {
  const payload = parseCanvaClipboardHtml(canvaHtml(PHOTO));
  assert.ok(payload);
  assert.equal(payload.designWidth, 1080);
  assert.equal(payload.designHeight, 1920);
  assert.equal(payload.elements.length, 1);
  const [element] = payload.elements;
  assert.equal(element.id, "LBVgrTjpmTK9NSVM");
  assert.equal(element.kind, "I");
  assert.deepEqual(element.media, { id: "MAGJtwcbBY4", version: 1 });
  assert.equal(Math.round(element.box.top), -297);
  assert.equal(Math.round(element.box.left), -137);
  assert.equal(Math.round(element.box.width), 1354);
  assert.equal(Math.round(element.box.height), 902);
  assert.equal(element.rotation, 0);
  assert.equal(Math.round(element.drawRect!.width), 1354);
  assert.equal(element.unitsWidth, element.box.width);
});

test("a polaroid: the media sits on a path, in the paths' own box, and keeps its tilt", () => {
  const payload = parseCanvaClipboardHtml(canvaHtml(POLAROID));
  assert.ok(payload);
  const [element] = payload.elements;
  assert.equal(element.kind, "J");
  assert.deepEqual(element.media, { id: "MAG91kzRofg", version: 1 });
  assert.equal(Math.round(element.rotation * 100) / 100, 16.78);
  assert.equal(element.unitsWidth, 430.4);
  assert.equal(element.unitsHeight, 500);
  assert.equal(Math.round(element.drawRect!.top * 10) / 10, 23.2);
  assert.equal(Math.round(element.drawRect!.width), 607);
});

test("anything that is not a Canva copy is null", () => {
  assert.equal(parseCanvaClipboardHtml("<img src='x.png'>"), null);
  assert.equal(parseCanvaClipboardHtml(""), null);
  assert.equal(parseCanvaClipboardHtml('<span data-canva-clipboard="AAA">'), null);
});

test("the extension's enrichment maps media ids to pictures; garbage is ignored", () => {
  const pictures = { MAG91kzRofg: { dataUrl: "data:image/jpeg;base64,/9j/", width: 800, height: 600, mimeType: "image/jpeg" }, bad: { dataUrl: "http://x" } };
  const encoded = Buffer.from(JSON.stringify(pictures), "utf8").toString("base64");
  const html = `${canvaHtml(POLAROID)}<span ${NAYROZ_CANVA_MEDIA_ATTRIBUTE}="${encoded}"></span>`;
  const parsed = parseEmbeddedCanvaMedia(html);
  assert.deepEqual(Object.keys(parsed), ["MAG91kzRofg"]);
  assert.equal(parsed.MAG91kzRofg.width, 800);
  assert.deepEqual(parseEmbeddedCanvaMedia(canvaHtml(POLAROID)), {});
});

test("the public CDN pattern", () => {
  assert.equal(canvaPublicMediaUrl({ id: "MAGxRBbGg6Y", version: 1 }), "https://media-public.canva.com/bGg6Y/MAGxRBbGg6Y/1/s.jpg");
  assert.equal(canvaPublicMediaUrl({ id: "abc", version: 1 }), "");
});

test("placing a photo on a same-size page keeps Canva's box and crops to what the box showed", () => {
  const payload = parseCanvaClipboardHtml(canvaHtml(PHOTO))!;
  const placed = placeCanvaPastedImage({ element: payload.elements[0], payload, pageWidth: 1080, pageHeight: 1920, sourceWidth: 1600, sourceHeight: 1067 });
  assert.equal(placed.x, -136.94);
  assert.equal(placed.y, -297.19);
  assert.equal(placed.width, 1353.89);
  assert.equal(placed.height, 902.03);
  // The media fills its box exactly: no crop.
  assert.equal(placed.cropX, 0);
  assert.equal(placed.cropWidth, 1600);
  assert.equal(placed.cropHeight, 1067);
});

test("placing the polaroid on a smaller page scales it, and crops the photo to its path box", () => {
  const payload = parseCanvaClipboardHtml(canvaHtml(POLAROID))!;
  const placed = placeCanvaPastedImage({ element: payload.elements[0], payload, pageWidth: 1357, pageHeight: 1920, sourceWidth: 800, sourceHeight: 600 });
  // Fit the source design into ours: the narrower ratio wins (1357/1587.4 here).
  const scale = Math.min(1357 / 1587.4015748031495, 1920 / 2245.03937007874);
  assert.equal(placed.width, Math.round(682.0197604510412 * scale * 100) / 100);
  assert.equal(placed.rotation, 16.78);
  // Drawn at left 1.23 with width 607 in a 430.4-wide box: the right 177.9 units fall outside.
  const sx = 800 / 607.1005883586766;
  assert.equal(placed.cropX, 0);
  assert.equal(placed.cropWidth, Math.round((430.4 - 1.2275056073025894) * sx * 100) / 100);
  assert.equal(placed.cropY, 0);
  assert.equal(placed.cropHeight, Math.round(455.8773508947881 * (600 / 455.8773508947881) * 100) / 100);
});
