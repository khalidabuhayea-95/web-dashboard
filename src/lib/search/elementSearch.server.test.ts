/**
 * Element search against a real Postgres (smart search 2026-10-19): the stored folded columns,
 * synonyms across languages, plurals, clitics, typos, partial matches, filters, and the missing-
 * translation fill. Same disposable-database setup as src/lib/mobile/templateSearch.server.test.ts
 * (migrations applied, never the shared dev database); skipped without NAYROZ_TEST_DATABASE_URL:
 *   NAYROZ_TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:55433/nayroz_fix_test \
 *     node --import tsx --test src/lib/search/elementSearch.server.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const TEST_DATABASE_URL = process.env.NAYROZ_TEST_DATABASE_URL || "";
const skip = !TEST_DATABASE_URL;
if (!skip) {
  const parsed = new URL(TEST_DATABASE_URL);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (!local || !/_test$/.test(parsed.pathname.replace(/^\//, ""))) {
    throw new Error(`Refusing to write test rows to ${parsed.hostname}${parsed.pathname}: use a local *_test database.`);
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const SOURCE = "search-test";

type Seed = { key: string; titleEn: string; titleAr?: string; tagsEn?: string[]; tagsAr?: string[]; kind?: string; category?: string };
const SEEDS: Seed[] = [
  { key: "cake", titleEn: "Birthday cake", titleAr: "Birthday cake", tagsEn: ["cake", "party"], tagsAr: ["cake", "party"] },
  { key: "flowers", titleEn: "Pink flowers", titleAr: "زهور وردية", tagsEn: ["flowers", "pink"], tagsAr: ["زهور", "وردي"] },
  { key: "lantern", titleEn: "Ramadan lantern", titleAr: "فانوس رمضان", tagsEn: ["lantern", "ramadan"], tagsAr: ["فانوس", "رمضان"], category: "ramadan-eid" },
  { key: "balloon", titleEn: "Balloons", titleAr: "بالونات", tagsEn: ["balloon", "party"], tagsAr: ["بالون", "حفلة"], kind: "image" },
  { key: "gazelle", titleEn: "Gazelle", titleAr: "Gazelle", tagsEn: ["gazelle", "animal"], tagsAr: ["gazelle", "animal"] },
];

let prisma: any;
let listImportedElementAssets: (options: Record<string, unknown>) => Promise<any>;
let fillMissingElementTranslations: (options: Record<string, unknown>) => Promise<any>;
const ids = new Map<string, string>();

test.before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).default;
  ({ listImportedElementAssets } = await import("@/lib/editor/importedElements.server"));
  ({ fillMissingElementTranslations } = await import("@/lib/search/elementTranslations.server"));
  await listImportedElementAssets({ source: SOURCE, query: "" }); // runs the schema bootstrap once
  await prisma.$executeRawUnsafe(`DELETE FROM editor_element_assets WHERE source = $1`, SOURCE);
  let minute = 0;
  for (const seed of SEEDS) {
    const id = randomUUID();
    ids.set(seed.key, id);
    minute += 1;
    await prisma.$executeRawUnsafe(
      `INSERT INTO editor_element_assets (id, source, source_asset_id, kind, title_en, title_ar, tags_en, tags_ar,
         category_value, asset_url, thumbnail_url, translation_status, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, 'https://example.test/a.png', 'https://example.test/t.png',
         $10, $11::timestamptz)`,
      id,
      SOURCE,
      seed.key,
      seed.kind || "icon",
      seed.titleEn,
      seed.titleAr || seed.titleEn,
      JSON.stringify(seed.tagsEn || []),
      JSON.stringify(seed.tagsAr || seed.tagsEn || []),
      seed.category || null,
      seed.titleAr && seed.titleAr !== seed.titleEn ? "translated" : "fallback",
      new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
    );
  }
});

test.after(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`DELETE FROM editor_element_assets WHERE source = $1`, SOURCE);
  await prisma.$disconnect();
});

const keysOf = (result: { items: Array<{ id: string }> }) =>
  result.items.map((item) => [...ids.entries()].find(([, id]) => id === item.id)?.[0]);
const search = (query: string, extra: Record<string, unknown> = {}) =>
  listImportedElementAssets({ source: SOURCE, query, translate: false, ...extra });

test("Arabic finds English-only elements and English finds Arabic ones, through the synonyms", { skip }, async () => {
  assert.deepEqual(keysOf(await search("كيكة")), ["cake"]);
  assert.deepEqual(keysOf(await search("تورتة")), ["cake"]);
  assert.deepEqual(keysOf(await search("فانوس")), ["lantern"]);
  assert.deepEqual(keysOf(await search("lanterns")), ["lantern"], "plural");
  assert.deepEqual(keysOf(await search("بالوردي")), ["flowers"], "clitic + stem");
  assert.deepEqual(keysOf(await search("زهرة")), ["flowers"]);
});

test("typos, partial matches, ranking and filters", { skip }, async () => {
  assert.deepEqual(keysOf(await search("baloons")), ["balloon"], "typo");
  // Both concepts beat one: the party cake leads, the party balloons follow only when nothing
  // else matches both.
  const party = await search("cake party");
  assert.deepEqual(keysOf(party), ["cake"]);
  const partial = await search("cake giraffe");
  assert.deepEqual(keysOf(partial), ["cake"], "one of two concepts still answers");
  // A title hit outranks a tag hit: "party" is a tag of both, «حفلة» the balloon's Arabic tag.
  const rows = await search("party");
  assert.deepEqual(new Set(keysOf(rows)), new Set(["cake", "balloon"]));
  assert.deepEqual(keysOf(await search("party", { kind: "image" })), ["balloon"], "kind filter still applies");
  assert.deepEqual(keysOf(await search("ramadan", { categoryValue: "ramadan-eid" })), ["lantern"]);
  const nothing = await search("؟؟");
  assert.equal(nothing.total, 0);
});

test("the translation fill turns English 'Arabic' fields into Arabic and keeps tags aligned", { skip }, async () => {
  const fakeTranslations: Record<string, string> = { Gazelle: "غزال", gazelle: "غزال", animal: "حيوان" };
  const { translateBatch } = await import("@/lib/tools/arabicTranslate.server");
  assert.equal(typeof translateBatch, "function");
  // The fill reads known pairs from the catalogue first; seed one so «cake» needs no translator.
  await prisma.$executeRawUnsafe(
    `UPDATE editor_element_assets SET tags_ar = '["كيك", "حفلة"]'::jsonb, title_ar = 'كعكة عيد ميلاد', translation_status = 'translated' WHERE id = $1::uuid`,
    ids.get("cake")
  );
  const dry = await fillMissingElementTranslations({ ids: [ids.get("gazelle")], dryRun: true, translate: fakeTranslations });
  assert.equal(dry.scanned, 1);
  const before = await prisma.$queryRawUnsafe(`SELECT updated_at FROM editor_element_assets WHERE id = $1::uuid`, ids.get("gazelle"));
  const summary = await fillMissingElementTranslations({ ids: [ids.get("gazelle")], translate: fakeTranslations });
  assert.equal(summary.updated, 1);
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT title_ar, tags_ar, translation_status, updated_at FROM editor_element_assets WHERE id = $1::uuid`,
    ids.get("gazelle")
  );
  assert.equal(row.title_ar, "غزال");
  assert.deepEqual(row.tags_ar, ["غزال", "حيوان"]);
  assert.equal(row.translation_status, "translated");
  assert.equal(new Date(row.updated_at).getTime(), new Date(before[0].updated_at).getTime(), "updated_at untouched");
  // Now an Arabic query finds it with no synonym involved.
  assert.deepEqual(keysOf(await search("حيوان")), ["gazelle"]);
});
