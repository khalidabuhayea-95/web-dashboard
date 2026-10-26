// CapCut font packages: zip → font → line box (hhea ascender − descender per em).
//
//   node --test src/lib/tools/capcutFonts.server.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { readFileSync } from "node:fs";

import {
  capcutFontResourceIds,
  fontAdvanceMeasure,
  fontFileFromPackage,
  fontLineBox,
  loadCapcutFonts,
  readZipEntries,
} from "./capcutFonts.server.js";

// A minimal sfnt: a table directory with `head` (unitsPerEm) and `hhea` (ascender, descender).
function fakeFont({ unitsPerEm, ascender, descender, typo = null }) {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(unitsPerEm, 18);
  const hhea = Buffer.alloc(36);
  hhea.writeInt16BE(ascender, 4);
  hhea.writeInt16BE(descender, 6);
  const tables = [["head", head], ["hhea", hhea]];
  if (typo) {
    // OS/2 sTypoAscender / sTypoDescender at 68 / 70.
    const os2 = Buffer.alloc(78);
    os2.writeInt16BE(typo.ascender, 68);
    os2.writeInt16BE(typo.descender, 70);
    tables.push(["OS/2", os2]);
  }
  const directory = Buffer.alloc(12 + tables.length * 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tables.length, 4);
  let offset = directory.length;
  tables.forEach(([tag, body], index) => {
    const record = 12 + index * 16;
    directory.write(tag, record, "latin1");
    directory.writeUInt32BE(offset, record + 8);
    directory.writeUInt32BE(body.length, record + 12);
    offset += body.length;
  });
  return Buffer.concat([directory, ...tables.map(([, body]) => body)]);
}

// A zip with deflated entries, laid out like CapCut's (config.json, the font, a macOS fork).
function fakeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const compressed = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

test("line box = (ascender − descender) / unitsPerEm", () => {
  // CapCut's Gloock: 0.98 em (Google's file says 1.20). Pinyon Script: 2555 / 2048.
  assert.equal(fontLineBox(fakeFont({ unitsPerEm: 1000, ascender: 780, descender: -200 })), 0.98);
  assert.ok(Math.abs(fontLineBox(fakeFont({ unitsPerEm: 2048, ascender: 1768, descender: -787 })) - 1.2476) < 1e-4);
  assert.equal(fontLineBox(Buffer.from("not a font")), null);
});

test("the font file is found in a CapCut package, macOS forks skipped", () => {
  const font = fakeFont({ unitsPerEm: 1000, ascender: 993, descender: -362 });
  const zip = fakeZip({
    "config.json": Buffer.from('{"effect":{"Link":[{"type":"InfoSticker"}]},"version":"4.0.0"}'),
    "__MACOSX/._Prata-Regular.ttf": Buffer.from("fork"),
    "Prata-Regular.ttf": font,
  });
  assert.deepEqual(Object.keys(readZipEntries(zip)).sort(), ["Prata-Regular.ttf", "__MACOSX/._Prata-Regular.ttf", "config.json"]);
  const found = fontFileFromPackage(zip);
  assert.equal(found.fileName, "Prata-Regular.ttf");
  assert.equal(fontLineBox(found.bytes), 1.355);
});

test("font resource ids come from the text styles", () => {
  const draft = {
    materials: {
      texts: [
        { content: JSON.stringify({ text: "A", styles: [{ font: { id: "7267841353415922233" } }] }) },
        { content: "plain, not json" },
      ],
    },
  };
  assert.deepEqual([...capcutFontResourceIds(draft)], ["7267841353415922233"]);
});

test("loadCapcutFonts fetches only the fonts the texts use and returns box + file", async () => {
  const analogue = fakeZip({ "config.json": Buffer.from("{}"), "Analogue.otf": fakeFont({ unitsPerEm: 1000, ascender: 818, descender: -200 }) });
  const draft = { materials: { texts: [{ content: JSON.stringify({ text: "Saiful", styles: [{ font: { id: "111" } }] }) }] } };
  const materialList = [
    { schema: "loki://fonts/111", loki_item: { Name: "Analogue", FileUrl: { UrlList: ["https://cdn.example/analogue.zip"] } } },
    { schema: "loki://fonts/222", loki_item: { Name: "Unused", FileUrl: { UrlList: ["https://cdn.example/unused.zip"] } } },
    { schema: "", loki_item: { Name: "Glare", FileUrl: { UrlList: ["https://cdn.example/effect.zip"] } } },
  ];
  const requested = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(analogue);
  };
  try {
    const fonts = await loadCapcutFonts({ draft, materialList });
    assert.deepEqual(requested, ["https://cdn.example/analogue.zip"]);
    assert.equal(fonts.lineBoxes.get("111"), 1.018);
    assert.equal(fonts.files.get("111").fileName, "Analogue.otf");
    assert.deepEqual(fonts.failures, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("heycan font packages (newer templates) are fetched like loki ones", async () => {
  const amiri = fakeZip({ "font.ttf": fakeFont({ unitsPerEm: 1000, ascender: 1124, descender: -634 }), "config.json": Buffer.from("{}") });
  const draft = { materials: { texts: [{ content: JSON.stringify({ text: "محمد", styles: [{ font: { id: "7481210295273262342" } }] }) }] } };
  const materialList = [
    { schema: "heycan://6887766069587481090", heycan_item: { common_attr: { title: "Bounce In", item_urls: ["https://cdn.example/bounce.zip"] } } },
    { schema: "heycan://7481210295273262342", heycan_item: { common_attr: { title: "أميري", item_urls: ["https://cdn.example/amiri.zip"] } } },
  ];
  const requested = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(amiri);
  };
  try {
    const fonts = await loadCapcutFonts({ draft, materialList });
    assert.deepEqual(requested, ["https://cdn.example/amiri.zip"]);
    assert.equal(fonts.lineBoxes.get("7481210295273262342"), 1.758);
    assert.equal(fonts.files.get("7481210295273262342").fileName, "font.ttf");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a line is measured from the font's own advances (cmap + hmtx) — Geist, shipped with next", () => {
  const measure = fontAdvanceMeasure(readFileSync(new URL("../../../node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf", import.meta.url)));
  assert.equal(typeof measure, "function");
  const em = (text) => measure(text);
  assert.ok(em("MMMM") > em("iiii") * 2, `${em("MMMM")} vs ${em("iiii")}`);
  // Twice the text, twice the width; combining marks and format characters add nothing.
  assert.ok(Math.abs(em("Wedding Wedding") - (2 * em("Wedding") + em(" "))) < 1e-9);
  assert.equal(em("a\u0301\u2066"), em("a"));
  // A character the font lacks counts half an em.
  assert.equal(em("\u{1F600}"), 0.5);
  assert.equal(fontAdvanceMeasure(Buffer.from("not a font")), null);
});

test("the line box is the smaller of the hhea and typo boxes (SymphonyPro vs HarmonyOS Sans)", () => {
  // SymphonyPro Bold: hhea 1.20, typo 1.00 → CapCut sizes it by 1.00.
  assert.equal(fontLineBox(fakeFont({ unitsPerEm: 2048, ascender: 1843, descender: -614, typo: { ascender: 1536, descender: -512 } })), 1);
  // HarmonyOS Sans Condensed: hhea 1.213, typo 1.327 → stays 1.213.
  assert.equal(fontLineBox(fakeFont({ unitsPerEm: 1000, ascender: 1013, descender: -200, typo: { ascender: 1027, descender: -300 } })), 1.213);
});
