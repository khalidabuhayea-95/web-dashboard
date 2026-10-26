/**
 * Template search against a real Postgres (production audit H-18; smart search 2026-10-19): the
 * SQL fold, concepts over title / tags / keywords / placement labels, synonyms across languages,
 * typo tolerance, partial matches, audience statuses, and the relevance order.
 *
 * Needs a DISPOSABLE database with the MIGRATIONS applied (not `db push`: the search columns are
 * GENERATED, which push cannot create) — never the shared dev database:
 *   docker run --rm -d --name nayroz-backend-fix-tests -p 127.0.0.1:55433:5432 \
 *     -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=nayroz_fix_test postgres:17
 *   DATABASE_URL=postgresql://test:test@127.0.0.1:55433/nayroz_fix_test npx prisma migrate deploy
 *   NAYROZ_TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:55433/nayroz_fix_test \
 *     node --import tsx --test src/lib/mobile/templateSearch.server.test.ts
 * Skipped when NAYROZ_TEST_DATABASE_URL is not set.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const TEST_DATABASE_URL = process.env.NAYROZ_TEST_DATABASE_URL || "";

function assertDisposableDatabase(url: string) {
  const parsed = new URL(url);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  const disposable = /_test$/.test(parsed.pathname.replace(/^\//, ""));
  if (!local || !disposable) {
    throw new Error(`Refusing to write test rows to ${parsed.hostname}${parsed.pathname}: use a local *_test database.`);
  }
}

const skip = !TEST_DATABASE_URL;
if (!skip) {
  assertDisposableDatabase(TEST_DATABASE_URL);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const OWNER = "00000000-0000-4000-8000-0000000000aa";

const TAXONOMY = {
  categories: [
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
      value: "quotes-content",
      labelEn: "Quotes Content",
      labelAr: "اقتباسات ومحتوى",
      subCategories: [{ value: "motivational-quotes", labelEn: "Motivational Quotes", labelAr: "اقتباسات تحفيزية" }],
    },
  ],
};

type Seed = {
  key: string;
  name: string;
  tags?: string[];
  keywords?: string[];
  status?: string;
  category: string;
  subCategory: string;
  extra?: Array<{ category: string; subCategory: string }>;
};

const SEEDS: Seed[] = [
  { key: "exact", name: "بطاقة رمضان كريم ذهبية", category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "split", name: "كريم العطاء في رمضان", category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "tagOnly", name: "قصة ذهبية بسيطة", tags: ["رمضان", "كريم"], category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "labelOnly", name: "قصة انستجرام خضراء", category: "islamic-religious", subCategory: "ramadan-greeting" },
  { key: "harakat", name: "تَهْنِئَة بِشَهْرِ رَمَضَانَ", category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "fitr", name: "ستوري تهنئة عيد الفطر", category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "dua", name: "صلاة الفجر", category: "islamic-religious", subCategory: "dua-azkar" },
  { key: "secondary", name: "بطاقة مولد", category: "quotes-content", subCategory: "motivational-quotes", extra: [{ category: "islamic-religious", subCategory: "dua-azkar" }] },
  { key: "draft", name: "مسودة رمضان", status: "draft", category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "gazelle", name: "غزال ذهبي", keywords: ["golden", "gazelle"], category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "anniversary", name: "Golden Wedding Anniversary", category: "quotes-content", subCategory: "motivational-quotes" },
  { key: "cake", name: "تورتة الحفلة", category: "quotes-content", subCategory: "motivational-quotes" },
];

let prisma: any;
let Prisma: typeof import("@prisma/client").Prisma;
let findTemplateSearchMatches: typeof import("./templateSearch.server").findTemplateSearchMatches;
let rankTemplateSearchRows: typeof import("./templateSearch.server").rankTemplateSearchRows;
let normalizedSearchSql: typeof import("./templateSearch.server").normalizedSearchSql;
let normalizeSearchText: (value: unknown) => string;
const ids = new Map<string, string>();

async function cleanup() {
  await prisma.template.deleteMany({ where: { ownerId: OWNER } });
}

test.before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).default;
  ({ Prisma } = await import("@prisma/client"));
  ({ findTemplateSearchMatches, rankTemplateSearchRows, normalizedSearchSql } = await import("./templateSearch.server"));
  ({ normalizeSearchText } = await import("@/lib/text/arabicSearch"));
  await cleanup();
  let minute = 0;
  for (const seed of SEEDS) {
    const id = randomUUID();
    ids.set(seed.key, id);
    minute += 1;
    await prisma.template.create({
      data: {
        id,
        ownerId: OWNER,
        name: seed.name,
        slug: `search-test-${seed.key}-${id.slice(0, 8)}`,
        status: seed.status || "published",
        canvasSize: { width: 1080, height: 1920 },
        category: seed.category,
        subCategory: seed.subCategory,
        categories: [{ category: seed.category, subCategory: seed.subCategory }, ...(seed.extra || [])],
        tags: seed.tags || [],
        searchKeywords: seed.keywords || [],
        data: {},
        // Distinct recency so the in-tier order is deterministic: later seeds are newer.
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
      },
    });
  }
});

test.after(async () => {
  if (skip) return;
  await cleanup();
  await prisma.$disconnect();
});

const idsFor = (result: { matches: Map<string, unknown> }) =>
  new Set([...result.matches.keys()].map((id) => [...ids.entries()].find(([, value]) => value === id)?.[0]));

test("the SQL fold equals the JS fold for the same strings", { skip }, async () => {
  const samples = [
    "رَمَضَان",
    "تهنئة",
    "أدعية وأذكار",
    "مُؤْتَمَر ٢٠٢٦ ۱۴۴۷",
    "Ramadan KAREEM",
    "قِصّة انستجـرام",
    "أإآٱ ؤئ کی ى",
    "الرَّحْمٰن",
  ];
  for (const sample of samples) {
    const [row] = await prisma.$queryRaw(
      Prisma.sql`SELECT ${normalizedSearchSql(Prisma.sql`${sample}::text`)} AS folded, nayroz_search_fold(${sample}::text) AS stored`
    );
    assert.equal(row.folded, normalizeSearchText(sample), sample);
    // The stored columns' fold = the same fold, with every non-letter/digit run as one space.
    const words = normalizeSearchText(sample).split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
    assert.equal(row.stored, ` ${words} `, `stored: ${sample}`);
  }
});

test("token-AND over title, tags and placement labels; drafts follow the audience", { skip }, async () => {
  const published = ["published"];
  const kareem = await findTemplateSearchMatches({ query: "رمضان كريم", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.deepEqual(idsFor(kareem), new Set(["exact", "split", "tagOnly"]), "rows with only one of the two words drop out");

  const harakat = await findTemplateSearchMatches({ query: "رَمَضَان", statuses: published, taxonomy: TAXONOMY, translate: false });
  const plain = await findTemplateSearchMatches({ query: "رمضان", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.deepEqual(idsFor(harakat), idsFor(plain));
  assert.ok(idsFor(plain).has("harakat"), "a title written with harakat matches a bare query");
  assert.ok(idsFor(plain).has("labelOnly"), "the Ramadan rail's label covers a title that never says it");
  assert.ok(!idsFor(plain).has("draft"));

  const english = await findTemplateSearchMatches({ query: "Ramadan", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.deepEqual(idsFor(english), idsFor(plain), "an English query reaches the Arabic titles through the synonyms");

  const taMarbuta = await findTemplateSearchMatches({ query: "تهنئه", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.ok(idsFor(taMarbuta).has("fitr") && idsFor(taMarbuta).has("harakat"));

  const fitr = await findTemplateSearchMatches({ query: "عيد فطر", statuses: published, taxonomy: TAXONOMY, translate: false });
  const fitrWithArticle = await findTemplateSearchMatches({ query: "عيد الفطر", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.deepEqual(idsFor(fitr), new Set(["fitr"]));
  assert.deepEqual(idsFor(fitrWithArticle), idsFor(fitr));

  const dua = await findTemplateSearchMatches({ query: "أدعية", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.deepEqual(idsFor(dua), new Set(["dua", "secondary"]), "a secondary placement in `categories` counts");

  const withDrafts = await findTemplateSearchMatches({ query: "رمضان", statuses: ["published", "draft"], taxonomy: TAXONOMY, translate: false });
  assert.ok(idsFor(withDrafts).has("draft"), "a tester audience sees drafts");

  const nothing = await findTemplateSearchMatches({ query: "؟؟", statuses: published, taxonomy: TAXONOMY, translate: false });
  assert.equal(nothing.matches.size, 0);
});

test("relevance: exact title phrase, then all tokens in the title, then tags/labels", { skip }, async () => {
  const result = await findTemplateSearchMatches({ query: "رمضان كريم", statuses: ["published"], taxonomy: TAXONOMY, translate: false });
  // Both words as whole title words (8 + 8); the tag-only row matches both as whole tag words (4 + 4).
  assert.deepEqual(result.matches.get(ids.get("exact")!), { rawHit: true, matched: 2, quality: 16 });
  assert.deepEqual(result.matches.get(ids.get("split")!), { rawHit: false, matched: 2, quality: 16 });
  assert.deepEqual(result.matches.get(ids.get("tagOnly")!), { rawHit: false, matched: 2, quality: 8 });

  // Incoming rows newest-first, as the list route fetches them; a featured tag-only row must still
  // rank below the title hits, and featured leads only inside its own tier.
  const rows = [
    { id: ids.get("tagOnly")!, isFeatured: true, featuredAt: new Date("2026-02-01"), updatedAt: new Date("2026-01-03") },
    { id: ids.get("split")!, isFeatured: false, featuredAt: null, updatedAt: new Date("2026-01-02") },
    { id: ids.get("exact")!, isFeatured: false, featuredAt: null, updatedAt: new Date("2026-01-01") },
  ];
  assert.deepEqual(
    rankTemplateSearchRows(rows, result.matches).map((row) => row.id),
    [ids.get("exact"), ids.get("split"), ids.get("tagOnly")]
  );
});

test("smart search: machine keywords, synonyms, typos and partial matches", { skip }, async () => {
  const published = ["published"];
  const find = (query: string) => findTemplateSearchMatches({ query, statuses: published, taxonomy: TAXONOMY, translate: false });

  // An Arabic-only title answers an English word through its stored keywords.
  assert.deepEqual(idsFor(await find("gazelle")), new Set(["gazelle"]));
  // And an English title answers Arabic through the synonym groups.
  assert.ok(idsFor(await find("زفاف")).has("anniversary"));
  // Dialect spelling: «كيكة» is in the cake group with «تورتة».
  assert.deepEqual(idsFor(await find("كيكة")), new Set(["cake"]));
  // A typo inside a word of 4+ letters.
  assert.ok(idsFor(await find("aniversary")).has("anniversary"));
  // Nothing has both words: the rows matching the one known word come back instead of nothing.
  const partial = await find("غزال زرافة");
  assert.deepEqual(idsFor(partial), new Set(["gazelle"]));
  assert.equal(partial.matches.get(ids.get("gazelle")!)?.matched, 1);
  // Clitics: «بالذهبي» finds «ذهبي».
  assert.ok(idsFor(await find("بالذهبي")).has("gazelle"));
});
