#!/usr/bin/env node
// Seeds the flat list of MAIN element categories (AR + EN labels, stable `value` keys) into the
// `element_categories_v1` app setting — the sibling of scripts/seed-background-categories.mjs.
//
//   node scripts/seed-element-categories.mjs [--thumbs /path/to/dir] [--dry-run]
//
// --thumbs    directory holding <value>.jpg per category; each is uploaded to the public bucket
//             as element-categories/<value>.jpg, stored the same way the dashboard stores an
//             uploaded thumbnail (public object URL + ?v=). Optional: the element strip is happy
//             with text chips, unlike the background strip.
// --dry-run   print the resulting settings without writing anything.
//
// ★ Categories here are THEMES ONLY. Shapes and frames are already their own entry points in the
// mobile editor's bottom bar, so a type-shaped category would give the same asset two ways in —
// the one thing the reference app gets wrong, because it has a single unified picker and we
// don't. Everything finer than a theme is a tag, or Freepik's own `family_name`.
//
// ★ 14 of the 18 keys are deliberately IDENTICAL to background category keys, so a theme means
// the same thing in both catalogues (`wedding` is wedding wherever it appears). The four keys
// that exist only for elements are: birthday, gold-letters, ornaments, ribbons.
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";

import { sanitizeElementCategorySettings } from "../src/lib/elements/categorySettings.js";
import { getPublicStorageBucketName, uploadObject } from "../src/lib/storage/objectStorage.server.js";

const SETTINGS_KEY = "element_categories_v1";

// Strip order = list order. `value` is the stable key (never rename after publish — analytics and
// editor_element_assets.category_value both point at it).
//
// searchTerms are the importer-page suggestions: choosing the category fills the first term and
// the two filters, and offers the rest as one-click chips. Every term is written to return
// CUT-OUT artwork, because an element with a background is unusable on a canvas — hence the
// recurring "isolated" / "png" / "sticker" / "transparent" qualifiers. There is no `png` content
// type in the Magnific stock API; transparency comes from the search term plus `psd`/`vector`,
// or from importSource "icons" where it is guaranteed.
const CATEGORIES = [
  {
    value: "ramadan-eid",
    labelEn: "Ramadan & Eid",
    labelAr: "رمضان والعيد",
    searchTerms: [
      "ramadan lantern sticker png",
      "eid mubarak sticker isolated",
      "crescent moon star 3d isolated",
      "ramadan kareem calligraphy sticker",
      "eid gift box sticker isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "islamic",
    labelEn: "Islamic",
    labelAr: "إسلامي",
    searchTerms: [
      "islamic arch frame isolated",
      "mosque silhouette sticker",
      "arabesque ornament element png",
      "kaaba hajj sticker isolated",
      "islamic geometric ornament vector",
    ],
    importSource: "stock",
    importContentType: "vector",
  },
  {
    value: "wedding",
    labelEn: "Wedding",
    labelAr: "زفاف",
    searchTerms: [
      "wedding sticker isolated",
      "bride groom illustration isolated",
      "wedding rings gold png",
      "arabic wedding groom thobe illustration",
      "wedding arch flowers isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "newborn",
    labelEn: "Newborn",
    labelAr: "مواليد",
    searchTerms: [
      "baby shower sticker isolated",
      "newborn baby items illustration png",
      "stork baby sticker isolated",
      "baby feet footprint isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "birthday",
    labelEn: "Birthday",
    labelAr: "أعياد ميلاد",
    searchTerms: [
      "birthday cake sticker isolated",
      "balloons png isolated",
      "party hat confetti sticker",
      "birthday candles 3d isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "celebrations",
    labelEn: "Celebrations",
    labelAr: "احتفالات ومناسبات",
    searchTerms: [
      "graduation cap sticker isolated",
      "congratulations ribbon banner png",
      "fireworks sticker isolated",
      "trophy award 3d isolated",
      "engagement celebration sticker",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "national-days",
    labelEn: "National days",
    labelAr: "أعياد وطنية",
    searchTerms: [
      "saudi national day sticker",
      "uae national day element isolated",
      "gulf flags sticker png",
      "palm tree crossed swords emblem",
      "kuwait national day sticker",
    ],
    importSource: "stock",
    importContentType: "vector",
  },
  {
    value: "palestine",
    labelEn: "Palestine",
    labelAr: "فلسطين",
    searchTerms: [
      "palestine flag sticker isolated",
      "keffiyeh pattern element png",
      "dome of the rock illustration isolated",
      "olive branch sticker isolated",
      "watermelon palestine sticker",
    ],
    importSource: "stock",
    importContentType: "vector",
  },
  {
    value: "heritage",
    labelEn: "Heritage",
    labelAr: "تراث وسدو",
    searchTerms: [
      "arabic coffee dallah sticker isolated",
      "sadu pattern element png",
      "arabian oud instrument isolated",
      "camel silhouette sticker isolated",
      "arabic incense bakhoor sticker",
    ],
    importSource: "stock",
    importContentType: "all",
  },
  {
    value: "gold-letters",
    labelEn: "Gold letters",
    labelAr: "حروف ذهبية",
    searchTerms: [
      "arabic letter gold 3d isolated",
      "arabic alphabet rose gold floral png",
      "arabic letters gold glitter sticker",
      "gold monogram arabic letter isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "calligraphy",
    labelEn: "Arabic calligraphy",
    labelAr: "خط عربي",
    searchTerms: [
      "arabic calligraphy isolated png",
      "bismillah calligraphy vector isolated",
      "arabic greeting calligraphy sticker",
      "mabrook calligraphy isolated",
      "alf mabrook arabic typography sticker",
    ],
    importSource: "stock",
    importContentType: "vector",
  },
  {
    value: "flowers",
    labelEn: "Flowers & greenery",
    labelAr: "ورود ونباتات",
    searchTerms: [
      "watercolor flower isolated png",
      "rose bouquet sticker isolated",
      "eucalyptus branch watercolor isolated",
      "floral corner element png",
      "peony illustration transparent",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "ornaments",
    labelEn: "Ornaments & borders",
    labelAr: "زخارف وإطارات",
    searchTerms: [
      "gold ornament frame isolated",
      "vintage border divider vector",
      "ornamental corner element png",
      "luxury gold line frame isolated",
      "art deco ornament vector",
    ],
    importSource: "stock",
    importContentType: "vector",
  },
  {
    value: "ribbons",
    labelEn: "Ribbons & bows",
    labelAr: "شرائط وأقواس",
    searchTerms: [
      "satin bow isolated png",
      "ribbon banner sticker isolated",
      "gold ribbon 3d transparent",
      "gift bow illustration isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "glitter-lights",
    labelEn: "Lights & sparkle",
    labelAr: "أضواء ولمعان",
    searchTerms: [
      "gold sparkle glitter png transparent",
      "string lights isolated",
      "lens flare light effect png",
      "golden confetti isolated",
      "chandelier illustration isolated",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "food",
    labelEn: "Coffee & food",
    labelAr: "قهوة وطعام",
    searchTerms: [
      "arabic coffee cup sticker isolated",
      "dates plate illustration png",
      "tea cup sticker isolated",
      "cake dessert illustration isolated",
      "restaurant menu food sticker",
    ],
    importSource: "stock",
    importContentType: "psd",
  },
  {
    value: "kids",
    labelEn: "Kids",
    labelAr: "أطفال",
    searchTerms: [
      "cute cartoon animal sticker isolated",
      "kids toys illustration isolated",
      "rainbow cloud sticker png",
      "school supplies sticker isolated",
      "kids party element isolated",
    ],
    importSource: "stock",
    importContentType: "all",
  },
  {
    value: "sale",
    labelEn: "Business & offers",
    labelAr: "أعمال وعروض",
    searchTerms: [
      "sale badge sticker isolated",
      "discount tag 3d png",
      "special offer ribbon vector",
      "new arrival label isolated",
      "social media icon set flat",
    ],
    importSource: "icons",
    importContentType: "vector",
  },
];

function loadLocalEnv() {
  for (const filename of [".env", ".env.local"]) {
    try {
      const raw = readFileSync(path.join(process.cwd(), filename), "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] == null) process.env[key] = value;
      }
    } catch (_error) {
      // Missing env file is fine.
    }
  }
}

function parseArgs(argv) {
  const args = { thumbs: "", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--thumbs" && argv[i + 1]) {
      args.thumbs = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

async function uploadThumbnail(dir, value) {
  const file = path.join(dir, `${value}.jpg`);
  if (!existsSync(file)) return "";
  const body = readFileSync(file);
  const uploaded = await uploadObject({
    bucket: getPublicStorageBucketName(),
    key: `element-categories/${value}.jpg`,
    body,
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
    upsert: true,
    skipExistenceCheck: true,
  });
  const url = String(uploaded.url || "").trim();
  if (!url) throw new Error(`upload of ${value} returned no public URL`);
  const version = crypto.createHash("sha1").update(body).digest("hex").slice(0, 8);
  return `${url}?v=${version}`;
}

loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
const prisma = new PrismaClient();

try {
  const record = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY }, select: { value: true } });
  const current = sanitizeElementCategorySettings(record?.value);
  const byValue = new Map(current.map((item) => [item.value, item]));

  const next = [];
  // `general` is the importer's fallback when a category is missing. Kept if it already exists
  // (with its assets) but hidden from the app, so the strip shows only the main list.
  const general = byValue.get("general");
  if (general) {
    next.push({ ...general, published: false });
  }

  for (const category of CATEGORIES) {
    const existing = byValue.get(category.value);
    let thumbnailUrl = existing?.thumbnailUrl || "";
    if (args.thumbs && !args.dryRun) {
      thumbnailUrl = (await uploadThumbnail(args.thumbs, category.value)) || thumbnailUrl;
      process.stdout.write(`uploaded ${category.value}\n`);
    }
    next.push({
      id: existing?.id,
      value: category.value,
      labelEn: category.labelEn,
      labelAr: category.labelAr,
      thumbnailUrl,
      published: true,
      searchTerms: category.searchTerms,
      importSource: category.importSource,
      importContentType: category.importContentType,
    });
  }

  const sanitized = sanitizeElementCategorySettings(next);
  if (args.dryRun) {
    console.log(JSON.stringify(sanitized, null, 2));
  } else {
    await prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: sanitized },
      update: { value: sanitized },
    });
    const terms = sanitized.reduce((total, item) => total + item.searchTerms.length, 0);
    console.log(
      `saved ${sanitized.length} categories (${sanitized.filter((c) => c.published).length} published, ${terms} search terms)`
    );
  }
} finally {
  await prisma.$disconnect();
}
