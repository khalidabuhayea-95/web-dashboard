/**
 * What a Canva import may do to a font family the library already holds.
 *
 * It used to REPLACE the family: every file kind the design didn't use was deleted, the family was
 * re-tagged `custom` and its aliases were rewritten — so a design using two cuts of a Google font
 * would strip that family to two cuts. Now it only adds, and corrects a custom family's file only
 * when the file itself admits (OS/2 weight) that it sits in the wrong slot.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fileFaceMatches, planFontFamilyMerge } from "@/lib/editor/fontMergePlan";

const regular = { weightClass: 400, italic: false };
const light = { weightClass: 300, italic: false };
const bold = { weightClass: 700, italic: false };
const stored = (kind, weight = 400, style = "normal") => ({ id: `file-${kind}`, kind, weight, style });

test("a curated family only gains the cuts it lacks", () => {
  const plan = planFontFamilyMerge({
    isCustom: false,
    storedFiles: [stored("mobile")],
    cuts: [
      { isPrimary: true, weight: 400, style: "normal", payloadInfo: regular },
      { weight: 700, style: "normal", payloadInfo: bold },
    ],
  });
  assert.deepEqual(plan.steps, [{ cutIndex: 1, kind: "mobile@700", replaces: false, rekind: null }]);
  assert.deepEqual(plan.needsStoredInfo, []);
});

test("a curated family's slot is never replaced, even by a better file", () => {
  const plan = planFontFamilyMerge({
    isCustom: false,
    storedFiles: [stored("mobile")],
    cuts: [{ isPrimary: true, weight: 400, style: "normal", payloadInfo: regular }],
    storedInfoByKind: new Map([["mobile", bold]]),
  });
  assert.deepEqual(plan.steps, []);
});

test("a Light-only design lands at 300, not in the default slot", () => {
  const plan = planFontFamilyMerge({
    isCustom: false,
    storedFiles: [stored("mobile")],
    cuts: [{ isPrimary: true, weight: 300, style: "normal", payloadInfo: light }],
  });
  assert.deepEqual(plan.steps, [{ cutIndex: 0, kind: "mobile@300", replaces: false, rekind: null }]);
});

test("a family with no default face gets the primary cut as one", () => {
  const plan = planFontFamilyMerge({
    isCustom: true,
    storedFiles: [stored("mobile@700", 700)],
    cuts: [{ isPrimary: true, weight: 300, style: "normal", payloadInfo: light }],
  });
  assert.deepEqual(plan.steps, [{ cutIndex: 0, kind: "mobile", replaces: false, rekind: null }]);
});

test("a custom family's bold-in-the-400-slot is replaced, and the bold kept at 700", () => {
  const input = {
    isCustom: true,
    storedFiles: [stored("mobile")],
    cuts: [{ isPrimary: true, weight: 400, style: "normal", payloadInfo: regular }],
  };
  const firstPass = planFontFamilyMerge(input);
  assert.deepEqual(firstPass.needsStoredInfo, ["mobile"], "asks about the slot before touching it");
  assert.deepEqual(firstPass.steps, []);

  const plan = planFontFamilyMerge({ ...input, storedInfoByKind: new Map([["mobile", bold]]) });
  assert.deepEqual(plan.steps, [
    { cutIndex: 0, kind: "mobile", replaces: true, rekind: { fileId: "file-mobile", kind: "mobile@700" } },
  ]);
});

test("the displaced file is dropped, not kept, when the design brings that weight itself", () => {
  const plan = planFontFamilyMerge({
    isCustom: true,
    storedFiles: [stored("mobile")],
    cuts: [
      { isPrimary: true, weight: 400, style: "normal", payloadInfo: regular },
      { weight: 700, style: "normal", payloadInfo: bold },
    ],
    storedInfoByKind: new Map([["mobile", bold]]),
  });
  assert.deepEqual(plan.steps, [
    { cutIndex: 0, kind: "mobile", replaces: true, rekind: null },
    { cutIndex: 1, kind: "mobile@700", replaces: false, rekind: null },
  ]);
});

test("a legacy family whose every cut claims 400 is never 'corrected'", () => {
  // Hacen Tunisia Lt, Regular and Bd all report usWeightClass 400.
  const plan = planFontFamilyMerge({
    isCustom: true,
    storedFiles: [stored("mobile")],
    cuts: [{ isPrimary: true, weight: 400, style: "normal", payloadInfo: regular }],
    storedInfoByKind: new Map([["mobile", regular]]),
  });
  assert.deepEqual(plan.steps, []);
});

test("no evidence, no replacement", () => {
  const unknownPayload = planFontFamilyMerge({
    isCustom: true,
    storedFiles: [stored("mobile")],
    cuts: [{ isPrimary: true, weight: 400, style: "normal", payloadInfo: null }],
  });
  assert.deepEqual(unknownPayload, { steps: [], needsStoredInfo: [] });

  const unreadableStored = planFontFamilyMerge({
    isCustom: true,
    storedFiles: [stored("mobile")],
    cuts: [{ isPrimary: true, weight: 400, style: "normal", payloadInfo: regular }],
    storedInfoByKind: new Map([["mobile", null]]),
  });
  assert.deepEqual(unreadableStored.steps, []);
});

test("two cuts for one slot: the first wins", () => {
  const plan = planFontFamilyMerge({
    isCustom: false,
    storedFiles: [stored("mobile")],
    cuts: [
      { isPrimary: true, weight: 700, style: "normal", payloadInfo: bold },
      { weight: 700, style: "normal", payloadInfo: bold },
    ],
  });
  assert.deepEqual(plan.steps, [{ cutIndex: 0, kind: "mobile@700", replaces: false, rekind: null }]);
});

test("fileFaceMatches: weight within a class, slant exact, unknown when the file is silent", () => {
  assert.equal(fileFaceMatches({ weightClass: 450, italic: false }, 400, "normal"), true);
  assert.equal(fileFaceMatches({ weightClass: 500, italic: false }, 400, "normal"), false);
  assert.equal(fileFaceMatches({ weightClass: 400, italic: true }, 400, "normal"), false);
  assert.equal(fileFaceMatches({ weightClass: 0, italic: false }, 400, "normal"), null);
  assert.equal(fileFaceMatches(null, 400, "normal"), null);
});
