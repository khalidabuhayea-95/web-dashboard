/**
 * Arabic-aware search normalisation (production audit H-18 / PAR-02).
 * Run: node --import tsx --test src/lib/text/arabicSearch.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  SEARCH_MARKS_CLASS,
  matchTaxonomyLabels,
  normalizeSearchText,
  toContainsPattern,
  tokenizeSearchQuery,
} from "@/lib/text/arabicSearch";

test("tashkeel, superscript alef and tatweel are dropped", () => {
  assert.equal(normalizeSearchText("رَمَضَان"), "رمضان");
  assert.equal(normalizeSearchText("رمـــضان"), "رمضان");
  assert.equal(normalizeSearchText("الرَّحْمٰن"), "الرحمن");
  assert.equal(normalizeSearchText("تخرّج"), "تخرج");
});

test("hamza/alef forms, ta marbuta, alef maksura, waw/yeh hamza and Persian kaf/yeh fold", () => {
  assert.equal(normalizeSearchText("أإآٱ"), "اااا");
  assert.equal(normalizeSearchText("تهنئة"), normalizeSearchText("تهنئه"));
  assert.equal(normalizeSearchText("مستشفى"), "مستشفي");
  assert.equal(normalizeSearchText("مؤتمر"), "موتمر");
  assert.equal(normalizeSearchText("أدعية"), "ادعيه");
  assert.equal(normalizeSearchText("کتاب"), normalizeSearchText("كتاب"));
  assert.equal(normalizeSearchText("فارسی"), "فارسي");
});

test("Arabic-Indic digits become ASCII, Latin is lowercased, whitespace collapses", () => {
  assert.equal(normalizeSearchText("عام ٢٠٢٦"), "عام 2026");
  assert.equal(normalizeSearchText("۱۴۴۷"), "1447");
  assert.equal(normalizeSearchText("  Ramadan   KAREEM "), "ramadan kareem");
});

test("normalisation is idempotent", () => {
  for (const sample of ["رَمَضَان كَرِيم", "تهنئة عيد الفطر ١٤٤٦", "Eid Mubarak", "أدعية وأذكار"]) {
    const once = normalizeSearchText(sample);
    assert.equal(normalizeSearchText(once), once);
  }
});

test("the SQL fold tables are equal length and agree with the JS fold, character by character", () => {
  assert.equal([...SEARCH_FOLD_FROM].length, [...SEARCH_FOLD_TO].length);
  // Emulate Postgres: regexp_replace(marks) → translate(from, to) → lower().
  const marks = new RegExp(SEARCH_MARKS_CLASS, "gu");
  const from = [...SEARCH_FOLD_FROM];
  const to = [...SEARCH_FOLD_TO];
  const sqlLike = (value) =>
    [...value.replace(marks, "")]
      .map((char) => (from.includes(char) ? to[from.indexOf(char)] : char))
      .join("")
      .toLowerCase();
  for (const sample of ["رَمَضَان", "تهنئة", "إسلامية", "مُؤْتَمَر ٢٠٢٦", "ALLAH أكبر", "قِصّة انستجرام"]) {
    assert.equal(sqlLike(sample), normalizeSearchText(sample));
  }
});

test("tokens: split, de-duplicated, article ignored only when 3+ letters remain", () => {
  assert.deepEqual(tokenizeSearchQuery("رمضان كريم"), ["رمضان", "كريم"]);
  assert.deepEqual(tokenizeSearchQuery("عيد الفطر"), tokenizeSearchQuery("عيد فطر"));
  assert.deepEqual(tokenizeSearchQuery("عيد فطر"), ["عيد", "فطر"]);
  assert.deepEqual(tokenizeSearchQuery("الله"), ["الله"], "«الله» must not collapse to «له»");
  assert.deepEqual(tokenizeSearchQuery("رَمَضَان"), ["رمضان"]);
  assert.deepEqual(tokenizeSearchQuery("تهنئة، تهنئه!"), ["تهنيه"]);
  assert.deepEqual(tokenizeSearchQuery("Ramadan"), ["ramadan"]);
});

test("tokens: one-letter words are dropped beside real ones, kept when alone; punctuation-only is empty", () => {
  assert.deepEqual(tokenizeSearchQuery("أبيض و أسود"), ["ابيض", "اسود"]);
  assert.deepEqual(tokenizeSearchQuery("و"), ["و"]);
  assert.deepEqual(tokenizeSearchQuery("!!! ..."), []);
  assert.deepEqual(tokenizeSearchQuery(""), []);
  assert.equal(tokenizeSearchQuery("a b c d e f g h i j k l").length <= 8, true);
});

test("LIKE metacharacters in a token are escaped", () => {
  assert.equal(toContainsPattern("رمضان"), "%رمضان%");
  assert.equal(toContainsPattern("50%_off\\"), "%50\\%\\_off\\\\%");
});

test("taxonomy labels match in Arabic and English; a category hit covers the category", () => {
  const categories = [
    {
      value: "islamic-religious",
      labelEn: "Islamic Religious",
      labelAr: "دينية إسلامية",
      subCategories: [
        { value: "ramadan-greeting", labelEn: "Ramadan Greeting", labelAr: "تهنئة رمضان" },
        { value: "dua-azkar", labelEn: "Dua Azkar", labelAr: "أدعية وأذكار" },
        { value: "eid-fitr-greeting", labelEn: "Eid Fitr Greeting", labelAr: "تهنئة عيد الفطر" },
      ],
    },
    {
      value: "occasions-holidays",
      labelEn: "Occasions Holidays",
      labelAr: "مناسبات وأعياد",
      subCategories: [{ value: "mothers-day", labelEn: "Mothers Day", labelAr: "عيد الأم" }],
    },
  ];
  const [ramadan] = matchTaxonomyLabels(tokenizeSearchQuery("Ramadan"), categories);
  assert.deepEqual(ramadan.pairs, [{ category: "islamic-religious", subCategory: "ramadan-greeting" }]);
  assert.deepEqual(ramadan.categoryValues, []);

  const [dua] = matchTaxonomyLabels(tokenizeSearchQuery("أدعية"), categories);
  assert.deepEqual(dua.pairs, [{ category: "islamic-religious", subCategory: "dua-azkar" }]);

  const [islamic] = matchTaxonomyLabels(tokenizeSearchQuery("إسلامية"), categories);
  assert.deepEqual(islamic.categoryValues, ["islamic-religious"]);
  assert.deepEqual(islamic.pairs, [], "the whole category is in; no sub-category pairs on top");

  const [eid, fitr] = matchTaxonomyLabels(tokenizeSearchQuery("عيد فطر"), categories);
  assert.deepEqual(fitr.pairs, [{ category: "islamic-religious", subCategory: "eid-fitr-greeting" }]);
  assert.ok(eid.pairs.some((pair) => pair.subCategory === "mothers-day"));
  assert.ok(eid.pairs.some((pair) => pair.subCategory === "eid-fitr-greeting"));
});
