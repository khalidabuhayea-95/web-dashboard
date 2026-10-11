/**
 * Visual-order presentation-form Arabic from Canva imports (production audit H-04 / D-02).
 * Run: node --import tsx --test src/lib/text/arabicPresentationForms.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  firstStrongIsRtl,
  foldArabicPresentationForms,
  normalizeArabicPresentationText,
  normalizeTemplateArabicTextInPlace,
  visualToLogicalLine,
} from "@/lib/text/arabicPresentationForms";
import { resolveImportedTemplateData } from "@/lib/tools/canvaImportTemplate";

test("D-02: template 5376886b's curved title comes back as «تذكير اليوم:»", () => {
  const stored = ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ"; // ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ"
  assert.deepEqual(normalizeArabicPresentationText(stored), {
    text: "تذكير اليوم:",
    changed: true,
    reordered: true,
  });
});

test("logical Arabic with a deliberate ligature is left alone (7b1275a1 and 24 more local templates)", () => {
  for (const text of [
    "المولد النبوي مناسبة لنعود إلى أخلاق المصطفى ﷺ.", // 7b1275a1
    "قال ﷺ: (خير الدعاء دعاء يوم عرفة)",
    "﴿ سورة الإخلاص ﴾   ﴿ سورة الفلق ﴾",
    "بسم الله ﷲ ﷻ ﷽",
    "Plain English text",
    "",
  ]) {
    assert.deepEqual(normalizeArabicPresentationText(text), { text, changed: false, reordered: false }, text);
  }
});

test("shaped text that is already in logical order is folded, never reordered", () => {
  // «تذكير» shaped: initial teh first, final reh last.
  assert.deepEqual(normalizeArabicPresentationText("ﺗﺬﻛﻴﺮ"), {
    text: "تذكير",
    changed: true,
    reordered: false,
  });
});

test("joins decide words whose boundary letters are isolated forms: «السلام» stored reversed", () => {
  // Display order: meem(iso) lam-alef(final) seen(medial) lam(initial) alef(iso).
  assert.equal(normalizeArabicPresentationText("ﻡﻼﺴﻟﺍ").text, "السلام");
  // The lam-alef ligature folds AFTER reordering, so it stays لا, not ال.
  assert.equal(normalizeArabicPresentationText("ﻻ ﺮﻴﺧ").text, "خير لا");
});

test("numbers and Latin keep their own order inside a reordered line", () => {
  // «عام ٢٠٢٦» displayed right-to-left: the number sits on the left, the word reversed after it.
  assert.equal(normalizeArabicPresentationText("٢٠٢٦ ﻡﺎﻋ").text, "عام ٢٠٢٦");
  assert.equal(visualToLogicalLine("ديدج 2026 Instagram روشنم"), "منشور Instagram 2026 جديد");
  assert.equal(visualToLogicalLine("10:00 ةعاسلا"), "الساعة 10:00");
  assert.equal(visualToLogicalLine("Only English here"), "Only English here");
});

test("paired brackets are mirrored back when a line is reordered", () => {
  // «(كتاب)» displayed RTL: the closing glyph is on the left.
  assert.equal(normalizeArabicPresentationText("(ﺏﺎﺘﻛ)").text, "(كتاب)");
});

test("lines are reordered one by one and keep their top-to-bottom order", () => {
  const stored = ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ\n(ﺏﺎﺘﻛ)\nSale 50%";
  assert.equal(normalizeArabicPresentationText(stored).text, "تذكير اليوم:\n(كتاب)\nSale 50%");
});

test("normalisation is idempotent and folding keeps non-presentation text", () => {
  const once = normalizeArabicPresentationText(":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ").text;
  assert.deepEqual(normalizeArabicPresentationText(once), { text: once, changed: false, reordered: false });
  assert.equal(foldArabicPresentationForms("abc ١٢٣ ﷺ"), "abc ١٢٣ ﷺ");
});

test("first strong character decides direction", () => {
  assert.equal(firstStrongIsRtl("تذكير اليوم:"), true);
  assert.equal(firstStrongIsRtl("2026 عام"), true);
  assert.equal(firstStrongIsRtl("Instagram منشور"), false);
  assert.equal(firstStrongIsRtl("123"), false);
});

test("template payloads: every text layer (pages, fabric objects, groups) fixed in place; isRtl set", () => {
  const visual = ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ";
  const data = {
    pages: [
      {
        elements: [
          { type: "image", src: "https://example.test/a.png" },
          { type: "text", text: visual, isRtl: false, textCurveEnabled: true },
          { type: "text", text: "المصطفى ﷺ" },
        ],
      },
    ],
    objects: [{ type: "group", objects: [{ type: "textbox", text: visual }] }],
  };
  const changes = normalizeTemplateArabicTextInPlace(data);
  assert.equal(changes.length, 2);
  assert.equal(data.pages[0].elements[1].text, "تذكير اليوم:");
  assert.equal(data.pages[0].elements[1].isRtl, true);
  assert.equal(data.pages[0].elements[1].textCurveEnabled, true, "nothing else on the layer changes");
  assert.equal(data.pages[0].elements[2].text, "المصطفى ﷺ");
  assert.equal(data.pages[0].elements[2].isRtl, undefined, "untouched layers get no flag");
  assert.equal(data.objects[0].objects[0].text, "تذكير اليوم:");
  assert.deepEqual(changes[0], {
    path: "data.pages[0].elements[1].text",
    before: visual,
    after: "تذكير اليوم:",
    reordered: true,
    isRtlBefore: false,
    isRtlAfter: true,
  });
});

test("the import pipeline stores logical text (every importer goes through resolveImportedTemplateData)", () => {
  const visual = ":مﻮﻴﻟﺍ ﺮﻴﻛﺬﺗ";
  const { data, arabicTextFixes } = resolveImportedTemplateData({
    fabricData: {
      version: "7.0.0",
      objects: [{ type: "textbox", text: visual, left: 10, top: 20, width: 240, fontSize: 50 }],
    },
    editorData: null,
    importMetadata: null,
    imageDataUrl: "",
    canvasWidth: 1080,
    canvasHeight: 1350,
  });
  assert.equal(arabicTextFixes, 1);
  assert.equal(data.objects[0].text, "تذكير اليوم:");
  assert.equal(data.objects[0].isRtl, true);
});
