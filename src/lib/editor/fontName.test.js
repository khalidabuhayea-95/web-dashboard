/**
 * The font file's own name and weight, whatever container it arrives in.
 *
 * Canva serves every font as WOFF2, and the reader used to understand plain TTF/OTF only — so the
 * Canva import named families from the extension's guess ("Arimo Bold Italic" for a file that is
 * Arimo Regular). The fixtures in __fixtures__/fonts are tiny synthetic fonts written by
 * fonteditor-core's own TTF / WOFF / WOFF2 writers (so the decoder is checked against an
 * independent encoder, and nothing licensed is committed):
 *   fixture-sans-light:        nameID 1 "Fixture Sans Light", nameID 16 "Fixture Sans", weight 300
 *   fixture-serif-bold-italic: nameID 1 "Fixture Serif" (RIBBI, no nameID 16), weight 700, italic
 * Regenerate with Font.create() → set name / OS/2 → write({type}) if they ever need to change.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { extractFontFaceInfo, extractFontFamilyName, readFontTables } from "@/lib/editor/fontName.server";

const FIXTURES = path.join(process.cwd(), "src/lib/editor/__fixtures__/fonts");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

// WOFF 1.0 with every table zlib-compressed. fonteditor-core's writer stores tiny tables raw, so
// build the compressed container here — it is 44 header bytes plus a 20-byte entry per table.
function toCompressedWoff(ttf) {
  const numTables = ttf.readUInt16BE(4);
  const tables = [];
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    const offset = ttf.readUInt32BE(record + 8);
    const length = ttf.readUInt32BE(record + 12);
    const data = ttf.subarray(offset, offset + length);
    const deflated = zlib.deflateSync(data);
    tables.push({
      tag: ttf.subarray(record, record + 4),
      checksum: ttf.readUInt32BE(record + 4),
      data: deflated.length < data.length ? deflated : data,
      origLength: length,
    });
  }
  const header = Buffer.alloc(44);
  header.write("wOFF", 0, "latin1");
  ttf.copy(header, 4, 0, 4);
  header.writeUInt16BE(numTables, 12);
  const directory = Buffer.alloc(numTables * 20);
  let offset = 44 + directory.length;
  const bodies = [];
  tables.forEach((table, index) => {
    const entry = index * 20;
    table.tag.copy(directory, entry);
    directory.writeUInt32BE(offset, entry + 4);
    directory.writeUInt32BE(table.data.length, entry + 8);
    directory.writeUInt32BE(table.origLength, entry + 12);
    directory.writeUInt32BE(table.checksum, entry + 16);
    const padded = Buffer.alloc((table.data.length + 3) & ~3);
    table.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  const woff = Buffer.concat([header, directory, ...bodies]);
  woff.writeUInt32BE(woff.length, 8);
  return { woff, compressedTables: tables.filter((table) => table.data.length < table.origLength).length };
}

// A minimal sfnt holding only a `name` table built from [platformID, languageID, nameID, text].
function sfntWithNames(records) {
  const encoded = records.map(([platformID, languageID, nameID, text]) => ({
    platformID,
    encodingID: platformID === 1 ? 0 : 1,
    languageID,
    nameID,
    bytes:
      platformID === 1
        ? Buffer.from(text, "latin1")
        : Buffer.from(text, "utf16le").swap16(),
  }));
  const stringOffset = 6 + encoded.length * 12;
  const table = Buffer.alloc(stringOffset + encoded.reduce((sum, record) => sum + record.bytes.length, 0));
  table.writeUInt16BE(0, 0);
  table.writeUInt16BE(encoded.length, 2);
  table.writeUInt16BE(stringOffset, 4);
  let cursor = 0;
  encoded.forEach((record, index) => {
    const at = 6 + index * 12;
    table.writeUInt16BE(record.platformID, at);
    table.writeUInt16BE(record.encodingID, at + 2);
    table.writeUInt16BE(record.languageID, at + 4);
    table.writeUInt16BE(record.nameID, at + 6);
    table.writeUInt16BE(record.bytes.length, at + 8);
    table.writeUInt16BE(cursor, at + 10);
    record.bytes.copy(table, stringOffset + cursor);
    cursor += record.bytes.length;
  });
  const header = Buffer.alloc(12 + 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(1, 4);
  header.write("name", 12, "latin1");
  header.writeUInt32BE(28, 20);
  header.writeUInt32BE(table.length, 24);
  return Buffer.concat([header, table]);
}

for (const format of ["ttf", "woff", "woff2"]) {
  test(`${format}: the typographic family wins over the per-weight legacy family`, () => {
    const info = extractFontFaceInfo(fixture(`fixture-sans-light.${format}`));
    assert.equal(info.family, "Fixture Sans");
    assert.equal(info.legacyFamily, "Fixture Sans Light");
    assert.equal(info.subfamily, "Light");
    assert.equal(info.weightClass, 300);
    assert.equal(info.italic, false);
  });

  test(`${format}: a RIBBI family reads its legacy name, weight and slant`, () => {
    const info = extractFontFaceInfo(fixture(`fixture-serif-bold-italic.${format}`));
    assert.equal(info.family, "Fixture Serif");
    assert.equal(info.subfamily, "Bold Italic");
    assert.equal(info.weightClass, 700);
    assert.equal(info.italic, true);
  });
}

test("a WOFF with zlib-compressed tables reads the same as the TTF it came from", () => {
  const ttf = fixture("fixture-sans-light.ttf");
  const { woff, compressedTables } = toCompressedWoff(ttf);
  assert.ok(compressedTables > 0, "the fixture must actually exercise inflate");
  assert.deepEqual(extractFontFaceInfo(woff), extractFontFaceInfo(ttf));
});

test("the family comes from the English record even when an Arabic one is listed first", () => {
  const font = sfntWithNames([
    [3, 0x0401, 1, "هكن تونس"],
    [3, 0x0409, 1, "Hacen Tunisia"],
    [1, 0, 1, "Mac Name"],
  ]);
  assert.equal(extractFontFamilyName(font), "Hacen Tunisia");
});

test("a font with only a Mac name record still has a family", () => {
  assert.equal(extractFontFamilyName(sfntWithNames([[1, 0, 1, "Mac Only"]])), "Mac Only");
});

test("anything unreadable yields no name and never throws", () => {
  const woff2 = fixture("fixture-sans-light.woff2");
  assert.equal(extractFontFamilyName(Buffer.from("not a font at all")), "");
  assert.equal(extractFontFamilyName(Buffer.alloc(0)), "");
  assert.equal(extractFontFamilyName(woff2.subarray(0, 60)), "");
  const collection = Buffer.from(woff2);
  collection.write("ttcf", 4, "latin1");
  assert.equal(readFontTables(collection), null);
  assert.equal(extractFontFaceInfo(Buffer.from("wOF2 but truncated")), null);
});
