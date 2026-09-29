// What an import may do to a font family the library ALREADY holds — decided without any I/O, so
// the rules can be tested. customFonts.server.js runs the plan (converts, uploads, writes rows).
//
// The rules, in order of how often they matter:
//  1. A cut the family lacks is added at the weight/style the design declared for it. A family
//     that has no default face gets the design's primary cut as one.
//  2. A cut the family already has is left alone — in a curated family (Google, appchief) always.
//  3. Only in a CUSTOM family, and only on the files' own evidence: when the stored file's OS/2
//     weight/slant contradicts its slot and the incoming file matches it, the incoming file takes
//     the slot. (An early import once put Arimo BOLD in the 400 slot; every template rendered
//     bold.) The displaced file moves to the slot it really is when nothing else claims that one.
//  Nothing is ever deleted, renamed or re-tagged.
import { FONT_FILE_KIND_MOBILE, buildFontFileKind } from "@/lib/editor/fontVariants";

/**
 * Whether a file's own weight/slant fits a slot: true / false, or null when the file does not
 * say. Legacy per-weight families ("Hacen Tunisia Lt") claim 400 for every cut, so a match is
 * weak evidence — only a file that ADMITS a different weight counts as a mismatch.
 */
export function fileFaceMatches(info, weight, style) {
  if (!info || !Number(info.weightClass)) return null;
  return Math.abs(Number(info.weightClass) - Number(weight)) < 100 && Boolean(info.italic) === (style === "italic");
}

export function roundedWeightClass(weightClass) {
  return Math.max(100, Math.min(900, Math.round((Number(weightClass) || 400) / 100) * 100));
}

/**
 * @param {object} input
 * @param {boolean} input.isCustom  the family's source is `custom` (ours to correct)
 * @param {Array<{id: string, kind: string, weight: number, style: string}>} input.storedFiles
 * @param {Array<{isPrimary?: boolean, weight: number, style: string, payloadInfo?: object|null}>} input.cuts
 *   the design's cuts; payloadInfo = extractFontFaceInfo of the incoming file
 * @param {Map<string, object|null>} [input.storedInfoByKind]  extractFontFaceInfo of stored files
 *   the plan asked about (see needsStoredInfo); absent kinds are simply not replaced yet
 * @returns {{
 *   steps: Array<{cutIndex: number, kind: string, replaces: boolean, rekind: {fileId: string, kind: string}|null}>,
 *   needsStoredInfo: string[],
 * }}
 *   Run a step's rekind ONLY if its own file was stored — otherwise a failed upload would leave the
 *   slot it vacated empty.
 */
export function planFontFamilyMerge({ isCustom, storedFiles = [], cuts = [], storedInfoByKind = new Map() }) {
  const storedByKind = new Map(storedFiles.map((file) => [String(file.kind || "").toLowerCase(), file]));
  const hasDefaultFace = storedByKind.has(FONT_FILE_KIND_MOBILE);
  const cutKinds = cuts.map((cut) =>
    cut.isPrimary && !hasDefaultFace
      ? FONT_FILE_KIND_MOBILE
      : buildFontFileKind(FONT_FILE_KIND_MOBILE, cut.weight, cut.style)
  );
  const claimed = new Set(storedByKind.keys());
  const seen = new Set();
  const steps = [];
  const needsStoredInfo = [];

  cuts.forEach((cut, cutIndex) => {
    const kind = cutKinds[cutIndex];
    if (seen.has(kind)) return;
    seen.add(kind);
    const stored = storedByKind.get(kind);
    if (!stored) {
      steps.push({ cutIndex, kind, replaces: false, rekind: null });
      claimed.add(kind);
      return;
    }
    if (!isCustom) return;
    if (fileFaceMatches(cut.payloadInfo, stored.weight, stored.style) !== true) return;
    if (!storedInfoByKind.has(kind)) {
      needsStoredInfo.push(kind);
      return;
    }
    const storedInfo = storedInfoByKind.get(kind);
    if (fileFaceMatches(storedInfo, stored.weight, stored.style) !== false) return;
    const trueKind = buildFontFileKind(
      FONT_FILE_KIND_MOBILE,
      roundedWeightClass(storedInfo.weightClass),
      storedInfo.italic ? "italic" : "normal"
    );
    const keepDisplaced = trueKind !== kind && !claimed.has(trueKind) && !cutKinds.includes(trueKind);
    if (keepDisplaced) claimed.add(trueKind);
    steps.push({
      cutIndex,
      kind,
      replaces: true,
      rekind: keepDisplaced ? { fileId: stored.id, kind: trueKind } : null,
    });
  });

  return { steps, needsStoredInfo };
}
