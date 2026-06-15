// Extract a human-readable font family name from sfnt (ttf/otf) bytes by
// reading the OpenType `name` table. Canva-imported fonts arrive named only by
// Canva's opaque id (e.g. "YADkLzugzJU_0"); the real name (e.g. "Laftah") only
// lives inside the font file, so we recover it here for display.
// Returns "" when it can't be determined.

function decodeNameRecord(bytes, platformID) {
  try {
    // Windows (3) and Unicode (0) name records are UTF-16BE; Mac (1) is MacRoman
    // (approximated by latin1, fine for ASCII family names).
    if (platformID === 3 || platformID === 0) {
      return new TextDecoder("utf-16be").decode(bytes).trim();
    }
    return Buffer.from(bytes).toString("latin1").trim();
  } catch (_error) {
    return "";
  }
}

export function extractFontFamilyName(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buf.length < 12) return "";

  const tag = buf.toString("latin1", 0, 4);
  const isSfnt =
    tag === "OTTO" ||
    tag === "true" ||
    tag === "typ1" ||
    (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00);
  // 'ttcf' (font collections) and anything else are unsupported here.
  if (!isSfnt) return "";

  const numTables = buf.readUInt16BE(4);
  let nameOffset = 0;
  let p = 12;
  for (let i = 0; i < numTables && p + 16 <= buf.length; i += 1) {
    if (buf.toString("latin1", p, p + 4) === "name") {
      nameOffset = buf.readUInt32BE(p + 8);
      break;
    }
    p += 16;
  }
  if (!nameOffset || nameOffset + 6 > buf.length) return "";

  const count = buf.readUInt16BE(nameOffset + 2);
  const stringOffset = nameOffset + buf.readUInt16BE(nameOffset + 4);

  // nameID 16 = typographic family (preferred), 1 = legacy family.
  // Prefer Windows (3) > Unicode (0) > Mac (1) > other platforms.
  const candidates = { 16: [], 1: [] };
  let rec = nameOffset + 6;
  for (let i = 0; i < count && rec + 12 <= buf.length; i += 1) {
    const platformID = buf.readUInt16BE(rec);
    const nameID = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const offset = buf.readUInt16BE(rec + 10);
    if ((nameID === 16 || nameID === 1) && stringOffset + offset + length <= buf.length) {
      const value = decodeNameRecord(
        buf.subarray(stringOffset + offset, stringOffset + offset + length),
        platformID
      );
      if (value) {
        const priority = platformID === 3 ? 0 : platformID === 0 ? 1 : platformID === 1 ? 2 : 3;
        candidates[nameID].push({ priority, value });
      }
    }
    rec += 12;
  }

  const pick = (arr) => {
    if (!arr.length) return "";
    arr.sort((a, b) => a.priority - b.priority);
    return arr[0].value;
  };

  const name = pick(candidates[16]) || pick(candidates[1]);
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
