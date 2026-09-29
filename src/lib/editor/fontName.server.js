// Read a font file's own identity — its family name and its weight/italic — from the OpenType
// `name` and `OS/2` tables. Canva-imported fonts arrive named only by Canva's opaque id (e.g.
// "YADkLzugzJU_0") or by a guess from the file stem; the real name only lives inside the file.
//
// Canva serves every font as WOFF2, and this used to read plain sfnt (ttf/otf) only — so the
// import route's name lookup returned "" for every Canva font and the family was stored under the
// extension's guess ("Arimo Bold Italic" for a file that is Arimo Regular, "UKIJ Chi K" for UKIJ
// Chiwer Kesme). WOFF (zlib per table) and WOFF2 (one brotli stream) are unpacked here with
// node:zlib only — fonteditor-core runs in a child process on purpose and must not be pulled
// into route bundles.
//
// Everything returns "" / null when it can't be determined; nothing here throws.
import zlib from "node:zlib";

// WOFF2 §5.1: the tag of a table-directory entry whose flags' low 6 bits are 0..62.
const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca",
  "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

// A WOFF2 stream can decompress to far more than its compressed size; the sfnt total is declared
// in the header, and a font this module is asked about is never larger than this.
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return Buffer.from(input || []);
}

function isSfntTag(tag, buf) {
  return (
    tag === "OTTO" ||
    tag === "true" ||
    tag === "typ1" ||
    (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00)
  );
}

function readSfntTables(buf, wanted) {
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let index = 0, record = 12; index < numTables && record + 16 <= buf.length; index += 1, record += 16) {
    const tag = buf.toString("latin1", record, record + 4);
    if (!wanted.has(tag)) continue;
    const offset = buf.readUInt32BE(record + 8);
    const length = buf.readUInt32BE(record + 12);
    if (offset + length <= buf.length) tables.set(tag, buf.subarray(offset, offset + length));
  }
  return tables;
}

function readWoffTables(buf, wanted) {
  if (buf.length < 44) return null;
  const numTables = buf.readUInt16BE(12);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const entry = 44 + index * 20;
    if (entry + 20 > buf.length) break;
    const tag = buf.toString("latin1", entry, entry + 4);
    if (!wanted.has(tag)) continue;
    const offset = buf.readUInt32BE(entry + 4);
    const compLength = buf.readUInt32BE(entry + 8);
    const origLength = buf.readUInt32BE(entry + 12);
    if (offset + compLength > buf.length) continue;
    const raw = buf.subarray(offset, offset + compLength);
    // WOFF 1.0 §5: a table is zlib-compressed exactly when it came out smaller than the original.
    const data = compLength < origLength ? zlib.inflateSync(raw, { maxOutputLength: origLength }) : raw;
    if (data.length === origLength) tables.set(tag, data);
  }
  return tables;
}

// WOFF2 §4: UIntBase128 — 1 to 5 bytes, 7 bits each, high bit = "more follows", no leading zeros.
function readUIntBase128(buf, position) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (position + index >= buf.length) return null;
    const byte = buf[position + index];
    if (index === 0 && byte === 0x80) return null;
    if (value & 0xfe000000) return null;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: position + index + 1 };
  }
  return null;
}

function readWoff2Tables(buf, wanted) {
  if (buf.length < 48) return null;
  // A collection carries a second directory after the first; a font this app imports never is one.
  if (buf.toString("latin1", 4, 8) === "ttcf") return null;
  const numTables = buf.readUInt16BE(12);
  const totalSfntSize = buf.readUInt32BE(16);
  const totalCompressedSize = buf.readUInt32BE(20);
  let position = 48;
  let offset = 0;
  const spans = [];
  for (let index = 0; index < numTables; index += 1) {
    if (position >= buf.length) return null;
    const flags = buf[position];
    position += 1;
    const tagIndex = flags & 0x3f;
    const transformVersion = (flags >> 6) & 0x03;
    let tag;
    if (tagIndex === 0x3f) {
      if (position + 4 > buf.length) return null;
      tag = buf.toString("latin1", position, position + 4);
      position += 4;
    } else {
      tag = WOFF2_KNOWN_TAGS[tagIndex];
    }
    const origLength = readUIntBase128(buf, position);
    if (!origLength) return null;
    position = origLength.next;
    let length = origLength.value;
    // §5.1: glyf/loca are transformed unless their version is 3 (the null transform); every other
    // table is transformed unless its version is 0. A transformed table stores transformLength.
    const transformed = tag === "glyf" || tag === "loca" ? transformVersion !== 3 : transformVersion !== 0;
    if (transformed) {
      const transformLength = readUIntBase128(buf, position);
      if (!transformLength) return null;
      position = transformLength.next;
      length = transformLength.value;
    }
    // Tables sit back to back in the decompressed stream, in directory order, with no padding.
    if (wanted.has(tag) && !transformed) spans.push({ tag, offset, length });
    offset += length;
  }
  if (spans.length === 0) return new Map();
  if (position + totalCompressedSize > buf.length) return null;
  const limit = Math.min(MAX_DECOMPRESSED_BYTES, Math.max(offset, totalSfntSize));
  const stream = zlib.brotliDecompressSync(buf.subarray(position, position + totalCompressedSize), {
    maxOutputLength: limit,
  });
  const tables = new Map();
  for (const span of spans) {
    if (span.offset + span.length <= stream.length) {
      tables.set(span.tag, stream.subarray(span.offset, span.offset + span.length));
    }
  }
  return tables;
}

/**
 * The raw bytes of the requested tables (`["name", "OS/2"]` by default) from a TTF/OTF, WOFF or
 * WOFF2 file, keyed by tag. Null for anything unreadable (a collection, a truncated file, junk).
 */
export function readFontTables(input, tags = ["name", "OS/2"]) {
  try {
    const buf = toBuffer(input);
    if (buf.length < 12) return null;
    const wanted = new Set(tags);
    const signature = buf.toString("latin1", 0, 4);
    if (signature === "wOF2") return readWoff2Tables(buf, wanted);
    if (signature === "wOFF") return readWoffTables(buf, wanted);
    if (isSfntTag(signature, buf)) return readSfntTables(buf, wanted);
    return null;
  } catch (_error) {
    return null;
  }
}

function decodeNameRecord(bytes, platformID) {
  try {
    // Windows (3) and Unicode (0) name records are UTF-16BE; Mac (1) is MacRoman
    // (approximated by latin1, fine for ASCII family names).
    if (platformID === 3 || platformID === 0) {
      return new TextDecoder("utf-16be").decode(bytes).replace(/\u0000/g, "").trim();
    }
    return Buffer.from(bytes).toString("latin1").trim();
  } catch (_error) {
    return "";
  }
}

// Lower is better. English first: an Arabic font commonly carries its family name in Arabic too
// (Windows language 0x0401), and that must not become the library key when an English one exists.
function nameRecordRank(platformID, languageID) {
  if (platformID === 3) {
    if (languageID === 0x0409) return 0;
    if ((languageID & 0x3ff) === 0x09) return 1;
    return 4;
  }
  if (platformID === 0) return 2;
  if (platformID === 1) return languageID === 0 ? 3 : 5;
  return 6;
}

function readNameRecords(table) {
  const names = new Map();
  if (!table || table.length < 6) return names;
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  for (let index = 0, record = 6; index < count && record + 12 <= table.length; index += 1, record += 12) {
    const platformID = table.readUInt16BE(record);
    const languageID = table.readUInt16BE(record + 4);
    const nameID = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const offset = table.readUInt16BE(record + 10);
    const start = stringOffset + offset;
    if (start + length > table.length) continue;
    const value = decodeNameRecord(table.subarray(start, start + length), platformID);
    if (!value) continue;
    const rank = nameRecordRank(platformID, languageID);
    const existing = names.get(nameID);
    if (!existing || rank < existing.rank) names.set(nameID, { rank, value });
  }
  return names;
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * The family (typographic family, nameID 16, else the legacy family, nameID 1), subfamily and
 * full name, plus what the file says its weight and slant are (OS/2 usWeightClass, fsSelection
 * bit 0). Null when the file can't be read at all.
 */
export function extractFontFaceInfo(input) {
  const tables = readFontTables(input, ["name", "OS/2"]);
  if (!tables) return null;
  const names = readNameRecords(tables.get("name"));
  const typographicFamily = cleanName(names.get(16)?.value);
  const legacyFamily = cleanName(names.get(1)?.value);
  const os2 = tables.get("OS/2");
  const weightClass = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : 0;
  const fsSelection = os2 && os2.length >= 64 ? os2.readUInt16BE(62) : 0;
  return {
    family: typographicFamily || legacyFamily,
    legacyFamily,
    subfamily: cleanName(names.get(17)?.value || names.get(2)?.value),
    fullName: cleanName(names.get(4)?.value),
    // 1..1000 per the spec; 0 when absent. Legacy per-weight families ("Hacen Tunisia Lt") often
    // claim 400 for every cut, so treat it as evidence, not truth.
    weightClass: weightClass >= 1 && weightClass <= 1000 ? weightClass : 0,
    italic: Boolean(fsSelection & 0x01),
  };
}

/** The file's family name (nameID 16, else 1; English preferred), or "". */
export function extractFontFamilyName(input) {
  return extractFontFaceInfo(input)?.family || "";
}
