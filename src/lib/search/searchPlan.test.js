import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SEARCH_FOLD_FROM, SEARCH_FOLD_TO, SEARCH_MARKS_CLASS } from "../text/arabicSearch.js";
import {
  attachTranslations,
  buildSearchPlan,
  deriveTokenForms,
  surfacesNeedingTranslation,
  translationTarget,
} from "./searchPlan.js";
import { conceptScoreSql, dedupingParam, minimumMatchedConcepts, planPrefilterSql, scoredSearchCtes } from "./searchSql.js";
import { keywordTargets, keywordsFromText } from "./templateKeywords.server.js";

const variantKeys = (concept, kind) =>
  concept.variants.filter((variant) => !kind || variant.kind === kind).map((variant) => variant.terms.join("+"));

test("the SQL fold function carries the JS fold tables verbatim", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261019120000_add_search_index/migration.sql"),
    "utf8"
  );
  assert.ok(migration.includes(`'${SEARCH_MARKS_CLASS}'`), "tashkeel class");
  assert.ok(migration.includes(`'${SEARCH_FOLD_FROM}'`), "translate() from-table");
  assert.ok(migration.includes(`'${SEARCH_FOLD_TO}'`), "translate() to-table");
});

test("a known phrase is one concept; stopwords are dropped unless they are all there is", () => {
  const plan = buildSearchPlan("بطاقة عيد ميلاد للأطفال");
  assert.deepEqual(plan.concepts.map((concept) => concept.surface), ["بطاقه", "عيد ميلاد", "للاطفال"]);
  const birthday = plan.concepts[1];
  assert.ok(variantKeys(birthday, "synonym").includes("birthday"));
  assert.ok(variantKeys(birthday, "exact").includes("عيد+ميلاد"), "both words anywhere also count");

  assert.deepEqual(buildSearchPlan("في").concepts.map((concept) => concept.surface), ["في"]);
  assert.deepEqual(buildSearchPlan("cake for the party").concepts.map((concept) => concept.surface), ["cake", "party"]);
});

test("synonyms bridge spellings and languages, both ways", () => {
  const [insta] = buildSearchPlan("انستا").concepts;
  assert.ok(variantKeys(insta, "synonym").includes("instagram"));
  assert.ok(variantKeys(insta, "synonym").includes("انستغرام"));
  const [cake] = buildSearchPlan("Cakes").concepts;
  assert.ok(variantKeys(cake, "synonym").includes("كيكه"), "an English plural reaches the Arabic group");
  const [kika] = buildSearchPlan("كيكة").concepts;
  assert.ok(variantKeys(kika, "synonym").includes("cake"));
  assert.ok(variantKeys(kika, "synonym").includes("تورته"));
});

test("derived forms: clitics, light stems and English plurals, never under three letters", () => {
  assert.deepEqual(deriveTokenForms("بالوردي").sort(), ["ورد", "وردي"].sort());
  assert.ok(deriveTokenForms("للاطفال").includes("اطفال"));
  assert.ok(deriveTokenForms("وعيد").includes("عيد"));
  assert.ok(!deriveTokenForms("ورد").includes("رد"), "«ورد» keeps its wāw");
  assert.ok(!deriveTokenForms("كيكه").includes("يكه"), "a one-letter clitic needs four letters behind it");
  assert.deepEqual(deriveTokenForms("flowers"), ["flower"]);
  assert.deepEqual(deriveTokenForms("parties"), ["party"]);
  assert.deepEqual(deriveTokenForms("boxes"), ["box"]);
  assert.deepEqual(deriveTokenForms("glass"), []);
  // The clitic-free form brings its synonyms with it.
  const [pink] = buildSearchPlan("بالوردي").concepts;
  assert.ok(variantKeys(pink, "synonym").includes("pink"));
});

test("only surfaces no synonym bridges are sent to the translator, and translations become variants", () => {
  const plan = buildSearchPlan("زفاف غزال");
  assert.deepEqual(surfacesNeedingTranslation(plan), [{ surface: "غزال", target: "en" }]);
  attachTranslations(plan, new Map([["غزال", "the gazelle"]]));
  assert.deepEqual(variantKeys(plan.concepts[1], "translation"), ["gazelle"]);
  assert.equal(translationTarget("2026"), null);
  assert.equal(translationTarget("hello"), "ar");
});

test("the class SQL ranks title words above tags and keeps every value in a parameter", () => {
  const plan = buildSearchPlan("زفاف");
  const params = [];
  const param = dedupingParam((value) => {
    params.push(value);
    return `$${params.length}`;
  });
  const { exact: sql, fuzzy } = conceptScoreSql(plan.concepts[0], { title: "t.title", tags: "t.tags" }, param);
  assert.ok(fuzzy.includes("word_similarity"), "a four-letter word gets a typo score");
  assert.ok(!sql.includes("زفاف") && !sql.includes("wedding"), "no literal query text in SQL");
  assert.ok(params.includes("% زفاف %") && params.includes("% الزفاف %"), "a whole word, with and without the article");
  assert.ok(params.includes("% wedding %"));
  assert.ok(sql.indexOf("THEN 8") < sql.indexOf("THEN 4"));
  const prefilter = planPrefilterSql(plan, { title: "t.title", tags: "t.tags" }, param);
  assert.ok(prefilter.startsWith("(") && prefilter.includes("LIKE"));
  assert.equal(new Set(params).size, params.length, "each distinct value is bound once");
  assert.equal(minimumMatchedConcepts(buildSearchPlan("دعوة زفاف وردية")), 2);
  const ctes = scoredSearchCtes({
    plan: buildSearchPlan("دعوة زفاف"),
    columns: { title: "t.title", tags: "t.tags" },
    param,
    from: "t",
    where: "TRUE",
    select: [["t.id", "id"]],
  });
  assert.ok(ctes.includes("max(e0) OVER ()") && ctes.includes("max(e1) OVER ()"), "typos only when a concept has no real match");
});

test("template keywords drop stopwords, size noise and bare numbers", () => {
  assert.deepEqual(keywordsFromText("Pink and White Wedding Invitation - A4 Size 3000 x 4200 px"), [
    "pink",
    "white",
    "wedding",
    "invitation",
    "a4",
  ]);
});

test("keyword language follows the name's letters, not a stray Canva size label", () => {
  assert.deepEqual(keywordTargets("Black Minimal Food Menu Instagram Story - قصتك"), ["ar"]);
  assert.deepEqual(keywordTargets("قصة انستقرام منيو مقهى بنمط انيق وبسيط - قصتك"), ["en"]);
  assert.deepEqual(keywordTargets("قصة Instagram بطاقة شكر Thank You Card"), ["en", "ar"]);
  assert.deepEqual(keywordTargets("123 - 456"), []);
});
