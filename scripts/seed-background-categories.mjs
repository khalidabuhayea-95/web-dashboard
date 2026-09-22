#!/usr/bin/env node
// Seeds the flat list of MAIN background categories (AR + EN labels, stable
// `value` keys, thumbnails) into the `background_categories_v1` app setting —
// the same row the Settings > Background categories section edits.
//
//   node scripts/seed-background-categories.mjs --thumbs /path/to/dir [--dry-run] [--move-sea-assets]
//
// --thumbs            directory holding <value>.jpg per category; each is uploaded to the
//                     public bucket as background-categories/<value>.jpg and stored the same
//                     way the dashboard stores an uploaded thumbnail (client proxy URL + ?v=).
// --move-sea-assets   the pre-seed "sea" test category was keyed `islamic`; move its imported
//                     assets to the new `sea` key so `islamic` can become Islamic patterns.
// --dry-run           print the resulting settings without writing anything.
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";

import { sanitizeBackgroundCategorySettings } from "../src/lib/backgrounds/categorySettings.js";
import { getPublicStorageBucketName, uploadObject } from "../src/lib/storage/objectStorage.server.js";

const SETTINGS_KEY = "background_categories_v1";

// Strip order = list order. `value` is the stable key (never rename after publish).
// searchTerms / importOrientation / importContentType are the importer-page suggestions:
// choosing the category there fills the first term and the two filters and offers the rest of
// the terms as one-click chips. Editable afterwards in Settings > Background categories.
const CATEGORIES = [
  {
    value: "ramadan-eid",
    labelEn: "Ramadan & Eid",
    labelAr: "رمضان والعيد",
    searchTerms: ["ramadan background lantern", "eid mubarak background", "eid al adha background", "islamic crescent lantern background"],
    importOrientation: "portrait",
    importContentType: "all",
  },
  {
    value: "islamic",
    labelEn: "Islamic",
    labelAr: "إسلامي",
    searchTerms: ["islamic pattern background", "arabesque background", "islamic arch frame background", "hajj background kaaba"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "calligraphy",
    labelEn: "Arabic Calligraphy",
    labelAr: "خط عربي",
    searchTerms: ["arabic calligraphy background", "arabic calligraphy texture pattern", "arabic letters abstract background"],
    importOrientation: "all",
    importContentType: "vector",
  },
  {
    value: "heritage",
    labelEn: "Heritage",
    labelAr: "تراث",
    searchTerms: ["sadu pattern", "arabic heritage background", "najdi door", "mashrabiya pattern", "persian carpet texture"],
    importOrientation: "portrait",
    importContentType: "all",
  },
  {
    value: "national-days",
    labelEn: "National Days",
    labelAr: "مناسبات وطنية",
    searchTerms: ["saudi national day background", "saudi founding day background", "uae national day background", "kuwait national day background", "qatar national day background", "jordan independence day background"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "palestine",
    labelEn: "Palestine",
    labelAr: "فلسطين",
    searchTerms: ["palestine background", "keffiyeh pattern", "palestine flag watercolor background", "olive branch pattern"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "winter",
    labelEn: "Winter",
    labelAr: "شتاء",
    searchTerms: ["winter background snow", "snowflakes bokeh background", "cozy winter background"],
    importOrientation: "all",
    importContentType: "all",
  },
  {
    value: "wedding",
    labelEn: "Wedding",
    labelAr: "زفاف",
    searchTerms: ["wedding invitation background floral", "elegant wedding background gold", "arabic wedding invitation background"],
    importOrientation: "portrait",
    importContentType: "all",
  },
  {
    value: "newborn",
    labelEn: "Newborn",
    labelAr: "مواليد",
    searchTerms: ["baby shower background", "newborn baby background pastel", "baby boy blue clouds background", "baby girl pink background"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "celebrations",
    labelEn: "Celebrations",
    labelAr: "احتفالات",
    searchTerms: ["birthday background balloons", "party confetti background", "graduation background", "new year fireworks background"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "sale",
    labelEn: "Sale & Offers",
    labelAr: "عروض",
    searchTerms: ["sale background", "mega sale banner background burst", "black friday background", "discount promo background"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "luxury",
    labelEn: "Luxury",
    labelAr: "فخامة",
    searchTerms: ["luxury black gold background", "elegant gold pattern background dark", "royal ornament background"],
    importOrientation: "portrait",
    importContentType: "vector",
  },
  {
    value: "glitter-lights",
    labelEn: "Glitter & Lights",
    labelAr: "بريق وأضواء",
    searchTerms: ["glitter background", "gold glitter texture", "bokeh lights background", "fairy lights background"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "gradients",
    labelEn: "Gradients",
    labelAr: "تدرجات",
    searchTerms: ["mesh gradient background", "grainy gradient texture", "aurora blur gradient background", "soft pastel gradient"],
    importOrientation: "all",
    importContentType: "vector",
  },
  {
    value: "abstract",
    labelEn: "Abstract",
    labelAr: "تجريدي",
    searchTerms: ["abstract background", "fluid abstract background", "3d wave background", "frosted glass background"],
    importOrientation: "all",
    importContentType: "all",
  },
  {
    value: "watercolor",
    labelEn: "Watercolor",
    labelAr: "ألوان مائية",
    searchTerms: ["watercolor background", "watercolor wash texture", "watercolor splash background pastel"],
    importOrientation: "all",
    importContentType: "all",
  },
  {
    value: "patterns",
    labelEn: "Patterns",
    labelAr: "أنماط",
    searchTerms: ["seamless pattern background", "geometric pattern background", "memphis pattern", "retro pattern background"],
    importOrientation: "all",
    importContentType: "vector",
  },
  {
    value: "minimal",
    labelEn: "Minimal",
    labelAr: "بسيط",
    searchTerms: ["minimal background", "minimalist beige background", "clean simple background shapes", "corporate background"],
    importOrientation: "all",
    importContentType: "vector",
  },
  {
    value: "tech-neon",
    labelEn: "Tech & Neon",
    labelAr: "تقنية ونيون",
    searchTerms: ["technology background circuit", "futuristic tech background", "neon glow dark background"],
    importOrientation: "all",
    importContentType: "all",
  },
  {
    value: "marble",
    labelEn: "Marble",
    labelAr: "رخام",
    searchTerms: ["marble texture background", "white marble gold veins", "black marble texture"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "wood",
    labelEn: "Wood",
    labelAr: "خشب",
    searchTerms: ["wood texture background", "wooden table top background", "dark wood texture"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "paper",
    labelEn: "Paper",
    labelAr: "ورق",
    searchTerms: ["paper texture background", "kraft paper texture", "old paper parchment texture"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "walls",
    labelEn: "Walls",
    labelAr: "جدران",
    searchTerms: ["concrete wall texture", "brick wall background", "plaster wall texture"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "fabric",
    labelEn: "Fabric",
    labelAr: "أقمشة",
    searchTerms: ["fabric texture background", "velvet texture", "embroidery pattern background", "silk texture"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "flowers",
    labelEn: "Flowers",
    labelAr: "زهور",
    searchTerms: ["flowers background", "floral background elegant", "roses background", "spring background flowers"],
    importOrientation: "portrait",
    importContentType: "all",
  },
  {
    value: "nature",
    labelEn: "Nature",
    labelAr: "طبيعة",
    searchTerms: ["leaves background", "tropical leaves background", "autumn background leaves", "desert dunes background"],
    importOrientation: "all",
    importContentType: "all",
  },
  {
    value: "sky",
    labelEn: "Sky",
    labelAr: "سماء",
    searchTerms: ["sky clouds background", "sunset sky background pink", "night sky stars background", "galaxy space background"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "sea",
    labelEn: "Sea",
    labelAr: "بحر",
    searchTerms: ["sea background", "ocean waves top view", "water ripple texture", "beach sand background"],
    importOrientation: "all",
    importContentType: "photo",
  },
  {
    value: "food",
    labelEn: "Food & Café",
    labelAr: "طعام ومقاهي",
    searchTerms: ["restaurant menu background", "dark slate food background", "coffee beans background", "arabic coffee dallah background"],
    importOrientation: "portrait",
    importContentType: "photo",
  },
  {
    value: "kids",
    labelEn: "Kids & School",
    labelAr: "أطفال ومدرسة",
    searchTerms: ["kids background cartoon", "cute pattern background children", "back to school background", "chalkboard background"],
    importOrientation: "portrait",
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
  const args = { thumbs: "", dryRun: false, moveSeaAssets: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--thumbs" && argv[i + 1]) {
      args.thumbs = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true;
    } else if (argv[i] === "--move-sea-assets") {
      args.moveSeaAssets = true;
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
    key: `background-categories/${value}.jpg`,
    body,
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
    upsert: true,
    skipExistenceCheck: true,
  });
  const url = String(uploaded.url || "").trim();
  if (!url) throw new Error(`upload of ${value} returned no public URL`);
  const version = crypto.createHash("sha1").update(body).digest("hex").slice(0, 8);
  // Stored as the raw public object URL, like the existing category thumbnails and
  // the backfill scripts; the mobile route rewrites it to the per-host proxy URL.
  return `${url}?v=${version}`;
}

loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
const prisma = new PrismaClient();

try {
  const record = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY }, select: { value: true } });
  const current = sanitizeBackgroundCategorySettings(record?.value);
  const byValue = new Map(current.map((item) => [item.value, item]));

  const next = [];
  // `general` is the importer's fallback and is force-added by the sanitizer; keep it
  // (with its assets) but hidden from the app so the strip shows only the main list.
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
      importOrientation: category.importOrientation,
      importContentType: category.importContentType,
    });
  }

  const sanitized = sanitizeBackgroundCategorySettings(next);
  if (args.dryRun) {
    console.log(JSON.stringify(sanitized, null, 2));
  } else {
    await prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: sanitized },
      update: { value: sanitized },
    });
    console.log(`saved ${sanitized.length} categories (${sanitized.filter((c) => c.published).length} published)`);

    if (args.moveSeaAssets) {
      const moved = await prisma.$executeRaw`UPDATE editor_background_assets SET category_value = 'sea' WHERE category_value = 'islamic'`;
      console.log(`moved ${moved} imported assets from islamic -> sea`);
    }
  }
} finally {
  await prisma.$disconnect();
}
